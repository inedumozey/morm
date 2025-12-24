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
    "nn",
    "n-n",
    "ntn",
    "n-t-n",
    "n-to-n",
    "one-one",
    "one-t-one",
    "one_to_one",
    "1-1",
    "1:1",
    "n:n",
  ]);
  if (oneToOne.has(v)) return "ONE-TO-ONE";

  const oneToMany = new Set([
    "nm",
    "n-m",
    "ntm",
    "n-t-m",
    "n-to-m",
    "one-many",
    "one-t-many",
    "one-to-many",
    "1-m",
    "1:m",
    "n:m",
  ]);
  if (oneToMany.has(v)) return "ONE-TO-MANY";

  const manyToMany = new Set([
    "mm",
    "m-m",
    "mtm",
    "m-t-m",
    "m-to-m",
    "many-many",
    "many-t-many",
    "many-to-many",
    "m:m",
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

  for (const m of models) {
    m._relations = { incoming: [], outgoing: [] };
  }

  const modelByLower = new Map<string, any>();
  for (const m of models) {
    modelByLower.set(String(m.table).toLowerCase(), m);
  }

  const graph = new Map<string, Set<string>>();
  const nodes = new Set<string>();

  for (const m of models) {
    const t = String(m.table).toLowerCase();
    nodes.add(t);
    if (!graph.has(t)) graph.set(t, new Set());
  }

  /* ---------- VALIDATE REFERENCES ---------- */
  for (const model of models) {
    const table = String(model.table);
    const tableLower = table.toLowerCase();

    for (const col of model.columns ?? []) {
      if (!col.references) continue;

      const ref = col.references;

      if (!ref.table || !ref.column) {
        errors.push(`${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Invalid reference: ${colors.reset} ${colors.subject}${table}.${col.name} missing target${colors.reset}`
        );
        continue;
      }

      const refTable = String(ref.table);
      const refTableLower = refTable.toLowerCase();

      const targetModel = modelByLower.get(refTableLower);
      if (!targetModel) {
        errors.push(` ${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Missing table: ${colors.subject}${refTable} does not exist${colors.reset}`
        );
        continue;
      }

      const refCol = String(ref.column);
      const targetCol = (targetModel.columns ?? []).find(
        (c: any) => String(c.name) === refCol
      );
      if (!targetCol) {
        errors.push(` ${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Missing column:${colors.reset} ${colors.subject}${refTable}.${refCol}${colors.reset}`
        );
        continue;
      }

      const relation = normalizeRelation(ref.relation);

      if (!relation) {
        errors.push(` ${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Invalid relation:${colors.reset} ${colors.subject}${table}.${col.name}${colors.reset}`
        );
        continue;
      }

      // ONE-TO-ONE MUST ALWAYS BE UNIQUE
      if (relation == "ONE-TO-ONE") {
        // log error if the column contains unique:true
        if (String(col.unique) == "false") {
          errors.push(` ${colors.subject}${table}${colors.reset}`);
          errors.push(
            `  ${colors.error}Invalid constraint:${colors.reset} ${colors.subject}${table}.${col.name} has a ONE-TO-ONE relation and must always be unique ${colors.reset}`
          );
          continue;
        }
      }

      const onDelete = ref.onDelete
        ? String(ref.onDelete).toUpperCase()
        : "CASCADE";
      const onUpdate = ref.onUpdate
        ? String(ref.onUpdate).toUpperCase()
        : "CASCADE";

      if (!VALID_FK_ACTIONS.has(onDelete)) {
        errors.push(` ${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Invalid onDelete:${colors.reset} ${colors.subject}${table}.${col.name}${colors.reset}`
        );
      }
      if (!VALID_FK_ACTIONS.has(onUpdate)) {
        errors.push(` ${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Invalid onUpdate:${colors.reset} ${colors.subject}${table}.${col.name}${colors.reset}`
        );
      }

      ref.onDelete = onDelete;
      ref.onUpdate = onUpdate;

      const left = parseType(col.type);
      const right = parseType(targetCol.type);

      // ONE-TO-ONE AND ONE-TO-MANY DOES NOT REQUIRE ARRAY TYPE
      if (relation == "ONE-TO-MANY" || relation == "ONE-TO-ONE") {
        if (left.isArray) {
          errors.push(` ${colors.subject}${table}${colors.reset}`);
          errors.push(
            `  ${colors.error}Invalid ${relation}:${colors.reset} ${colors.subject}${table}.${col.name} does not require array type${colors.reset}`
          );
          continue;
        }
      }

      if (left.base !== right.base) {
        errors.push(` ${colors.subject}${table}${colors.reset}`);
        errors.push(
          `  ${colors.error}Type mismatch:${colors.reset} ${colors.subject}${table}.${col.name}:${left.base} → ${colors.subject}${refTable}.${refCol}:${right.base}${colors.reset}`
        );
        continue;
      }

      // MANY-TO-MANY RELATION TYPE MUST BE ARRAY, THE REST MUST NOT BE ARRAY
      if (relation === "MANY-TO-MANY") {
        if (!left.isArray) {
          errors.push(` ${colors.subject}${table}${colors.reset}`);
          errors.push(
            `  ${colors.error}Invalid MANY-TO-MANY:${colors.reset} ${colors.subject}${table}.${col.name} requires array type${colors.reset}`
          );
          continue;
        }

        // duplicated column name protection (your current bug)
        const sameName = model.columns.filter(
          (c: any) =>
            String(c.name).toLowerCase() === String(col.name).toLowerCase()
        );

        if (sameName.length > 1) {
          errors.push(
            `${colors.error}Duplicate column:${colors.reset} ${colors.subject}${table}.${col.name}${colors.reset} cannot be declared multiple times`
          );
          continue;
        }

        col.__virtual = true;
      }

      if (refTableLower !== tableLower) {
        graph.get(refTableLower)!.add(tableLower);
        nodes.add(refTableLower);
      }

      // RECORD RELATION METADATA
      // record outgoing
      model._relations.outgoing.push({
        relation,
        fromTable: table,
        toTable: refTable,
        column: col.name,
        isSelf: tableLower === refTableLower,
      });

      // record incoming
      targetModel._relations.incoming.push({
        relation,
        fromTable: table,
        toTable: refTable,
        column: col.name,
        isSelf: tableLower === refTableLower,
      });
    }
  }

  if (errors.length > 0) return { errors, infos, sorted: null };

  /* ---------- TOPO SORT ---------- */
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);

  for (const [u, outs] of graph.entries()) {
    for (const v of outs) {
      inDegree.set(v, (inDegree.get(v) ?? 0) + 1);
    }
  }

  const q: string[] = [];
  for (const [n, d] of inDegree.entries()) if (d === 0) q.push(n);

  const order: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    order.push(n);
    for (const v of graph.get(n) ?? []) {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) q.push(v);
    }
  }

  if (order.length !== nodes.size) {
    errors.push(
      `  ${colors.error}Cyclic relations: ${colors.reset} ${colors.subject}cannot resolve migration order${colors.reset}`
    );
    return { errors, infos, sorted: null };
  }

  const sorted = order
    .map((t) => models.find((m) => String(m.table).toLowerCase() === t))
    .filter(Boolean);

  return { errors, infos, sorted };
}
