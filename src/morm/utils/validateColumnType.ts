// utils/validateColumnType.ts

/* ===================================================== */
/* TYPES THAT ACCEPT NO MODIFIER                         */
/* ===================================================== */
const NO_MODIFIER_TYPES = new Set([
  "TEXT",
  "INT",
  "INTEGER",
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
  "REAL",
  "FLOAT8",
  "FLOAT",
  "BYTEA",
]);

/* ===================================================== */
/* TYPES THAT ACCEPT (n)                                 */
/* ===================================================== */
const SINGLE_PARAM_TYPES = new Set([
  "VARCHAR",
  "CHAR",
  "CHARACTER VARYING",
  "CHARACTER",
]);

/* ===================================================== */
/* TYPES THAT ACCEPT (p) OR (p, s)                       */
/* ===================================================== */
const NUMERIC_PARAM_TYPES = new Set(["NUMERIC", "DECIMAL"]);

function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Parse the modifier part of a type, e.g. "(255)" or "(10, 2)".
 * Returns null if no modifier present.
 * Returns { params } if valid.
 * Returns error string if invalid.
 */
function parseModifier(raw: string): { params: number[] } | string | null {
  const match = raw.match(/\(\s*(.*?)\s*\)$/);
  if (!match) return null;

  const inner: any = match[1];
  const parts = inner.split(",").map((s: any) => s.trim());
  const params = parts.map(Number);

  if (params.some((n: any) => isNaN(n) || !Number.isInteger(n))) {
    return `modifier must contain integers only, got "(${inner})"`;
  }

  return { params };
}

export function validateColumnType(rawType: any): string[] {
  const errors: string[] = [];

  /* ---- Basic shape ---- */
  if (typeof rawType !== "string") {
    errors.push("type must be a string");
    return errors;
  }

  const type = rawType.trim();
  if (!type) {
    errors.push("type cannot be empty");
    return errors;
  }

  /* ---- Strip array suffix for base analysis ---- */
  const isArray = type.toUpperCase().endsWith("[]");
  const withoutArray = isArray ? type.slice(0, -2).trim() : type;
  const upper = withoutArray.toUpperCase();

  /* ---- Double array check ---- */
  const arrayMatches = type.match(/\[\]/g);
  if (arrayMatches && arrayMatches.length > 1) {
    errors.push(`"${type}" has invalid array syntax — only one [] allowed`);
    return errors;
  }

  if (type.includes("[]") && !type.toUpperCase().endsWith("[]")) {
    errors.push(`"${type}" has invalid array syntax — [] must be at the end`);
    return errors;
  }

  /* ---- Strip modifier to get base type ---- */
  const baseWithoutModifier = upper.replace(/\s*\(.*\)\s*$/, "").trim();
  const modifier = parseModifier(withoutArray);

  /* ---- Types that must NOT have modifiers ---- */
  if (NO_MODIFIER_TYPES.has(baseWithoutModifier)) {
    if (modifier !== null) {
      errors.push(
        `"${baseWithoutModifier}" does not accept a length or precision modifier`,
      );
    }
    return errors;
  }

  /* ---- VARCHAR / CHAR — accept (n) ---- */
  if (SINGLE_PARAM_TYPES.has(baseWithoutModifier)) {
    if (modifier === null) return errors; // plain VARCHAR/CHAR — valid

    if (typeof modifier === "string") {
      errors.push(`invalid modifier on "${baseWithoutModifier}": ${modifier}`);
      return errors;
    }

    if (modifier.params.length !== 1) {
      errors.push(
        `"${baseWithoutModifier}" accepts exactly one parameter (n), got ${modifier.params.length}`,
      );
      return errors;
    }

    const [n]: any = modifier.params;
    if (n < 1) {
      errors.push(`"${baseWithoutModifier}(${n})" — length must be at least 1`);
    }

    return errors;
  }

  /* ---- NUMERIC / DECIMAL — accept (p) or (p, s) ---- */
  if (NUMERIC_PARAM_TYPES.has(baseWithoutModifier)) {
    if (modifier === null) return errors; // plain NUMERIC — valid

    if (typeof modifier === "string") {
      errors.push(`invalid modifier on "${baseWithoutModifier}": ${modifier}`);
      return errors;
    }

    if (modifier.params.length > 2) {
      errors.push(
        `"${baseWithoutModifier}" accepts at most 2 parameters (precision, scale), got ${modifier.params.length}`,
      );
      return errors;
    }

    const [p, s]: any = modifier.params;
    if (p < 1) {
      errors.push(`"${baseWithoutModifier}" precision must be at least 1`);
    }

    if (s !== undefined && s < 0) {
      errors.push(`"${baseWithoutModifier}" scale cannot be negative`);
    }

    if (s !== undefined && s > p) {
      errors.push(
        `"${baseWithoutModifier}" scale (${s}) cannot exceed precision (${p})`,
      );
    }

    return errors;
  }

  /* ---- Custom / enum type — no modifier allowed ---- */
  if (modifier !== null) {
    errors.push(
      `custom or enum type "${baseWithoutModifier}" cannot have a modifier`,
    );
    return errors;
  }

  if (!isValidIdentifier(baseWithoutModifier)) {
    errors.push(`"${baseWithoutModifier}" is not a valid type identifier`);
  }

  return errors;
}
