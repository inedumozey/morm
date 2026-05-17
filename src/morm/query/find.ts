// query/find.ts

import { MormError, throwQueryError } from "../utils/queryError.js";
import {
  normalizeKeys,
  resolveProjection,
  hasAggregation,
  type FindClause,
  type FindOneClause,
  type IncludeClause,
  type ExcludeClause,
  type WhereClause,
  type OrderByClause,
  type DistinctClause,
} from "./index.js";

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

/* ===================================================== */
/* WHERE BUILDER                                         */
/* ===================================================== */

function buildWhere(
  where: WhereClause,
  params: any[],
  tableAlias?: string,
): string {
  const parts: string[] = [];
  const prefix = tableAlias ? `${q(tableAlias)}.` : "";

  for (const [key, value] of Object.entries(where)) {
    const keyLower = key.toLowerCase();

    /* ---- AND ---- */
    if (keyLower === "and" && Array.isArray(value)) {
      const andParts = (value as WhereClause[]).map((w) =>
        buildWhere(w, params, tableAlias),
      );
      if (andParts.length > 0) {
        parts.push(`(${andParts.join(" AND ")})`);
      }
      continue;
    }

    /* ---- OR ---- */
    if (keyLower === "or" && Array.isArray(value)) {
      const orParts = (value as WhereClause[]).map((w) =>
        buildWhere(w, params, tableAlias),
      );
      if (orParts.length > 0) {
        parts.push(`(${orParts.join(" OR ")})`);
      }
      continue;
    }

    const col = `${prefix}${q(keyLower)}`;

    /* ---- NULL ---- */
    if (value === null) {
      parts.push(`${col} IS NULL`);
      continue;
    }

    /* ---- Scalar / operators ---- */
    if (typeof value === "object" && !Array.isArray(value)) {
      const ops = value as Record<string, any>;
      const opParts: string[] = [];

      for (const [op, opVal] of Object.entries(ops)) {
        const opLower = op.toLowerCase();
        switch (opLower) {
          case "eq":
            if (opVal === null) {
              opParts.push(`${col} IS NULL`);
            } else {
              params.push(opVal);
              opParts.push(`${col} = $${params.length}`);
            }
            break;
          case "not":
            if (opVal === null) {
              opParts.push(`${col} IS NOT NULL`);
            } else {
              params.push(opVal);
              opParts.push(`${col} != $${params.length}`);
            }
            break;
          case "gt":
            params.push(opVal);
            opParts.push(`${col} > $${params.length}`);
            break;
          case "gte":
            params.push(opVal);
            opParts.push(`${col} >= $${params.length}`);
            break;
          case "lt":
            params.push(opVal);
            opParts.push(`${col} < $${params.length}`);
            break;
          case "lte":
            params.push(opVal);
            opParts.push(`${col} <= $${params.length}`);
            break;
          case "contains":
            params.push(`%${opVal}%`);
            opParts.push(`${col} ILIKE $${params.length}`);
            break;
          case "startswith":
            params.push(`${opVal}%`);
            opParts.push(`${col} ILIKE $${params.length}`);
            break;
          case "endswith":
            params.push(`%${opVal}`);
            opParts.push(`${col} ILIKE $${params.length}`);
            break;
          case "hasany":
            params.push(opVal);
            opParts.push(`${col} && $${params.length}`);
            break;
          case "hasall":
            params.push(opVal);
            opParts.push(`${col} @> $${params.length}`);
            break;
        }
      }

      if (opParts.length > 0) {
        parts.push(opParts.join(" AND "));
      }
      continue;
    }

    /* ---- Basic equality ---- */
    params.push(value);
    parts.push(`${col} = $${params.length}`);
  }

  return parts.length > 0 ? parts.join(" AND ") : "TRUE";
}

/* ===================================================== */
/* SELECT COLUMNS BUILDER                                */
/* ===================================================== */

function buildSelectColumns(
  columns: any[],
  include?: IncludeClause,
  exclude?: ExcludeClause,
  tableAlias?: string,
): string {
  const prefix = tableAlias ? `${q(tableAlias)}.` : "";
  const scalarCols = columns.filter((c) => !c.__virtual);
  const projection = resolveProjection(include, exclude);

  let selectedCols: any[];

  if (projection.mode === "include") {
    const includeKeys = new Set(
      Object.entries(include ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k.toLowerCase()),
    );
    selectedCols = scalarCols.filter((c) => includeKeys.has(c.name));
  } else if (projection.mode === "exclude") {
    const excludeKeys = new Set(
      Object.keys(exclude ?? {}).map((k) => k.toLowerCase()),
    );
    selectedCols = scalarCols.filter((c) => !excludeKeys.has(c.name));
  } else {
    selectedCols = scalarCols;
  }

  if (selectedCols.length === 0) return `${prefix}*`;

  return selectedCols.map((c) => `${prefix}${q(c.name)}`).join(", ");
}

/* ===================================================== */
/* AGGREGATION BUILDER                                   */
/* ===================================================== */

function buildAggregationSQL(clause: FindClause, table: string): string {
  const parts: string[] = [];

  if (clause.count) parts.push(`COUNT(*) AS "count"`);
  if (clause.sum)
    parts.push(`SUM(${q(table)}.${q(clause.sum)}) AS "sum_${clause.sum}"`);
  if (clause.avg)
    parts.push(`AVG(${q(table)}.${q(clause.avg)}) AS "avg_${clause.avg}"`);
  if (clause.min)
    parts.push(`MIN(${q(table)}.${q(clause.min)}) AS "min_${clause.min}"`);
  if (clause.max)
    parts.push(`MAX(${q(table)}.${q(clause.max)}) AS "max_${clause.max}"`);

  return parts.join(", ");
}

function parseAggregationResult(
  row: any,
  clause: FindClause,
): Record<string, any> {
  const result: Record<string, any> = {};

  if (clause.count) result.count = parseInt(row.count ?? "0");
  if (clause.sum)
    result.sum = { [clause.sum]: parseFloat(row[`sum_${clause.sum}`] ?? "0") };
  if (clause.avg)
    result.avg = { [clause.avg]: parseFloat(row[`avg_${clause.avg}`] ?? "0") };
  if (clause.min) result.min = { [clause.min]: row[`min_${clause.min}`] };
  if (clause.max) result.max = { [clause.max]: row[`max_${clause.max}`] };

  return result;
}

/* ===================================================== */
/* MAIN FIND FUNCTION                                    */
/* ===================================================== */

export async function runFind(
  client: any,
  model: any,
  clause: FindClause = {},
  globalSanitize?: any,
  debug = false,
): Promise<Record<string, any>[] | Record<string, any>> {
  const start = Date.now();
  const normalized = normalizeKeys(clause) as FindClause;

  const { columns, table } = model;
  const {
    include,
    exclude,
    where,
    orderby: orderBy,
    take,
    page,
    after,
    distinct,
  } = normalized as any;

  const params: any[] = [];

  /* ---- Aggregation ---- */
  const isAgg = hasAggregation(normalized);

  if (isAgg) {
    const aggSQL = buildAggregationSQL(normalized, table);
    let sql = `SELECT ${aggSQL} FROM ${q(table)}`;

    if (where) {
      const whereSQL = buildWhere(normalizeKeys(where), params, table);
      if (whereSQL !== "TRUE") sql += ` WHERE ${whereSQL}`;
    }

    try {
      const result = await client.query(sql, params);
      if (debug)
        console.log(
          `\x1b[36m  ⚡ find "${table}" — aggregation — ${Date.now() - start}ms\x1b[0m`,
        );
      return parseAggregationResult(result.rows[0], normalized);
    } catch (err: any) {
      throwQueryError(err, "find", table);
    }
  }

  /* ---- Select columns ---- */
  const selectSQL = buildSelectColumns(columns, include, exclude, table);

  /* ---- Distinct ---- */
  const distinctSQL =
    distinct && Object.keys(distinct).length > 0
      ? `DISTINCT ON (${Object.keys(distinct)
          .map((k) => `${q(table)}.${q(k.toLowerCase())}`)
          .join(", ")}) `
      : "";

  let sql = `SELECT ${distinctSQL}${selectSQL} FROM ${q(table)}`;

  /* ---- Where ---- */
  if (where) {
    const whereSQL = buildWhere(normalizeKeys(where), params, table);
    if (whereSQL !== "TRUE") sql += ` WHERE ${whereSQL}`;
  }

  /* ---- After (cursor) ---- */
  if (
    after &&
    Object.keys(after).length > 0 &&
    orderBy &&
    Object.keys(orderBy).length > 0
  ) {
    const cursorCol = Object.keys(after)[0]!.toLowerCase();
    const cursorVal = Object.values(after)[0]!;

    // Validate cursor column is unique or primary
    const cursorColDef = columns.find((c: any) => c.name === cursorCol);
    if (cursorColDef && !cursorColDef.__primary && !cursorColDef.unique) {
      throw new MormError(
        {
          code: "MORM_INVALID_CURSOR",
          message: `Cursor column "${cursorCol}" must be unique or primary key`,
          column: cursorCol,
        },
        "find",
        table,
      );
    }

    const firstOrderCol = Object.keys(orderBy)[0]!.toLowerCase();
    const firstOrderDir = Object.values(orderBy)[0];
    const operator = String(firstOrderDir).toUpperCase() === "DESC" ? "<" : ">";

    // Look up the orderBy column value for the cursor row
    const cursorResult = await client.query(
      `SELECT ${q(firstOrderCol)} FROM ${q(table)} WHERE ${q(cursorCol)} = $1 LIMIT 1`,
      [cursorVal],
    );

    if (cursorResult.rows.length > 0) {
      const cursorValue = cursorResult.rows[0][firstOrderCol];
      const connector = sql.includes("WHERE") ? " AND" : " WHERE";
      params.push(cursorValue);
      sql += `${connector} ${q(table)}.${q(firstOrderCol)} ${operator} $${params.length}`;
    }
  }

  /* ---- Order by ---- */
  if (orderBy && Object.keys(orderBy).length > 0) {
    const orderParts = Object.entries(orderBy).map(
      ([col, dir]) =>
        `${q(table)}.${q(col.toLowerCase())} ${String(dir).toUpperCase() === "DESC" ? "DESC" : "ASC"}`,
    );
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }

  /* ---- Pagination ---- */
  if (take) {
    sql += ` LIMIT ${parseInt(String(take))}`;
  }

  if (page && !after) {
    const offset =
      (parseInt(String(page)) - 1) * (parseInt(String(take)) || 10);
    sql += ` OFFSET ${offset}`;
  }

  /* ---- Execute ---- */
  try {
    const result = await client.query(sql, params);
    if (debug)
      console.log(
        `\x1b[36m  ⚡ find "${table}" — ${result.rows.length} rows — ${Date.now() - start}ms\x1b[0m`,
      );
    return result.rows as Record<string, any>[];
  } catch (err: any) {
    throwQueryError(err, "find", table);
  }
}

/* ===================================================== */
/* FIND ONE                                              */
/* ===================================================== */

export async function runFindOne(
  client: any,
  model: any,
  clause: FindOneClause = {},
  globalSanitize?: any,
  debug = false,
): Promise<Record<string, any> | null> {
  const start = Date.now();
  const normalized = normalizeKeys(clause) as FindOneClause;
  const { columns, table } = model;
  const { include, exclude, where } = normalized;

  /* ---- Validate where uses only unique/primary columns ---- */
  if (where) {
    const whereKeys = Object.keys(normalizeKeys(where)).filter(
      (k) => k !== "and" && k !== "or",
    );

    for (const key of whereKeys) {
      const col = columns.find((c: any) => c.name === key.toLowerCase());
      if (col && !col.__primary && !col.unique) {
        throw new MormError(
          {
            code: "MORM_NON_UNIQUE_WHERE",
            message: `findOne where clause must use unique or primary key columns only. Column "${key}" is not unique`,
            column: key,
          },
          "findOne",
          table,
        );
      }
    }
  }

  const params: any[] = [];
  const selectSQL = buildSelectColumns(columns, include, exclude, table);
  let sql = `SELECT ${selectSQL} FROM ${q(table)}`;

  if (where) {
    const whereSQL = buildWhere(normalizeKeys(where), params, table);
    if (whereSQL !== "TRUE") sql += ` WHERE ${whereSQL}`;
  }

  sql += ` LIMIT 1`;

  try {
    const result = await client.query(sql, params);
    if (debug)
      console.log(
        `\x1b[36m  ⚡ findOne "${table}" — ${Date.now() - start}ms\x1b[0m`,
      );
    return result.rows[0] ?? null;
  } catch (err: any) {
    throwQueryError(err, "findOne", table);
  }
}
