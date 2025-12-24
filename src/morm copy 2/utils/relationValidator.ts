// utils/relationValidator.ts

import { colors } from "./logColors.js";

export type NormalizedRel =
  | "ONE-TO-ONE"
  | "ONE-TO-MANY"
  | "MANY-TO-MANY"
  | null;

/** Normalize user-written relation labels (case-insensitive) */
export function normalizeRelation(input: string | undefined): NormalizedRel {
  if (!input || typeof input !== "string") return null;
  const v = input.trim().toLowerCase();

  const oneToOne = new Set([
    "one",
    "1",
    "one-to-one",
    "one_to_one",
    "1-1",
    "1:1",
    "o2o",
    "n-n",
    "nn",
    "n-to-n",
    "n_t_n",
    "ntn",
  ]);
  if (oneToOne.has(v)) return "ONE-TO-ONE";

  const oneToMany = new Set([
    "one-to-many",
    "one_to_many",
    "1-m",
    "1:m",
    "one-to-m",
    "n-to-m",
    "n_t_m",
    "ntm",
    "n-m",
    "nm",
  ]);
  if (oneToMany.has(v)) return "ONE-TO-MANY";

  const manyToMany = new Set([
    "many-to-many",
    "m-to-m",
    "m_t_m",
    "mtm",
    "mm",
    "m-m",
  ]);
  if (manyToMany.has(v)) return "MANY-TO-MANY";

  return null;
}

/** Extract base type + array info */
function parseType(type: any) {
  const s = String(type ?? "").trim();
  const upper = s.toUpperCase();
  const isArray = upper.endsWith("[]");
  const base = isArray ? upper.slice(0, -2) : upper;
  return { raw: s, upper, base, isArray };
}

/** Allowed FK actions */
const VALID_FK_ACTIONS = new Set([
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
  "RESTRICT",
  "NO ACTION",
]);

/** Validate relations + topo-sort models */
export function validateAndSortModels(models: any[]) {
  const errors: string[] = [];
  const infos: string[] = [];

  // ----------------------------------
  // INIT RELATION STORAGE PER MODEL
  // ----------------------------------
  for (const m of models) {
    m._relations = {
      incoming: [],
      outgoing: [],
    };
  }

  // MANY-TO-MANY JUNCTION TABLES
  const junctionTables: {
    name: string;
    left: { table: string; column: string };
    right: { table: string; column: string };
    onDelete: string;
    onUpdate: string;
  }[] = [];

  // tableLower → model
  const modelByLower = new Map<string, any>();
  for (const m of models) {
    modelByLower.set(String(m.table).toLowerCase(), m);
  }

  // dependency graph: referenced → referencing
  const graph = new Map<string, Set<string>>();
  const nodes = new Set<string>();

  for (const m of models) {
    const t = String(m.table).toLowerCase();
    nodes.add(t);
    if (!graph.has(t)) graph.set(t, new Set());
  }

  // ---------------------------
  // VALIDATE REFERENCES
  // ---------------------------
  for (const model of models) {
    const table = String(model.table);
    const tableLower = table.toLowerCase();

    for (const col of model.columns ?? []) {
      if (!col.references) continue;

      const ref = col.references;

      if (!ref.table || !ref.column) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: invalid references on "${table}.${col.name}": missing table or column.${colors.reset}`
        );
        continue;
      }

      const refTable = String(ref.table);
      const refTableLower = refTable.toLowerCase();
      const isSelfRef = refTableLower === tableLower;

      const targetModel = modelByLower.get(refTableLower);
      if (!targetModel) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: relation on "${table}.${col.name}" references missing table "${refTable}".${colors.reset}`
        );
        continue;
      }

      const refCol = String(ref.column);
      const targetCol = (targetModel.columns ?? []).find(
        (c: any) => String(c.name) === refCol
      );
      if (!targetCol) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: relation on "${table}.${col.name}" references missing column "${refTable}.${refCol}".${colors.reset}`
        );
        continue;
      }

      const relation = normalizeRelation(ref.relation);
      if (!relation) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: invalid relation "${ref.relation}" on "${table}.${col.name}".${colors.reset}`
        );
        continue;
      }

      // ---------------------------
      // RECORD REVERSE RELATIONS (METADATA ONLY)
      // ---------------------------
      model._relations.outgoing.push({
        fromTable: table,
        fromColumn: col.name,
        toTable: refTable,
        toColumn: refCol,
        relation,
      });

      targetModel._relations.incoming.push({
        fromTable: table,
        fromColumn: col.name,
        toTable: refTable,
        toColumn: refCol,
        relation,
      });

      // ---------------------------
      // DEFAULT FK ACTIONS
      // ---------------------------
      const onDelete = ref.onDelete
        ? String(ref.onDelete).toUpperCase()
        : "CASCADE";
      const onUpdate = ref.onUpdate
        ? String(ref.onUpdate).toUpperCase()
        : "CASCADE";

      if (!VALID_FK_ACTIONS.has(onDelete)) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: invalid onDelete action "${ref.onDelete}" on "${table}.${col.name}".${colors.reset}`
        );
      }
      if (!VALID_FK_ACTIONS.has(onUpdate)) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: invalid onUpdate action "${ref.onUpdate}" on "${table}.${col.name}".${colors.reset}`
        );
      }

      ref.onDelete = onDelete;
      ref.onUpdate = onUpdate;

      // ---------------------------
      // TYPE CHECK
      // ---------------------------
      const left = parseType(col.type);
      const right = parseType(targetCol.type);

      // ---------------------------
      // MANY-TO-MANY (VIRTUAL COLUMN)
      // ---------------------------
      if (relation === "MANY-TO-MANY") {
        if (!left.isArray) {
          errors.push(
            `${colors.red}${colors.bold}MORM ERROR: MANY-TO-MANY relation on "${table}.${col.name}" requires array type (UUID[]).${colors.reset}`
          );
        }

        // CRITICAL: mark as virtual → NO COLUMN, NO FK
        col.__virtual = true;
        // MM relations NEVER create FK or dependency edges
        continue;
      }

      // ---------------------------
      // ONE-TO-ONE / ONE-TO-MANY
      // ---------------------------
      if (left.base !== right.base) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: type mismatch on relation "${table}.${col.name}" → "${refTable}.${refCol}": ${left.base} ≠ ${right.base}.${colors.reset}`
        );
        continue;
      }

      // ---------------------------
      // DEPENDENCY GRAPH
      // ---------------------------
      // Skip self-reference edges to avoid false cycles
      if (!isSelfRef) {
        graph.get(refTableLower)!.add(tableLower);
        nodes.add(refTableLower);
        nodes.add(tableLower);
      }
    }
  }

  if (errors.length > 0) return { errors, infos, sorted: null };

  // ---------------------------
  // TOPOLOGICAL SORT (KAHN)
  // ---------------------------
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);

  for (const [u, outs] of graph.entries()) {
    for (const v of outs) {
      inDegree.set(v, (inDegree.get(v) ?? 0) + 1);
    }
  }

  const q: string[] = [];
  for (const [n, deg] of inDegree.entries()) if (deg === 0) q.push(n);

  const order: string[] = [];
  while (q.length > 0) {
    const n = q.shift()!;
    order.push(n);
    for (const next of graph.get(n) ?? []) {
      inDegree.set(next, inDegree.get(next)! - 1);
      if (inDegree.get(next) === 0) q.push(next);
    }
  }

  if (order.length !== nodes.size) {
    errors.push(
      `${colors.red}${colors.bold}MORM ERROR: cyclic relations detected — cannot determine migration order.${colors.reset}`
    );
    return { errors, infos, sorted: null };
  }

  const sorted = order
    .map((tblLower) =>
      models.find((m) => String(m.table).toLowerCase() === tblLower)
    )
    .filter(Boolean);
  return { errors, infos, sorted };
}
