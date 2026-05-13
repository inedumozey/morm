// migrations/indexMigrations.ts

import { parseCheck } from "../utils/checkParser.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

/**
 * Index definition — three forms allowed in the model:
 *
 *   "column_name"
 *     → simple single-column index
 *
 *   ["col_a", "col_b"]
 *     → composite index on (col_a, col_b)
 *
 *   { columns: "col" | string[], where: "active == true" }
 *     → partial index (single or composite)
 */
export type IndexDefinition =
  | string
  | string[]
  | { columns: string | string[]; where: string };

type ResolvedIndex = {
  /** Canonical index name: table_col1_col2_idx */
  name: string;
  /** Ordered column list */
  columns: string[];
  /** Compiled SQL WHERE clause, or null for full indexes */
  where: string | null;
};

export type IndexResult = {
  created: string[];
  dropped: string[];
};

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

/**
 * Resolve any IndexDefinition shape into a canonical ResolvedIndex.
 * Throws descriptively if the definition is structurally invalid.
 */
function resolveIndex(table: string, def: IndexDefinition): ResolvedIndex {
  let columns: string[];
  let where: string | null = null;

  if (typeof def === "string") {
    // "column_name"
    columns = [def];
  } else if (Array.isArray(def)) {
    // ["col_a", "col_b"]
    if (def.length === 0) {
      throw new Error(
        `Index definition on "${table}" has an empty column array`,
      );
    }
    columns = def;
  } else {
    // { columns, where }
    const cols = def.columns;
    columns = typeof cols === "string" ? [cols] : [...cols];

    if (columns.length === 0) {
      throw new Error(
        `Index definition on "${table}" has an empty columns field`,
      );
    }

    // Compile JS-style expression → SQL via checkParser
    try {
      where = parseCheck(def.where);
    } catch (err: any) {
      throw new Error(
        `Invalid partial index WHERE on "${table}": ${err.message}`,
      );
    }
  }

  // Deterministic name: table_col1_col2_idx
  const name = `${table}_${columns.join("_")}_idx`;

  return { name, columns, where };
}

/**
 * Build the full CREATE INDEX SQL for a resolved index definition.
 */
function buildCreateIndexSQL(table: string, idx: ResolvedIndex): string {
  const cols = idx.columns.map((c) => `"${c}"`).join(", ");
  const base = `CREATE INDEX IF NOT EXISTS "${idx.name}" ON "${table}" (${cols})`;
  return idx.where ? `${base} WHERE ${idx.where}` : base;
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

/**
 * Migrate indexes for a single table:
 *  1. Resolve all model index definitions
 *  2. Validate all referenced columns exist in the DB
 *  3. Drop stale MORM-managed indexes (named *_idx, not pkey)
 *  4. Create any missing indexes
 *
 * Returns { created, dropped } lists for the caller to log.
 * Throws on invalid column references or bad WHERE expressions.
 */
export async function indexMigrations(
  client: any,
  config: {
    table: string;
    indexes?: readonly IndexDefinition[] | undefined;
  },
): Promise<IndexResult> {
  const result: IndexResult = { created: [], dropped: [] };

  /* ---------- RESOLVE ALL DEFINITIONS ---------- */
  const resolved: ResolvedIndex[] = [];

  for (const def of config.indexes ?? []) {
    resolved.push(resolveIndex(config.table, def));
  }

  /* ---------- READ EXISTING DB INDEXES ---------- */
  const idxRes = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
    [config.table],
  );

  const existingIndexes = new Set<string>(
    idxRes.rows.map((r: any) => String(r.indexname)),
  );

  // Map of index name → its current WHERE clause (null if no WHERE)
  const existingIndexDefs = new Map<string, string | null>(
    idxRes.rows.map((r: any) => {
      const def = String(r.indexdef);
      const match: any = def.match(/WHERE\s+(.+)$/i);
      return [String(r.indexname), match ? match[1].trim() : null];
    }),
  );

  /* ---------- DESIRED INDEX NAMES ---------- */
  const desiredNames = new Set<string>(resolved.map((r) => r.name));

  /* ---------- VALIDATE ALL COLUMNS EXIST ---------- */
  const colsRes = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND LOWER(table_name) = LOWER($1)
    `,
    [config.table],
  );

  const dbCols = new Set<string>(
    colsRes.rows.map((r: any) => String(r.column_name)),
  );

  for (const idx of resolved) {
    for (const col of idx.columns) {
      if (!dbCols.has(col)) {
        throw new Error(
          `Invalid index on "${config.table}": column "${col}" does not exist`,
        );
      }
    }
  }

  /* ---------- CREATE OR RECREATE INDEXES ---------- */
  for (const idx of resolved) {
    if (existingIndexes.has(idx.name)) {
      const existingWhere = existingIndexDefs.get(idx.name) ?? null;
      const modelWhere = idx.where ?? null;
      const normalize = (s: string | null) =>
        s ? s.toLowerCase().replace(/\s+/g, " ").trim() : null;
      if (normalize(existingWhere) === normalize(modelWhere)) continue;
      await client.query(`DROP INDEX "${idx.name}"`);
      result.dropped.push(idx.name);
    }

    await client.query(buildCreateIndexSQL(config.table, idx));
    result.created.push(idx.name);
  }

  /* ---------- DROP STALE MORM-MANAGED INDEXES ---------- */
  for (const idxName of existingIndexes) {
    // Never touch primary key indexes
    if (idxName.endsWith("_pkey")) continue;

    // Only manage MORM-style indexes — must end with _idx
    if (!idxName.endsWith("_idx")) continue;

    if (!desiredNames.has(idxName)) {
      await client.query(`DROP INDEX IF EXISTS "${idxName}"`);
      result.dropped.push(idxName);
    }
  }

  return result;
}
