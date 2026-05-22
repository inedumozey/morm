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

export function validateNumericString(
  val: any,
  colName: string,
  table: string,
  operation: QueryOperation,
  colType?: string,
): void {
  if (typeof val !== "string") return;

  const isInteger = colType
    ? ["INT", "INTEGER", "BIGINT", "SMALLINT"].some((t) =>
        colType.toUpperCase().startsWith(t),
      )
    : false;

  const integerRegex = /^-?\d+$/;
  const decimalRegex = /^-?\d+(\.\d+)?$/;
  const regex = isInteger ? integerRegex : decimalRegex;

  if (!regex.test(val.trim())) {
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: isInteger
          ? `Invalid value "${val}" for column "${colName}" — expected a whole number or numeric string`
          : `Invalid value "${val}" for column "${colName}" — expected a number or numeric string`,
        column: colName,
      },
      operation,
      table,
    );
  }
}

export function buildDateComparison(
  col: string,
  operator: string,
  paramIndex: number,
): string {
  return `DATE_TRUNC('milliseconds', ${col}) ${operator} $${paramIndex}::timestamptz`;
}

export type MaybeFunction<T> = T | (() => T) | (() => Promise<T>);

export async function resolveValue<T>(val: MaybeFunction<T>): Promise<T> {
  return typeof val === "function" ? await (val as () => Promise<T>)() : val;
}

export async function resolveObject<T extends Record<string, any>>(
  obj: T,
): Promise<T> {
  const result: any = {};
  for (const [key, val] of Object.entries(obj)) {
    const resolved = typeof val === "function" ? await val() : val;
    if (Array.isArray(resolved)) {
      result[key] = await Promise.all(
        resolved.map((item) =>
          typeof item === "function"
            ? item()
            : typeof item === "object" &&
                item !== null &&
                !(item instanceof Date)
              ? resolveObject(item)
              : item,
        ),
      );
    } else if (
      resolved !== null &&
      typeof resolved === "object" &&
      !(resolved instanceof Date)
    ) {
      result[key] = await resolveObject(resolved);
    } else {
      result[key] = resolved;
    }
  }
  return result as T;
}

function parseDate(val: string): Date {
  return new Date(`${val}T00:00:00.000Z`);
}

export function parseDateColumns(
  rows: Record<string, any>[],
  columns: any[],
): Record<string, any>[] {
  const dateCols = columns.filter(
    (c: any) =>
      String(c.type).toUpperCase() === "DATE" ||
      String(c.type).toUpperCase() === "DATE[]",
  );

  if (dateCols.length === 0) return rows;

  return rows.map((row) => {
    const out = { ...row };
    for (const col of dateCols) {
      if (out[col.name] === null || out[col.name] === undefined) continue;
      const isArray = String(col.type).toUpperCase() === "DATE[]";
      if (isArray) {
        // Handle PostgreSQL array string format: '{2024-01-01,2024-06-15}'
        let arr = out[col.name];
        if (typeof arr === "string") {
          arr = arr
            .replace(/^\{|\}$/g, "")
            .split(",")
            .filter(Boolean);
        }
        if (Array.isArray(arr)) {
          out[col.name] = arr.map((v: any) =>
            typeof v === "string" ? parseDate(v) : v,
          );
        }
      } else if (!isArray && typeof out[col.name] === "string") {
        out[col.name] = parseDate(out[col.name]);
      }
    }
    return out;
  });
}
