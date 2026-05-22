// query/findOne.ts

import { MormError, throwQueryError } from "../utils/queryError.js";
import { normalizeKeys, type FindOneClause } from "./index.js";
import { validateWhereClause } from "./validation/whereClause.js";
import {
  buildSelectColumns,
  buildWhere,
  parseDateColumns,
  q,
  resolveObject,
  resolveValue,
} from "./validation/queryUtility.js";
import { loadRelations } from "./loadRelations.js";

/* ===================================================== */
/* FIND ONE                                              */
/* ===================================================== */

export async function runFindOne(
  client: any,
  model: any,
  clause: FindOneClause = {},
  debug = false,
  modelMap?: Map<string, any>,
): Promise<Record<string, any> | null> {
  const start = Date.now();
  const normalized = normalizeKeys(clause) as FindOneClause;
  const { columns, table } = model;

  const {
    where: whereRaw,
    include: include_raw,
    exclude: exclude_raw,
    mode: mode_raw,
  } = normalized as any;

  /* ---- Resolve functions ---- */
  const whereResolved =
    typeof whereRaw === "function" ? await whereRaw() : whereRaw;
  const where = whereResolved
    ? await resolveObject(whereResolved)
    : whereResolved;

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

  const mode =
    typeof mode_raw === "function" ? await resolveValue(mode_raw) : mode_raw;

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

    validateWhereClause(normalizeKeys(where), columns, table, "findOne");
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
      mode,
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
    let row = result.rows[0] ?? null;
    if (!row) return null;
    const parsed = parseDateColumns([row], columns);
    row = parsed[0] ?? null;
    if (!row) return null;

    /* ---- Load relations ---- */
    if (include && modelMap) {
      const withRelations = await loadRelations(
        client,
        model,
        [row],
        include,
        modelMap,
        debug,
      );
      return withRelations[0] ?? null;
    }

    return row;
  } catch (err: any) {
    throwQueryError(err, "findOne", table);
  }
}
