// query/runFind.ts

import { MormError, throwQueryError } from "../utils/queryError.js";
import { validateFindClause } from "./validation/findClause.js";
import { normalizeKeys, hasAggregation, type FindClause } from "./index.js";
import { validateWhereClause } from "./validation/whereClause.js";
import {
  parseDateColumns,
  resolveObject,
  buildWhere,
  resolveValue,
  buildSelectColumns,
  validateColumnExists,
  parseAggregationResult,
  q,
  buildAggregationSQL,
} from "./validation/queryUtility.js";
import { loadRelations } from "./loadRelations.js";

export async function runFind(
  client: any,
  model: any,
  clause: FindClause = {},
  debug = false,
  modelMap?: Map<string, any>,
  _fkFilter?: { column: string; values: any[] },
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
  validateFindClause(resolvedNormalized, table, columns, model);
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

    if (_fkFilter) {
      params.push(_fkFilter.values);
      sql += ` WHERE ${q(table)}.${q(_fkFilter.column)} = ANY($${params.length})`;
    }

    if (where) {
      const whereSQL = buildWhere(
        normalizeKeys(where),
        params,
        table,
        columns,
        table,
        mode,
      );
      if (whereSQL !== "TRUE") {
        sql += _fkFilter ? ` AND ${whereSQL}` : ` WHERE ${whereSQL}`;
      }
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
  if (_fkFilter) {
    params.push(_fkFilter.values);
    sql += ` WHERE ${q(table)}.${q(_fkFilter.column)} = ANY($${params.length})`;
  }

  if (where) {
    const whereSQL = buildWhere(
      normalizeKeys(where),
      params,
      table,
      columns,
      table,
      mode,
    );
    if (whereSQL !== "TRUE") {
      sql += _fkFilter ? ` AND ${whereSQL}` : ` WHERE ${whereSQL}`;
    }
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
    let rows = parseDateColumns(result.rows, columns) as Record<string, any>[];

    /* ---- Load relations ---- */
    if (include && modelMap) {
      rows = await loadRelations(client, model, rows, include, modelMap, debug);
    }

    return rows;
  } catch (err: any) {
    if (err.code === "22P02" && after) return [];
    throwQueryError(err, "find", table);
  }
}
