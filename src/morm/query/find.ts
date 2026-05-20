// query/find.ts

import { MormError, throwQueryError } from "../utils/queryError.js";
import { validateFindClause } from "./validation/findClause.js";
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

import { validateWhereClause } from "./validation/whereClause.js";
import {
  buildDateComparison,
  resolveObject,
  resolveValue,
  validateColumnExists,
} from "./validation/queryUtility.js";

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
  validateFindClause;

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
              const fieldMode = (ops as any).mode;
              const isInsensitive =
                fieldMode !== undefined
                  ? fieldMode === "insensitive"
                  : queryMode === "insensitive";
              if (isDateCol) {
                params.push(opVal);
                opParts.push(buildDateComparison(col, "=", params.length));
              } else {
                params.push(
                  isInsensitive ? String(opVal).toLowerCase() : opVal,
                );
                opParts.push(
                  isInsensitive
                    ? `LOWER(${col}) = $${params.length}`
                    : `${col} = $${params.length}`,
                );
              }
            }
            break;
          case "not":
            if (opVal === null) {
              opParts.push(`${col} IS NOT NULL`);
            } else {
              const fieldMode = (ops as any).mode;
              const isInsensitive =
                fieldMode !== undefined
                  ? fieldMode === "insensitive"
                  : queryMode === "insensitive";
              if (isDateCol) {
                params.push(opVal);
                opParts.push(buildDateComparison(col, "!=", params.length));
              } else {
                params.push(
                  isInsensitive ? String(opVal).toLowerCase() : opVal,
                );
                opParts.push(
                  isInsensitive
                    ? `LOWER(${col}) != $${params.length}`
                    : `${col} != $${params.length}`,
                );
              }
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
          case "contains": {
            const isInsensitive =
              (ops as any).mode === "insensitive" ||
              queryMode === "insensitive";
            params.push(`%${opVal}%`);
            opParts.push(
              `${col} ${isInsensitive ? "ILIKE" : "LIKE"} $${params.length}`,
            );
            break;
          }
          case "startswith": {
            const isInsensitive =
              (ops as any).mode === "insensitive" ||
              queryMode === "insensitive";
            params.push(`${opVal}%`);
            opParts.push(
              `${col} ${isInsensitive ? "ILIKE" : "LIKE"} $${params.length}`,
            );
            break;
          }
          case "endswith": {
            const isInsensitive =
              (ops as any).mode === "insensitive" ||
              queryMode === "insensitive";
            params.push(`%${opVal}`);
            opParts.push(
              `${col} ${isInsensitive ? "ILIKE" : "LIKE"} $${params.length}`,
            );
            break;
          }
          case "notcontains": {
            const isInsensitive =
              (ops as any).mode === "insensitive" ||
              queryMode === "insensitive";
            params.push(`%${opVal}%`);
            opParts.push(
              `${col} ${isInsensitive ? "NOT ILIKE" : "NOT LIKE"} $${params.length}`,
            );
            break;
          }
          case "notstartswith": {
            const isInsensitive =
              (ops as any).mode === "insensitive" ||
              queryMode === "insensitive";
            params.push(`${opVal}%`);
            opParts.push(
              `${col} ${isInsensitive ? "NOT ILIKE" : "NOT LIKE"} $${params.length}`,
            );
            break;
          }
          case "notendswith": {
            const isInsensitive =
              (ops as any).mode === "insensitive" ||
              queryMode === "insensitive";
            params.push(`%${opVal}`);
            opParts.push(
              `${col} ${isInsensitive ? "NOT ILIKE" : "NOT LIKE"} $${params.length}`,
            );
            break;
          }
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
    const basicIsDateCol = ["TIMESTAMP", "DATE", "TIME"].some((t) =>
      basicColType.startsWith(t),
    );

    if (basicIsDateCol) {
      params.push(value);
      parts.push(buildDateComparison(col, "=", params.length));
    } else if (queryMode === "insensitive" && basicIsTextCol) {
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

function buildAggregationSQL(
  clause: Record<string, any>,
  table: string,
): string {
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
  clause: Record<string, any>,
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
    include: include_raw,
    exclude: exclude_raw,
    where: whereRaw,
    orderby: orderByRaw,
    take: takeRaw,
    page: pageRaw,
    after: afterRaw,
    distinct: distinct_raw,
    mode: mode_raw,
  } = normalized as any;

  /* ---- Resolve functions ---- */
  const whereResolved =
    typeof whereRaw === "function" ? await whereRaw() : whereRaw;
  const where = whereResolved
    ? await resolveObject(whereResolved)
    : whereResolved;

  const orderByResolved =
    typeof orderByRaw === "function" ? await orderByRaw() : orderByRaw;
  const orderBy = orderByResolved
    ? await resolveObject(orderByResolved)
    : orderByResolved;

  const take =
    typeof takeRaw === "function" ? await resolveValue(takeRaw) : takeRaw;
  const page =
    typeof pageRaw === "function" ? await resolveValue(pageRaw) : pageRaw;

  const afterResolved =
    typeof afterRaw === "function" ? await afterRaw() : afterRaw;
  const after = afterResolved
    ? await resolveObject(afterResolved)
    : afterResolved;

  const includeResolved =
    typeof include_raw === "function" ? await include_raw() : include_raw;
  const include = includeResolved
    ? await resolveObject(includeResolved)
    : includeResolved;

  const excludeResolved =
    typeof exclude_raw === "function" ? await exclude_raw() : exclude_raw;
  const exclude = excludeResolved
    ? await resolveObject(excludeResolved)
    : excludeResolved;

  const distinctResolved =
    typeof distinct_raw === "function" ? await distinct_raw() : distinct_raw;
  const distinct = distinctResolved
    ? await resolveObject(distinctResolved)
    : distinctResolved;

  const mode =
    typeof mode_raw === "function" ? await resolveValue(mode_raw) : mode_raw;

  /* ---- Validate clause ---- */
  const sum =
    typeof (normalized as any).sum === "function"
      ? await resolveValue((normalized as any).sum)
      : (normalized as any).sum;
  const avg =
    typeof (normalized as any).avg === "function"
      ? await resolveValue((normalized as any).avg)
      : (normalized as any).avg;
  const min =
    typeof (normalized as any).min === "function"
      ? await resolveValue((normalized as any).min)
      : (normalized as any).min;
  const max =
    typeof (normalized as any).max === "function"
      ? await resolveValue((normalized as any).max)
      : (normalized as any).max;
  const count =
    typeof (normalized as any).count === "function"
      ? await resolveValue((normalized as any).count)
      : (normalized as any).count;

  const resolvedNormalized = {
    ...normalized,
    where,
    orderby: orderBy,
    take,
    page,
    after,
    include,
    exclude,
    distinct,
    mode,
    sum,
    avg,
    min,
    max,
    count,
  };
  validateFindClause(resolvedNormalized, table, columns);
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

  /* ---- Where clause ---- */
  if (where) {
    validateWhereClause(normalizeKeys(where), columns, table, "find");
  }

  const params: any[] = [];

  /* ---- Aggregation ---- */
  const isAgg = hasAggregation(resolvedNormalized as FindClause);

  if (isAgg) {
    const aggSQL = buildAggregationSQL(resolvedNormalized, table);
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
      return parseAggregationResult(result.rows[0], resolvedNormalized);
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
  if (
    after !== undefined &&
    after !== null &&
    Object.keys(after).length === 0
  ) {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"after" requires a unique or primary key column e.g. after: { id: "value" }`,
      },
      "find",
      table,
    );
  }

  if (after && Object.keys(after).length > 0) {
    const cursorCol = Object.keys(after)[0]!.toLowerCase();
    const cursorVal = Object.values(after)[0];

    // Validate cursor column exists
    const cursorColDef = validateColumnExists(
      cursorCol,
      columns,
      table,
      "find",
    );

    // Validate cursor column is unique or primary
    if (!cursorColDef.__primary && !cursorColDef.unique) {
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

    // If cursor value is null, undefined, or empty — end of data, return empty
    if (cursorVal === null || cursorVal === undefined || cursorVal === "") {
      return [];
    }

    const operator =
      orderBy && String((orderBy as any)[cursorCol]).toUpperCase() === "DESC"
        ? "<"
        : ">";
    const connector = sql.includes("WHERE") ? " AND" : " WHERE";
    params.push(cursorVal);
    sql += `${connector} ${q(table)}.${q(cursorCol)} ${operator} $${params.length}`;
  }

  /* ---- Order by ---- */
  const orderParts: string[] = [];
  const cursorCol =
    after && Object.keys(after).length > 0
      ? Object.keys(after)[0]!.toLowerCase()
      : null;

  // Cursor column always comes first in ORDER BY
  if (cursorCol) {
    const dir =
      orderBy && String((orderBy as any)[cursorCol]).toUpperCase() === "DESC"
        ? "DESC"
        : "ASC";
    orderParts.push(`${q(table)}.${q(cursorCol)} ${dir}`);
  }

  // Distinct columns must come first in ORDER BY (after cursor)
  if (distinct && Object.keys(distinct).length > 0) {
    for (const col of Object.keys(distinct)) {
      const colLower = col.toLowerCase();
      if (colLower === cursorCol) continue; // already added
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
      if (colLower === cursorCol) continue; // already added
      if (distinct && (distinct as any)[colLower]) continue;
      orderParts.push(
        `${q(table)}.${q(colLower)} ${String(dir).toUpperCase() === "DESC" ? "DESC" : "ASC"}`,
      );
    }
  }

  if (orderParts.length > 0) {
    sql += ` ORDER BY ${orderParts.join(", ")}`;
  }
  /* ---- Pagination ---- */
  const takeNum = take !== undefined ? parseInt(String(take)) : undefined;
  if (takeNum !== undefined && takeNum < 0) {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"take" must be a positive number`,
      },
      "find",
      table,
    );
  }
  if (takeNum === 0) {
    return [];
  }
  if (takeNum !== undefined && takeNum > 0) {
    sql += ` LIMIT ${takeNum}`;
  }

  if (parseInt(String(page)) < 1) {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"page" must be a positive number starting from 1`,
      },
      "find",
      table,
    );
  }

  if (page !== undefined && !after) {
    if (!take) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `page" requires "take" to be set`,
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
    const dateCols = columns.filter(
      (c: any) => String(c.type).toUpperCase() === "DATE",
    );

    if (dateCols.length > 0) {
      return result.rows.map((row: any) => {
        const out = { ...row };
        for (const col of dateCols) {
          if (out[col.name] !== null && out[col.name] !== undefined) {
            out[col.name] = new Date(out[col.name]);
          }
        }
        return out;
      });
    }

    return result.rows as Record<string, any>[];
  } catch (err: any) {
    if (err.code === "22P02" && after) return [];
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
