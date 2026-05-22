// query/validation/columnUtils.ts

import { MormError } from "../../utils/queryError.js";
import type { QueryOperation } from "../../utils/queryError.js";
import {
  resolveProjection,
  type ExcludeClause,
  type IncludeClause,
  type WhereClause,
} from "../index.js";

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
  relations?: { incoming: any[]; outgoing: any[] },
): void {
  const relationTables = new Set([
    ...(relations?.incoming ?? []).map((r: any) =>
      String(r.fromTable).toLowerCase(),
    ),
    ...(relations?.outgoing ?? []).map((r: any) =>
      String(r.toTable).toLowerCase(),
    ),
  ]);

  for (const [col, val] of Object.entries(include)) {
    const colLower = col.toLowerCase();
    const isColumn = columns.some(
      (c: any) => c.name === colLower && !c.__virtual,
    );
    const isRelation = relationTables.has(colLower);

    if (!isColumn && !isRelation) {
      throw new MormError(
        {
          code: "MORM_INVALID_COLUMN",
          message: `"include.${col}" is not a column or relation on table "${table}"`,
          column: col,
        },
        operation,
        table,
      );
    }

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

export function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

/* ===================================================== */
/* WHERE BUILDER                                         */
/* ===================================================== */

export function buildWhere(
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

export function buildSelectColumns(
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

export function buildAggregationSQL(
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

export function parseAggregationResult(
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
