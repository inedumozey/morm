// query/validation/columnUtils.ts

import { MormError } from "../../utils/queryError.js";
import type { QueryOperation } from "../../utils/queryError.js";

/* ===================================================== */
/* COLUMN TYPE CHECKERS                                  */
/* ===================================================== */

export function isTextCol(type: string): boolean {
  const t = type.toUpperCase();
  return ["TEXT", "VARCHAR", "CHAR"].some((p) => t.startsWith(p));
}

export function isNumberCol(type: string): boolean {
  const t = type.toUpperCase();
  return [
    "INT",
    "INTEGER",
    "BIGINT",
    "SMALLINT",
    "NUMERIC",
    "DECIMAL",
    "REAL",
    "FLOAT8",
  ].some((p) => t.startsWith(p));
}

export function isArrayCol(type: string): boolean {
  return type.toUpperCase().endsWith("[]");
}

export function isBoolCol(type: string): boolean {
  return type.toUpperCase() === "BOOLEAN";
}

export function isDateCol(type: string): boolean {
  const t = type.toUpperCase();
  return ["TIMESTAMP", "DATE", "TIME"].some((p) => t.startsWith(p));
}

export function getColCategory(
  type: string,
): "text" | "number" | "boolean" | "array" | "date" | "unknown" {
  if (isArrayCol(type)) return "array";
  if (isTextCol(type)) return "text";
  if (isNumberCol(type)) return "number";
  if (isBoolCol(type)) return "boolean";
  if (isDateCol(type)) return "date";
  return "unknown";
}

/* ===================================================== */
/* ALLOWED OPERATORS PER COLUMN TYPE                    */
/* ===================================================== */

export const TEXT_OPERATORS = new Set([
  "eq",
  "not",
  "contains",
  "startswith",
  "endswith",
  "notcontains",
  "notstartswith",
  "notendswith",
  "mode",
]);

export const NUMBER_OPERATORS = new Set([
  "eq",
  "not",
  "gt",
  "gte",
  "lt",
  "lte",
]);

export const BOOLEAN_OPERATORS = new Set(["eq", "not"]);

export const ARRAY_OPERATORS = new Set(["hasany", "hasevery"]);

export const DATE_OPERATORS = new Set(["eq", "not", "gt", "gte", "lt", "lte"]);

export function getAllowedOperators(type: string): Set<string> {
  const category = getColCategory(type);
  switch (category) {
    case "text":
      return TEXT_OPERATORS;
    case "number":
      return NUMBER_OPERATORS;
    case "boolean":
      return BOOLEAN_OPERATORS;
    case "array":
      return ARRAY_OPERATORS;
    case "date":
      return DATE_OPERATORS;
    default:
      return new Set([
        ...TEXT_OPERATORS,
        ...NUMBER_OPERATORS,
        ...ARRAY_OPERATORS,
      ]);
  }
}

/* ===================================================== */
/* COLUMN EXISTENCE VALIDATOR                           */
/* ===================================================== */

export function validateColumnExists(
  colName: string,
  columns: any[],
  table: string,
  operation: QueryOperation,
): any {
  const colDef = columns.find((c: any) => c.name === colName.toLowerCase());
  if (!colDef) {
    throw new MormError(
      {
        code: "MORM_INVALID_COLUMN",
        message: `Column "${colName}" does not exist on table "${table}"`,
        column: colName,
      },
      operation,
      table,
    );
  }
  return colDef;
}

/* ===================================================== */
/* REUSABLE CLAUSE VALIDATORS                           */
/* ===================================================== */

export function validateOrderBy(
  orderBy: Record<string, any>,
  columns: any[],
  table: string,
  operation: QueryOperation,
): void {
  const validDirections = new Set(["asc", "desc"]);
  for (const [col, dir] of Object.entries(orderBy)) {
    validateColumnExists(col, columns, table, operation);
    if (!validDirections.has(String(dir).toLowerCase())) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"orderBy.${col}" received an invalid direction "${dir}" — expected "asc" or "desc"`,
        },
        operation,
        table,
      );
    }
  }
}

export function validateInclude(
  include: Record<string, any>,
  columns: any[],
  table: string,
  operation: QueryOperation,
): void {
  for (const [col, val] of Object.entries(include)) {
    validateColumnExists(col, columns, table, operation);
    if (val !== true && (typeof val !== "object" || Array.isArray(val))) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"include.${col}" received an invalid value — expected true or a relation object`,
        },
        operation,
        table,
      );
    }
  }
}

export function validateExclude(
  exclude: Record<string, any>,
  columns: any[],
  table: string,
  operation: QueryOperation,
): void {
  for (const [col, val] of Object.entries(exclude)) {
    validateColumnExists(col, columns, table, operation);
    if (val !== true) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"exclude.${col}" received an invalid value — expected true`,
        },
        operation,
        table,
      );
    }
  }
}

export function validateDistinct(
  distinct: Record<string, any>,
  columns: any[],
  table: string,
  operation: QueryOperation,
): void {
  for (const [col, val] of Object.entries(distinct)) {
    validateColumnExists(col, columns, table, operation);
    if (val !== true) {
      throw new MormError(
        {
          code: "MORM_INVALID_CLAUSE",
          message: `"distinct.${col}" received an invalid value — expected true`,
          column: col,
        },
        operation,
        table,
      );
    }
  }
}

export function validateMode(
  mode: any,
  table: string,
  operation: QueryOperation,
): void {
  if (mode !== undefined && mode !== "sensitive" && mode !== "insensitive") {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"mode" received an invalid value — expected "sensitive" or "insensitive"`,
      },
      operation,
      table,
    );
  }
}
