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
  columns?: any[],
  table?: string,
  queryMode?: "sensitive" | "insensitive",
): string {
  const parts: string[] = [];
  const prefix = tableAlias ? `${q(tableAlias)}.` : "";

  for (const [key, value] of Object.entries(where)) {
    const keyLower = key.toLowerCase();

    /* ---- AND ---- */
    if (keyLower === "and" && Array.isArray(value)) {
      const andParts = (value as WhereClause[]).map((w) =>
        buildWhere(w, params, tableAlias, columns, table, queryMode),
      );
      if (andParts.length > 0) {
        parts.push(`(${andParts.join(" AND ")})`);
      }
      continue;
    }

    /* ---- OR ---- */
    if (keyLower === "or" && Array.isArray(value)) {
      const orParts = (value as WhereClause[]).map((w) =>
        buildWhere(w, params, tableAlias, columns, table, queryMode),
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

        // Validate scalar operators not used on array columns
        const colDef = columns?.find((c: any) => c.name === keyLower);
        const colType = String(colDef?.type ?? "").toUpperCase();
        const isArrayCol = colType.endsWith("[]");
        const isTextCol = ["TEXT", "VARCHAR", "CHAR"].some((t) =>
          colType.startsWith(t),
        );
        const isNumberCol = [
          "INT",
          "INTEGER",
          "BIGINT",
          "SMALLINT",
          "NUMERIC",
          "DECIMAL",
          "REAL",
          "FLOAT8",
        ].some((t) => colType.startsWith(t));
        const isBoolCol = colType === "BOOLEAN";
        const isDateCol = ["TIMESTAMP", "DATE", "TIME"].some((t) =>
          colType.startsWith(t),
        );

        const textOnlyOps = [
          "contains",
          "startswith",
          "endswith",
          "notcontains",
          "notstartswith",
          "notendswith",
        ];
        const numericOps = ["gt", "gte", "lt", "lte"];
        const arrayOnlyOps = ["hasany", "hasevery"];
        const basicOps = ["eq", "not"];

        if (colDef) {
          if (isArrayCol && !arrayOnlyOps.includes(opLower)) {
            throw new MormError(
              {
                code: "MORM_INVALID_OPERATOR",
                message: `Operator "${opLower}" cannot be used on array column "${keyLower}"`,
                column: keyLower,
              },
              "find",
              table,
            );
          }
          if (arrayOnlyOps.includes(opLower) && !isArrayCol) {
            throw new MormError(
              {
                code: "MORM_INVALID_OPERATOR",
                message: `Operator "${opLower}" can only be used on array columns. Column "${keyLower}" is type "${colDef.type}"`,
                column: keyLower,
              },
              "find",
              table,
            );
          }
          if (textOnlyOps.includes(opLower) && !isTextCol) {
            throw new MormError(
              {
                code: "MORM_INVALID_OPERATOR",
                message: `Operator "${opLower}" can only be used on text columns. Column "${keyLower}" is type "${colDef.type}"`,
                column: keyLower,
              },
              "find",
              table,
            );
          }
          if (numericOps.includes(opLower) && (isBoolCol || isTextCol)) {
            throw new MormError(
              {
                code: "MORM_INVALID_OPERATOR",
                message: `Operator "${opLower}" cannot be used on ${isBoolCol ? "boolean" : "text"} column "${keyLower}"`,
                column: keyLower,
              },
              "find",
              table,
            );
          }
          if (
            (opLower === "eq" ||
              opLower === "not" ||
              numericOps.includes(opLower)) &&
            opVal !== null
          ) {
            if (isNumberCol && typeof opVal !== "number") {
              throw new MormError(
                {
                  code: "MORM_INVALID_VALUE",
                  message: `Operator "${opLower}" expects a number value, got "${typeof opVal}" for column "${keyLower}"`,
                  column: keyLower,
                },
                "find",
                table,
              );
            }
            if (isBoolCol && typeof opVal !== "boolean") {
              throw new MormError(
                {
                  code: "MORM_INVALID_VALUE",
                  message: `Operator "${opLower}" expects a boolean value, got "${typeof opVal}" for column "${keyLower}"`,
                  column: keyLower,
                },
                "find",
                table,
              );
            }

            if (textOnlyOps.includes(opLower) && typeof opVal !== "string") {
              throw new MormError(
                {
                  code: "MORM_INVALID_VALUE",
                  message: `Operator "${opLower}" on column "${keyLower}" expects a string value`,
                  column: keyLower,
                },
                "find",
                table,
              );
            }
            if (arrayOnlyOps.includes(opLower) && !Array.isArray(opVal)) {
              throw new MormError(
                {
                  code: "MORM_INVALID_VALUE",
                  message: `Operator "${opLower}" on column "${keyLower}" expects an array value`,
                  column: keyLower,
                },
                "find",
                table,
              );
            }
          }
        }
        switch (opLower) {
          case "eq":
            if (opVal === null) {
              opParts.push(`${col} IS NULL`);
            } else {
              const isInsensitive =
                (ops as any).mode === "insensitive" ||
                queryMode === "insensitive";
              params.push(isInsensitive ? String(opVal).toLowerCase() : opVal);
              opParts.push(
                isInsensitive
                  ? `LOWER(${col}) = $${params.length}`
                  : `${col} = $${params.length}`,
              );
            }
            break;
          case "not":
            if (opVal === null) {
              opParts.push(`${col} IS NOT NULL`);
            } else {
              const isInsensitive =
                (ops as any).mode === "insensitive" ||
                queryMode === "insensitive";
              params.push(isInsensitive ? String(opVal).toLowerCase() : opVal);
              opParts.push(
                isInsensitive
                  ? `LOWER(${col}) != $${params.length}`
                  : `${col} != $${params.length}`,
              );
            }
            break;
          case "mode":
            break; // handled in eq/not
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
          case "notcontains":
            params.push(`%${opVal}%`);
            opParts.push(`${col} NOT ILIKE $${params.length}`);
            break;
          case "notstartswith":
            params.push(`${opVal}%`);
            opParts.push(`${col} NOT ILIKE $${params.length}`);
            break;
          case "notendswith":
            params.push(`%${opVal}`);
            opParts.push(`${col} NOT ILIKE $${params.length}`);
            break;
          case "hasany":
          case "hasevery": {
            params.push(opVal);
            opParts.push(
              opLower === "hasany"
                ? `${col} && $${params.length}`
                : `${col} @> $${params.length}`,
            );
            break;
          }
          default:
            throw new MormError(
              {
                code: "MORM_INVALID_OPERATOR",
                message: `Unknown operator "${op}" on column "${keyLower}"`,
                column: keyLower,
              },
              "find",
              table,
            );
        }
      }

      if (opParts.length > 0) {
        parts.push(opParts.join(" AND "));
      }
      continue;
    }

    /* ---- Basic equality ---- */
    const basicColDef = columns?.find((c: any) => c.name === keyLower);
    const basicColType = String(basicColDef?.type ?? "").toUpperCase();
    const basicIsTextCol = ["TEXT", "VARCHAR", "CHAR"].some((t) =>
      basicColType.startsWith(t),
    );

    if (queryMode === "insensitive" && basicIsTextCol) {
      params.push(String(value).toLowerCase());
      parts.push(`LOWER(${col}) = $${params.length}`);
    } else {
      params.push(value);
      parts.push(`${col} = $${params.length}`);
    }
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
    mode,
  } = normalized as any;

  /* ---- Validate mode ---- */
  if (mode !== undefined && mode !== "sensitive" && mode !== "insensitive") {
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: `Invalid mode "${mode}" — must be "sensitive" or "insensitive"`,
      },
      "find",
      table,
    );
  }

  const params: any[] = [];

  /* ---- Aggregation ---- */
  const isAgg = hasAggregation(normalized);

  if (isAgg) {
    const aggSQL = buildAggregationSQL(normalized, table);
    let sql = `SELECT ${aggSQL} FROM ${q(table)}`;
    if (where) {
      const whereSQL = buildWhere(
        normalizeKeys(where),
        params,
        table,
        columns,
        table,
        mode,
      );
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
    const whereSQL = buildWhere(
      normalizeKeys(where),
      params,
      table,
      columns,
      table,
      mode,
    );
    if (whereSQL !== "TRUE") sql += ` WHERE ${whereSQL}`;
  }

  /* ---- After (cursor) ---- */
  if (after && Object.keys(after).length > 0) {
    const cursorCol = Object.keys(after)[0]!.toLowerCase();
    const cursorVal = Object.values(after)[0];

    if (cursorVal !== null && cursorVal !== undefined) {
      const effectiveOrderBy =
        !orderBy || Object.keys(orderBy).length === 0
          ? { [cursorCol]: "asc" }
          : orderBy;

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

      const firstOrderCol = Object.keys(effectiveOrderBy)[0]!.toLowerCase();
      const firstOrderDir = Object.values(effectiveOrderBy)[0];
      const operator =
        String(firstOrderDir).toUpperCase() === "DESC" ? "<" : ">";

      let cursorResult: any;
      try {
        cursorResult = await client.query(
          `SELECT ${q(firstOrderCol)} FROM ${q(table)} WHERE ${q(cursorCol)} = $1 LIMIT 1`,
          [cursorVal],
        );
      } catch (err: any) {
        throw new MormError(
          {
            code: "MORM_INVALID_CURSOR",
            message: `Invalid cursor value "${cursorVal}" for column "${cursorCol}"`,
            column: cursorCol,
          },
          "find",
          table,
        );
      }

      if (cursorResult.rows.length === 0) {
        throw new MormError(
          {
            code: "MORM_INVALID_CURSOR",
            message: `Cursor row not found for column "${cursorCol}" with value "${cursorVal}"`,
            column: cursorCol,
          },
          "find",
          table,
        );
      }

      const cursorValue = cursorResult.rows[0][firstOrderCol];
      const connector = sql.includes("WHERE") ? " AND" : " WHERE";
      params.push(cursorValue);
      sql += `${connector} ${q(table)}.${q(firstOrderCol)} ${operator} $${params.length}`;
    }
  }

  /* ---- Order by ---- */
  const orderParts: string[] = [];

  // Distinct columns must come first in ORDER BY
  if (distinct && Object.keys(distinct).length > 0) {
    for (const col of Object.keys(distinct)) {
      const colLower = col.toLowerCase();
      // Use developer's direction if explicitly provided, else default ASC
      const dir =
        orderBy && (orderBy as any)[colLower]
          ? String((orderBy as any)[colLower]).toUpperCase() === "DESC"
            ? "DESC"
            : "ASC"
          : "ASC";
      orderParts.push(`${q(table)}.${q(colLower)} ${dir}`);
    }
  }

  if (orderBy && Object.keys(orderBy).length > 0) {
    for (const [col, dir] of Object.entries(orderBy)) {
      const colLower = col.toLowerCase();
      if (!distinct || !(distinct as any)[colLower]) {
        orderParts.push(
          `${q(table)}.${q(colLower)} ${String(dir).toUpperCase() === "DESC" ? "DESC" : "ASC"}`,
        );
      }
    }
  }

  if (orderParts.length > 0) {
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }
  /* ---- Pagination ---- */
  const takeNum = take !== undefined ? parseInt(String(take)) : undefined;
  if (takeNum === 0) {
    return [];
  }
  if (takeNum !== undefined && takeNum > 0) {
    sql += ` LIMIT ${takeNum}`;
  }

  /* ---- Validate page and after not used together ---- */
  if (page && after && Object.keys(after).length > 0) {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"page" and "after" cannot be used together — use either offset pagination or cursor pagination`,
      },
      "find",
      table,
    );
  }

  if (page && !after) {
    if (parseInt(String(page)) > 1 && !take) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"page" greater than 1 requires "take" to be set`,
        },
        "find",
        table,
      );
    }
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
    const whereSQL = buildWhere(
      normalizeKeys(where),
      params,
      table,
      columns,
      table,
    );
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
