// utils/validateColumnType.ts

const BUILTIN_TYPES = new Set([
  "TEXT",
  "INT",
  "SMALLINT",
  "BIGINT",
  "UUID",
  "BOOLEAN",
  "JSON",
  "JSONB",
  "DATE",
  "TIME",
  "TIMETZ",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DECIMAL",
]);

function isValidIdentifier(name: string): boolean {
  // SQL-safe unquoted identifier
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export function validateColumnType(rawType: any): string[] {
  const errors: string[] = [];

  /* ===============================
   * BASIC SHAPE
   * =============================== */
  if (typeof rawType !== "string") {
    errors.push("type must be a string");
    return errors;
  }

  const type = rawType.trim();

  if (!type) {
    errors.push("type cannot be empty");
    return errors;
  }

  /* ===============================
   * DISALLOW FUNCTIONS
   * =============================== */
  if (/\w+\s*\(.*\)/.test(type)) {
    errors.push(`"${type}" is not a valid column type`);
    return errors;
  }

  /* ===============================
   * ARRAY SYNTAX
   * =============================== */
  const arrayMatches = type.match(/\[\]/g);
  if (arrayMatches && arrayMatches.length > 1) {
    errors.push(`"${type}" has invalid array syntax`);
    return errors;
  }

  if (type.includes("[]") && !type.endsWith("[]")) {
    errors.push(`"${type}" has invalid array syntax`);
    return errors;
  }

  /* ===============================
   * BASE TYPE
   * =============================== */
  const base = type.endsWith("[]") ? type.slice(0, -2) : type;

  const upper = base.toUpperCase();

  // Built-in scalar
  if (BUILTIN_TYPES.has(upper)) {
    return errors;
  }

  // Custom / enum type
  if (!isValidIdentifier(base)) {
    errors.push(`"${base}" is not a valid type identifier`);
    return errors;
  }

  return errors;
}
