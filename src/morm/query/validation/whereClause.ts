// query/validation/whereClause.ts

import { MormError } from "../../utils/queryError.js";
import type { QueryOperation } from "../../utils/queryError.js";
import {
  isTextCol,
  isNumberCol,
  isArrayCol,
  isBoolCol,
  isDateCol,
  getAllowedOperators,
  validateColumnExists,
  validateNumericString,
} from "./queryUtility.js";

/* ===================================================== */
/* VALID OPERATORS PER VALUE TYPE                       */
/* ===================================================== */

const TEXT_ONLY_OPS = new Set([
  "contains",
  "startswith",
  "endswith",
  "notcontains",
  "notstartswith",
  "notendswith",
]);

const NUMERIC_OPS = new Set(["gt", "gte", "lt", "lte"]);
const ARRAY_ONLY_OPS = new Set(["hasany", "hasevery"]);

/* ===================================================== */
/* VALIDATE OPERATOR VALUE                              */
/* ===================================================== */

function validateOperatorValue(
  op: string,
  val: any,
  colName: string,
  colType: string,
  table: string,
  operation: QueryOperation,
): void {
  const opLower = op.toLowerCase();

  // null is always valid for eq/not
  if (val === null && (opLower === "eq" || opLower === "not")) return;

  // text operators expect string value
  if (TEXT_ONLY_OPS.has(opLower) && typeof val !== "string") {
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: `Operator "${opLower}" on column "${colName}" expects a string value`,
        column: colName,
      },
      operation,
      table,
    );
  }

  // array operators expect array value
  if (ARRAY_ONLY_OPS.has(opLower) && !Array.isArray(val)) {
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: `Operator "${opLower}" on column "${colName}" expects an array value`,
        column: colName,
      },
      operation,
      table,
    );
  }

  // number columns expect number values for eq/not/numeric ops
  if (isNumberCol(colType) && val !== null) {
    if (
      (opLower === "eq" || opLower === "not" || NUMERIC_OPS.has(opLower)) &&
      typeof val !== "number" &&
      typeof val !== "string"
    ) {
      throw new MormError(
        {
          code: "MORM_INVALID_VALUE",
          message: `Operator "${opLower}" expects a number or numeric string for column "${colName}"`,
          column: colName,
        },
        operation,
        table,
      );
    }
    if (
      (opLower === "eq" || opLower === "not" || NUMERIC_OPS.has(opLower)) &&
      typeof val === "string"
    ) {
      validateNumericString(val, colName, table, operation, colType);
    }
  }

  // boolean columns expect boolean values
  if (isBoolCol(colType) && val !== null) {
    if ((opLower === "eq" || opLower === "not") && typeof val !== "boolean") {
      throw new MormError(
        {
          code: "MORM_INVALID_VALUE",
          message: `Operator "${opLower}" expects a boolean value, got "${typeof val}" for column "${colName}"`,
          column: colName,
        },
        operation,
        table,
      );
    }
  }
}

/* ===================================================== */
/* VALIDATE COLUMN VALUE                                */
/* ===================================================== */

function validateColumnValue(
  colName: string,
  value: any,
  columns: any[],
  table: string,
  operation: QueryOperation,
): void {
  const colDef = columns.find((c: any) => c.name === colName);
  if (!colDef) return; // already validated by validateColumnExists

  const colType = String(colDef.type);

  // null is always valid
  if (value === null) return;

  // array column — only ArrayOperators allowed
  if (isArrayCol(colType)) {
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new MormError(
        {
          code: "MORM_INVALID_VALUE",
          message: `Array column "${colName}" expects an operator object e.g. { hasAny: [...] } or { hasEvery: [...] }`,
          column: colName,
        },
        operation,
        table,
      );
    }
    // validate operators
    for (const [op, opVal] of Object.entries(value as Record<string, any>)) {
      const opLower = op.toLowerCase();
      const allowed = getAllowedOperators(colType);
      if (!allowed.has(opLower)) {
        throw new MormError(
          {
            code: "MORM_INVALID_OPERATOR",
            message: `Operator "${op}" cannot be used on array column "${colName}" — allowed: hasAny, hasEvery`,
            column: colName,
          },
          operation,
          table,
        );
      }
      validateOperatorValue(opLower, opVal, colName, colType, table, operation);
    }
    return;
  }

  // boolean column
  if (isBoolCol(colType)) {
    if (typeof value === "boolean") return;
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [op, opVal] of Object.entries(value as Record<string, any>)) {
        const opLower = op.toLowerCase();
        if (opLower === "mode") continue;
        const allowed = getAllowedOperators(colType);
        if (!allowed.has(opLower)) {
          throw new MormError(
            {
              code: "MORM_INVALID_OPERATOR",
              message: `Operator "${op}" cannot be used on boolean column "${colName}" — allowed: eq, not`,
              column: colName,
            },
            operation,
            table,
          );
        }
        validateOperatorValue(
          opLower,
          opVal,
          colName,
          colType,
          table,
          operation,
        );
      }
      return;
    }
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: `Boolean column "${colName}" expects a boolean value or operator object`,
        column: colName,
      },
      operation,
      table,
    );
  }

  // number column
  if (isNumberCol(colType)) {
    if (typeof value === "number") return;
    if (typeof value === "string") {
      validateNumericString(value, colName, table, operation, colType);
      return;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [op, opVal] of Object.entries(value as Record<string, any>)) {
        const opLower = op.toLowerCase();
        if (opLower === "mode") continue;
        const allowed = getAllowedOperators(colType);
        if (!allowed.has(opLower)) {
          throw new MormError(
            {
              code: "MORM_INVALID_OPERATOR",
              message: `Operator "${op}" cannot be used on number column "${colName}" — allowed: eq, not, gt, gte, lt, lte`,
              column: colName,
            },
            operation,
            table,
          );
        }
        validateOperatorValue(
          opLower,
          opVal,
          colName,
          colType,
          table,
          operation,
        );
      }
      return;
    }
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: `Number column "${colName}" expects a number value or operator object`,
        column: colName,
      },
      operation,
      table,
    );
  }

  // text column
  if (isTextCol(colType)) {
    if (typeof value === "string") return;
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [op, opVal] of Object.entries(value as Record<string, any>)) {
        const opLower = op.toLowerCase();
        if (opLower === "mode") continue;
        const allowed = getAllowedOperators(colType);
        if (!allowed.has(opLower)) {
          throw new MormError(
            {
              code: "MORM_INVALID_OPERATOR",
              message: `Operator "${op}" cannot be used on text column "${colName}" — allowed: eq, not, contains, startsWith, endsWith, notContains, notStartsWith, notEndsWith`,
              column: colName,
            },
            operation,
            table,
          );
        }
        validateOperatorValue(
          opLower,
          opVal,
          colName,
          colType,
          table,
          operation,
        );
      }
      return;
    }
    throw new MormError(
      {
        code: "MORM_INVALID_VALUE",
        message: `Text column "${colName}" expects a string value or operator object`,
        column: colName,
      },
      operation,
      table,
    );
  }

  // date column
  if (isDateCol(colType)) {
    if (typeof value === "string") return;
    if (value instanceof Date) return;
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [op, opVal] of Object.entries(value as Record<string, any>)) {
        const opLower = op.toLowerCase();
        if (opLower === "mode") continue;
        const allowed = getAllowedOperators(colType);
        if (!allowed.has(opLower)) {
          throw new MormError(
            {
              code: "MORM_INVALID_OPERATOR",
              message: `Operator "${op}" cannot be used on date column "${colName}" — allowed: eq, not, gt, gte, lt, lte`,
              column: colName,
            },
            operation,
            table,
          );
        }
      }
      return;
    }
  }
}

/* ===================================================== */
/* MAIN WHERE CLAUSE VALIDATOR                          */
/* ===================================================== */

export function validateWhereClause(
  where: Record<string, any>,
  columns: any[],
  table: string,
  operation: QueryOperation,
): void {
  if (!where || typeof where !== "object" || Array.isArray(where)) {
    throw new MormError(
      {
        code: "MORM_INVALID_CLAUSE",
        message: `"where" received an invalid value — expected an object e.g. where: { ... }`,
      },
      operation,
      table,
    );
  }

  for (const [key, value] of Object.entries(where)) {
    const keyLower = key.toLowerCase();

    /* ---- and/or ---- */
    if (keyLower === "and" || keyLower === "or") {
      if (!Array.isArray(value)) {
        throw new MormError(
          {
            code: "MORM_INVALID_CLAUSE",
            message: `"${keyLower}" received an invalid value — expected an array e.g. ${keyLower}: [{ ... }, { ... }]`,
          },
          operation,
          table,
        );
      }
      for (const item of value) {
        if (typeof item !== "object" || Array.isArray(item) || item === null) {
          throw new MormError(
            {
              code: "MORM_INVALID_CLAUSE",
              message: `"${keyLower}" array items must be objects e.g. ${keyLower}: [{ column: value }]`,
            },
            operation,
            table,
          );
        }
        // Recurse
        validateWhereClause(item, columns, table, operation);
      }
      continue;
    }

    /* ---- column validation ---- */
    validateColumnExists(keyLower, columns, table, operation);
    validateColumnValue(keyLower, value, columns, table, operation);
  }
}
