// utils/defaultValidator.ts

import { canonicalType, stripTypeModifier } from "./canonicalType.js";

/* ===================================================== */
/* INTEGER RANGE CONSTANTS                               */
/* ===================================================== */

const INT_RANGES = {
  SMALLINT: { min: -32768, max: 32767 },
  INTEGER: { min: -2147483648, max: 2147483647 },
  BIGINT: { min: -9223372036854775808n, max: 9223372036854775807n }, // BigInt
};

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

export function isUuidLiteral(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str,
  );
}

/**
 * Check if a string is a valid ISO date string WITHOUT timezone (no Z, no +offset).
 * Valid for TIMESTAMP, DATE, TIME.
 */
function isISODateStringNoTZ(str: string): boolean {
  // Must not end with Z or contain +HH:MM or -HH:MM offset
  if (/Z$/i.test(str) || /[+-]\d{2}:\d{2}$/.test(str)) return false;
  return !isNaN(Date.parse(str));
}

/**
 * Check if a string is a valid ISO date string WITH timezone (Z or +offset).
 * Valid for TIMESTAMPTZ, TIMETZ.
 */
function isISODateStringWithTZ(str: string): boolean {
  if (!/Z$/i.test(str) && !/[+-]\d{2}:\d{2}$/.test(str)) return false;
  return !isNaN(Date.parse(str));
}

/**
 * Check if a string is a valid ISO date (date part only, no time).
 * Valid for DATE.
 */
function isISODateOnly(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

/**
 * Check if a string is a valid time string HH:MM or HH:MM:SS.
 * Valid for TIME, TIMETZ.
 */
function isTimeString(str: string): boolean {
  return /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)?$/.test(str);
}

/**
 * Validate integer is within the allowed range for the given type.
 * Uses BigInt for BIGINT to handle values beyond MAX_SAFE_INTEGER.
 */
function isInIntegerRange(
  value: any,
  type: "SMALLINT" | "INTEGER" | "BIGINT",
): boolean {
  if (type === "BIGINT") {
    try {
      const v = BigInt(Math.trunc(Number(value)));
      return v >= INT_RANGES.BIGINT.min && v <= INT_RANGES.BIGINT.max;
    } catch {
      return false;
    }
  }

  const range = INT_RANGES[type];
  const n = Number(value);

  // Reject values beyond JS safe integer range for SMALLINT/INTEGER
  if (!Number.isSafeInteger(n)) return false;

  return n >= range.min && n <= range.max;
}

/* ===================================================== */
/* SCALAR VALIDATOR                                      */
/* ===================================================== */

function isValidScalarDefault(
  value: any,
  type: string,
  enumValuesLower?: Set<string>,
  inArray = false,
): string | true {
  // Returns true if valid, or an error message string if invalid

  switch (type) {
    case "TEXT":
    case "VARCHAR":
    case "CHAR":
      if (typeof value !== "string") return `must be a string for type ${type}`;
      return true;

    case "SMALLINT": {
      // Accept string
      if (typeof value === "string") {
        if (value === "smallint()") return true;
        if (!/^-?\d+$/.test(value.trim()))
          return `string default for SMALLINT must be a whole number e.g. "42"`;
        const n = Number(value.trim());
        if (!isInIntegerRange(n, "SMALLINT"))
          return `value "${value}" exceeds SMALLINT range (-32,768 to 32,767)`;
        return true;
      }
      if (!Number.isInteger(value))
        return `must be an integer or string for SMALLINT`;
      if (!isInIntegerRange(value, "SMALLINT"))
        return `value ${value} exceeds SMALLINT range (-32,768 to 32,767)`;
      return true;
    }

    case "INTEGER": {
      // Accept string
      if (typeof value === "string") {
        if (!inArray && value === "int()") return true;
        if (!/^-?\d+$/.test(value.trim()))
          return `string default for INT/INTEGER must be a whole number e.g. "42"`;
        const n = Number(value.trim());
        if (!isInIntegerRange(n, "INTEGER"))
          return `value "${value}" exceeds INTEGER range (-2,147,483,648 to 2,147,483,647)`;
        return true;
      }
      if (!Number.isInteger(value))
        return `must be an integer or string for INT/INTEGER`;
      if (!isInIntegerRange(value, "INTEGER"))
        return `value ${value} exceeds INTEGER range (-2,147,483,648 to 2,147,483,647)`;
      return true;
    }

    case "BIGINT": {
      if (typeof value === "string" && !inArray && value === "bigint()")
        return true;

      // Accept string for large integers that exceed JS MAX_SAFE_INTEGER
      if (typeof value === "string") {
        if (!/^-?\d+$/.test(value.trim()))
          return `string default for BIGINT must be a whole number e.g. "9223372036854775807"`;
        try {
          const v = BigInt(value.trim());
          if (v < INT_RANGES.BIGINT.min || v > INT_RANGES.BIGINT.max)
            return `value "${value}" exceeds BIGINT range (-9,223,372,036,854,775,808 to 9,223,372,036,854,775,807)`;
        } catch {
          return `"${value}" is not a valid BIGINT string`;
        }
        return true;
      }

      if (!Number.isInteger(value))
        return `must be an integer or string for BIGINT`;
      if (!Number.isSafeInteger(value))
        return `value ${value} exceeds JavaScript safe integer range — use a string instead e.g. default: "${value}"`;
      if (!isInIntegerRange(value, "BIGINT"))
        return `value ${value} exceeds BIGINT range`;
      return true;
    }

    case "NUMERIC":
    case "DECIMAL":
      // Accept number for normal values
      if (typeof value === "number") return true;

      // Accept string for high-precision values JavaScript can't represent accurately
      if (typeof value === "string") {
        if (!/^-?\d+(\.\d+)?$/.test(value.trim()))
          return `string default for NUMERIC must be a valid number e.g. "12345678901234567890.12345"`;
        return true;
      }

      return `must be a number or numeric string for NUMERIC/DECIMAL`;

    case "REAL":
    case "FLOAT8":
      if (typeof value !== "number") return `must be a number for REAL/FLOAT8`;
      return true;

    case "BOOLEAN":
      if (typeof value !== "boolean")
        return `must be true or false for BOOLEAN`;
      return true;

    case "UUID":
      if (typeof value !== "string") return `must be a string for UUID`;
      if (value.toLowerCase() !== "uuid()" && !isUuidLiteral(value))
        return `must be "uuid()" or a valid UUID literal (e.g. 550e8400-e29b-41d4-a716-446655440000)`;
      return true;

    case "DATE":
      if (typeof value !== "string") return `must be a string for DATE`;
      if (value === "now()") return true;
      if (!isISODateOnly(value) && !isISODateStringNoTZ(value))
        return `must be "now()" or a valid date string (e.g. "2024-01-01") for DATE`;
      return true;

    case "TIME":
      if (typeof value !== "string") return `must be a string for TIME`;
      if (value === "now()") return true;
      if (!isTimeString(value))
        return `must be "now()" or a valid time string (e.g. "08:00:00") for TIME`;
      return true;

    case "TIMETZ":
      if (typeof value !== "string") return `must be a string for TIMETZ`;
      if (value === "now()") return true;
      if (!isTimeString(value))
        return `must be "now()" or a valid time string with timezone (e.g. "08:00:00+01:00") for TIMETZ`;
      return true;

    case "TIMESTAMP":
      if (typeof value !== "string") return `must be a string for TIMESTAMP`;
      if (value === "now()") return true;
      if (isISODateStringWithTZ(value))
        return `TIMESTAMP does not store timezone — use TIMESTAMPTZ for timezone-aware values, or remove the Z/offset`;
      if (!isISODateStringNoTZ(value) && !isISODateOnly(value))
        return `must be "now()" or a valid datetime string without timezone (e.g. "2024-01-01T08:00:00") for TIMESTAMP`;
      return true;

    case "TIMESTAMPTZ":
      if (typeof value !== "string") return `must be a string for TIMESTAMPTZ`;
      if (value === "now()") return true;
      if (
        !isISODateStringWithTZ(value) &&
        !isISODateStringNoTZ(value) &&
        !isISODateOnly(value)
      )
        return `must be "now()" or a valid datetime string (e.g. "2024-01-01T08:00:00Z") for TIMESTAMPTZ`;
      return true;

    case "BYTEA":
      // BYTEA defaults are rarely used — accept hex strings
      if (typeof value !== "string") return `must be a string for BYTEA`;
      return true;

    case "JSON":
    case "JSONB":
      if (typeof value !== "object" && typeof value !== "string")
        return `must be an object or string for JSON/JSONB`;
      return true;

    default:
      // ENUM
      if (enumValuesLower) {
        if (!enumValuesLower.has(String(value).toLowerCase()))
          return `"${value}" is not a valid enum value`;
        return true;
      }
      return `unknown type "${type}" — cannot validate default`;
  }
}

/* ===================================================== */
/* MAIN EXPORT                                           */
/* ===================================================== */

export function validateDefaultValue({
  col,
  base,
  isArray,
  enumValuesLower,
}: {
  col: any;
  base: string;
  isArray: boolean;
  enumValuesLower?: Set<string> | undefined;
}): string[] {
  const errors: string[] = [];
  const def = col.default;

  // Resolve base type — strip modifier e.g. VARCHAR(255) → VARCHAR
  const resolvedBase = canonicalType(stripTypeModifier(base));

  /* ---- Array defaults ---- */
  if (isArray) {
    if (!Array.isArray(def)) {
      return [`"${col.name}" — default must be an array for type ${base}[]`];
    }

    if (def.length === 0) return errors; // empty array always valid

    for (const el of def) {
      const result = isValidScalarDefault(
        el,
        resolvedBase,
        enumValuesLower,
        true,
      );
      if (result !== true) {
        return [`"${col.name}" — array element invalid: ${result}`];
      }
    }

    return errors;
  }

  /* ---- Scalar defaults ---- */
  const result = isValidScalarDefault(
    def,
    resolvedBase,
    enumValuesLower,
    false,
  );
  if (result !== true) {
    errors.push(`"${col.name}" — ${result}`);
  }

  return errors;
}
