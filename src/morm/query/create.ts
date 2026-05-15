// query/create.ts

import { throwQueryError } from "../utils/queryError.js";
import { resolveSanitize, sanitizeText } from "../utils/sanitize.js";
import type { SanitizeConfig } from "../utils/sanitize.js";
import {
  normalizeKeys,
  resolveProjection,
  type CreateClause,
  type CreateResult,
  type ExcludeClause,
  type IncludeClause,
} from "./index.js";

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function isTextColumn(type: string): boolean {
  const t = type.toUpperCase();
  return t === "TEXT" || t.startsWith("VARCHAR") || t === "CHAR";
}

/** Apply sanitize to a data row based on column types */
function sanitizeRow(
  data: Record<string, any>,
  columns: any[],
  globalSanitize: SanitizeConfig | undefined,
  schemaSanitize: SanitizeConfig | undefined,
  querySanitize: SanitizeConfig | undefined,
): Record<string, any> {
  const out = { ...data };
  for (const col of columns) {
    if (!(col.name in out)) continue;
    if (!isTextColumn(String(col.type))) continue;

    const resolved = resolveSanitize(
      globalSanitize,
      schemaSanitize,
      col.sanitize,
      querySanitize,
    );

    if (!resolved) continue;
    out[col.name] = sanitizeText(out[col.name], resolved);
  }
  return out;
}

/** Build SELECT column list from projection */
function buildSelectSQL(
  table: string,
  columns: any[],
  include?: IncludeClause,
  exclude?: ExcludeClause,
): string {
  const projection = resolveProjection(include, exclude);

  // Filter to only scalar columns (not virtual/relation columns)
  const scalarCols = columns.filter((c) => !c.__virtual);

  let selectedCols: any[];

  if (projection.mode === "include") {
    // Only include non-relation keys
    const includeKeys = new Set(
      Object.entries(include ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    );
    selectedCols = scalarCols.filter((c) => includeKeys.has(c.name));
  } else if (projection.mode === "exclude") {
    const excludeKeys = new Set(Object.keys(exclude ?? {}));
    selectedCols = scalarCols.filter((c) => !excludeKeys.has(c.name));
  } else {
    selectedCols = scalarCols;
  }

  if (selectedCols.length === 0) {
    return `${q(table)}.*`;
  }

  return selectedCols.map((c) => `${q(table)}.${q(c.name)}`).join(", ");
}

/* ===================================================== */
/* MAIN CREATE FUNCTION                                   */
/* ===================================================== */

export async function runCreate(
  client: any,
  model: any,
  clause: CreateClause,
  globalSanitize?: SanitizeConfig,
): Promise<CreateResult | Record<string, any> | Record<string, any>[]> {
  const normalized = normalizeKeys(clause) as CreateClause;

  const isMany = Array.isArray(normalized.data);
  const rows: Record<string, any>[] = isMany
    ? (normalized.data as Record<string, any>[])
    : [normalized.data as Record<string, any>];

  if (rows.length === 0) return { count: 0 };

  const { columns, table } = model;
  const schemaSanitize = model.sanitize;
  const querySanitize = normalized.sanitize;

  /* ---- Sanitize all rows ---- */
  const sanitizedRows = rows.map((row) =>
    sanitizeRow(row, columns, globalSanitize, schemaSanitize, querySanitize),
  );

  /* ---- Build INSERT SQL ---- */
  // Collect all unique keys across all rows
  const allKeys = [...new Set(sanitizedRows.flatMap((r) => Object.keys(r)))];

  const colList = allKeys.map(q).join(", ");

  const valuePlaceholders = sanitizedRows.map((row, rowIdx) => {
    const vals = allKeys.map(
      (_, colIdx) => `$${rowIdx * allKeys.length + colIdx + 1}`,
    );
    return `(${vals.join(", ")})`;
  });

  const flatValues = sanitizedRows.flatMap((row) =>
    allKeys.map((k) => (row[k] !== undefined ? row[k] : null)),
  );

  const onConflict = normalized.skipDuplicates ? " ON CONFLICT DO NOTHING" : "";

  /* ---- Determine if we need to return rows ---- */
  const { include, exclude } = normalized;
  const projection = resolveProjection(include, exclude);

  /* ---- Build RETURNING clause ---- */
  const needsReturning =
    projection.mode === "include" ||
    projection.mode === "exclude" ||
    (projection.mode === "all" && include !== undefined);

  let sql: string;

  if (needsReturning) {
    const selectSQL = buildSelectSQL(table, columns, include, exclude);
    sql = `INSERT INTO ${q(table)} (${colList}) VALUES ${valuePlaceholders.join(", ")}${onConflict} RETURNING ${selectSQL}`;
  } else {
    sql = `INSERT INTO ${q(table)} (${colList}) VALUES ${valuePlaceholders.join(", ")}${onConflict}`;
  }

  /* ---- Execute ---- */
  let result: any;
  try {
    result = await client.query(sql, flatValues);
  } catch (err: any) {
    await client.query("ROLLBACK");
    throwQueryError(err, "create", table);
  }

  /* ---- Return ---- */
  if (!needsReturning) {
    return { count: result.rowCount ?? rows.length };
  }

  const returnedRows = result.rows as Record<string, any>[];

  if (isMany) return returnedRows;
  return returnedRows[0] ?? { count: 0 };
}
