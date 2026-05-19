// query/validation/findClause.ts

import { MormError } from "../../utils/queryError.js";
import {
  validateColumnExists,
  validateOrderBy,
  validateInclude,
  validateExclude,
  validateDistinct,
  isNumberCol,
  validateMode,
  isDateCol,
} from "./queryUtility.js";

/* ===================================================== */
/* FIND CLAUSE VALIDATION                                */
/* ===================================================== */

export function validateFindClause(
  normalized: any,
  table: string,
  columns: any[],
): void {
  /* ---- Validate unknown keys ---- */
  const validClauseKeys = new Set([
    "where",
    "orderby",
    "distinct",
    "include",
    "exclude",
    "page",
    "after",
    "take",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "mode",
  ]);

  for (const key of Object.keys(normalized)) {
    if (!validClauseKeys.has(key.toLowerCase())) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `Unknown clause key "${key}" — valid keys are: where, orderBy, distinct, include, exclude, page, after, take, count, sum, avg, min, max, mode`,
        },
        "find",
        table,
      );
    }
  }

  /* ---- Validate object-type clauses ---- */
  for (const key of [
    "where",
    "orderby",
    "distinct",
    "include",
    "exclude",
    "after",
  ]) {
    const val = normalized[key];
    if (val !== undefined && (typeof val !== "object" || Array.isArray(val))) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"${key}" received an invalid value — expected an object e.g. ${key}: { ... }`,
        },
        "find",
        table,
      );
    }
  }

  /* ---- Validate number-type clauses ---- */
  for (const key of ["page", "take"]) {
    const val = normalized[key];
    if (val !== undefined && typeof val !== "number") {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"${key}" received an invalid value — expected a number e.g. ${key}: 10`,
        },
        "find",
        table,
      );
    }
  }

  /* ---- Validate count is boolean ---- */
  if (normalized.count !== undefined && typeof normalized.count !== "boolean") {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"count" received an invalid value — expected true or false e.g. count: true`,
      },
      "find",
      table,
    );
  }

  /* ---- Validate mode ---- */
  validateMode(normalized.mode, table, "find");

  /* ---- Validate sum/avg/min/max ---- */
  for (const key of ["sum", "avg", "min", "max"]) {
    if (!(key in normalized)) continue;
    const val = normalized[key];
    if (
      val === null ||
      val === undefined ||
      typeof val !== "string" ||
      val.trim() === ""
    ) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"${key}" received an invalid value — expected a column name e.g. ${key}: "price"`,
        },
        "find",
        table,
      );
    }
    const colDef = validateColumnExists(val, columns, table, "find");
    if ((key === "sum" || key === "avg") && !isNumberCol(String(colDef.type))) {
      throw new MormError(
        {
          code: "MORM_INVALID_OPERATOR",
          message: `"${key}" can only be used on number columns. Column "${val}" is type "${colDef.type}"`,
          column: val,
        },
        "find",
        table,
      );
    }
    if (
      (key === "min" || key === "max") &&
      !isNumberCol(String(colDef.type)) &&
      !isDateCol(String(colDef.type))
    ) {
      throw new MormError(
        {
          code: "MORM_INVALID_OPERATOR",
          message: `"${key}" can only be used on number or date columns. Column "${val}" is type "${colDef.type}"`,
          column: val,
        },
        "find",
        table,
      );
    }
  }

  /* ---- Validate orderBy ---- */
  if (normalized.orderby && Object.keys(normalized.orderby).length > 0) {
    validateOrderBy(normalized.orderby, columns, table, "find");
  }

  /* ---- Validate include ---- */
  if (normalized.include && Object.keys(normalized.include).length > 0) {
    validateInclude(normalized.include, columns, table, "find");
  }

  /* ---- Validate exclude ---- */
  if (normalized.exclude && Object.keys(normalized.exclude).length > 0) {
    validateExclude(normalized.exclude, columns, table, "find");
  }

  /* ---- Validate distinct ---- */
  if (normalized.distinct && Object.keys(normalized.distinct).length > 0) {
    validateDistinct(normalized.distinct, columns, table, "find");
  }
}
