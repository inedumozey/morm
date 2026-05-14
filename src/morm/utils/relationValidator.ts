// utils/relationValidator.ts

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

function parseType(type: any) {
  const s = String(type ?? "").trim();
  const upper = s.toUpperCase();
  const isArray = upper.endsWith("[]");
  const base = isArray ? upper.slice(0, -2) : upper;
  return { raw: s, upper, base, isArray };
}

const VALID_FK_ACTIONS = new Set([
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
  "RESTRICT",
  "NO ACTION",
]);

/* ===================================================== */
/* VALIDATE + TOPO-SORT                                  */
/* Each error is a plain { table?, message } object so  */
/* morm.ts can pass it cleanly to reporter.addError().  */
/* ===================================================== */

export type RelationError = { table?: string; message: string };

export function validateAndSortModels(models: any[]): {
  errors: RelationError[] | null;
  sorted: any[] | null;
} {
  const errors: RelationError[] = [];

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
        errors.push({
          table,
          message: `${table}.${col.name} — missing reference target`,
        });
        continue;
      }

      const refTable = String(ref.table);
      const refTableLower = refTable.toLowerCase();
      const targetModel = modelByLower.get(refTableLower);

      if (!targetModel) {
        errors.push({ table, message: `"${refTable}" does not exist` });
        continue;
      }

      const refCol = String(ref.column);
      const targetCol = (targetModel.columns ?? []).find(
        (c: any) => String(c.name) === refCol,
      );

      if (!targetCol) {
        errors.push({
          table,
          message: `Column "${refTable}.${refCol}" does not exist`,
        });
        continue;
      }

      const relation = normalizeRelation(ref.relation);

      if (!relation) {
        errors.push({
          table,
          message: `${table}.${col.name} — invalid relation "${ref.relation}"`,
        });
        continue;
      }

      if (relation === "ONE-TO-ONE" && String(col.unique) === "false") {
        errors.push({
          table,
          message: `${table}.${col.name} — ONE-TO-ONE relation must always be UNIQUE`,
        });
        continue;
      }

      const onDelete = ref.onDelete
        ? String(ref.onDelete).toUpperCase()
        : "CASCADE";
      const onUpdate = ref.onUpdate
        ? String(ref.onUpdate).toUpperCase()
        : "CASCADE";

      if (!VALID_FK_ACTIONS.has(onDelete)) {
        errors.push({
          table,
          message: `${table}.${col.name} — invalid onDelete "${onDelete}"`,
        });
      }
      if (!VALID_FK_ACTIONS.has(onUpdate)) {
        errors.push({
          table,
          message: `${table}.${col.name} — invalid onUpdate "${onUpdate}"`,
        });
      }

      ref.onDelete = onDelete;
      ref.onUpdate = onUpdate;

      const left = parseType(col.type);
      const right = parseType(targetCol.type);

      if (
        (relation === "ONE-TO-MANY" || relation === "ONE-TO-ONE") &&
        left.isArray
      ) {
        errors.push({
          table,
          message: `${table}.${col.name} — ${relation} does not use array type`,
        });
        continue;
      }

      if (left.base !== right.base) {
        errors.push({
          table,
          message: `${table}.${col.name} type mismatch: ${left.base} → ${refTable}.${refCol}: ${right.base}`,
        });
        continue;
      }

      if (relation === "MANY-TO-MANY") {
        if (!left.isArray) {
          errors.push({
            table,
            message: `${table}.${col.name} — MANY-TO-MANY requires array type`,
          });
          continue;
        }

        const sameName = model.columns.filter(
          (c: any) =>
            String(c.name).toLowerCase() === String(col.name).toLowerCase(),
        );
        if (sameName.length > 1) {
          errors.push({
            table,
            message: `${table}.${col.name} — column declared multiple times`,
          });
          continue;
        }

        col.__virtual = true;
      }

      if (refTableLower !== tableLower) {
        graph.get(refTableLower)!.add(tableLower);
        nodes.add(refTableLower);
      }

      model._relations.outgoing.push({
        relation,
        fromTable: table,
        toTable: refTable,
        column: col.name,
        isSelf: tableLower === refTableLower,
        onDelete,
        onUpdate,
      });

      targetModel._relations.incoming.push({
        relation,
        fromTable: table,
        toTable: refTable,
        column: col.name,
        isSelf: tableLower === refTableLower,
      });
    }
  }

  if (errors.length > 0) return { errors, sorted: null };

  /* ---------- TOPO SORT ---------- */
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);

  for (const [, outs] of graph.entries()) {
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
    errors.push({
      message: "Cyclic relations — cannot resolve migration order",
    });
    return { errors, sorted: null };
  }

  const sorted = order
    .map((t) => models.find((m) => String(m.table).toLowerCase() === t))
    .filter(Boolean);

  return { errors: null, sorted };
}
