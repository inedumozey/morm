// utils/canonicalType.ts

/**
 * Strip any length/precision modifier from a type string.
 * e.g. "VARCHAR(255)" → "VARCHAR", "NUMERIC(10,2)" → "NUMERIC"
 */
export function stripTypeModifier(t: string): string {
  return t.replace(/\s*\(.*\)\s*$/, "").trim();
}

/**
 * Extract the modifier from a type string, if present.
 * e.g. "VARCHAR(255)" → "(255)", "NUMERIC(10,2)" → "(10,2)", "TEXT" → ""
 */
export function extractTypeModifier(t: string): string {
  const match: any = t.match(/\s*(\(.*\))\s*$/);
  return match ? match[1] : "";
}

/**
 * Canonicalize a SQL type name to its normalized uppercase form.
 * Strips modifiers before lookup, so VARCHAR(255) → VARCHAR.
 * The modifier is NOT preserved here — use extractTypeModifier separately
 * when you need to reconstruct the full type with modifier.
 */
export function canonicalType(t: string | null | undefined): string {
  if (!t) return "";

  const raw = String(t).trim().toUpperCase();
  const base = stripTypeModifier(raw); // strip (n) or (p,s)

  const map: Record<string, string> = {
    // INTEGER FAMILY
    INT: "INTEGER",
    INTEGER: "INTEGER",
    INT4: "INTEGER",
    SMALLINT: "SMALLINT",
    INT2: "SMALLINT",
    BIGINT: "BIGINT",
    INT8: "BIGINT",

    // NUMERIC / FLOAT
    NUMERIC: "NUMERIC",
    DECIMAL: "NUMERIC",
    REAL: "REAL",
    FLOAT4: "REAL",
    "DOUBLE PRECISION": "FLOAT8",
    FLOAT8: "FLOAT8",
    FLOAT: "FLOAT8",

    // BOOLEAN
    BOOLEAN: "BOOLEAN",
    BOOL: "BOOLEAN",

    // TEXT / CHAR
    TEXT: "TEXT",
    CHAR: "CHAR",
    CHARACTER: "CHAR",
    VARCHAR: "VARCHAR",
    "CHARACTER VARYING": "VARCHAR",

    // UUID
    UUID: "UUID",

    // JSON
    JSON: "JSON",
    JSONB: "JSONB",

    // TIME / DATE
    TIME: "TIME",
    TIMETZ: "TIMETZ",
    "TIME WITHOUT TIME ZONE": "TIME",
    "TIME WITH TIME ZONE": "TIMETZ",
    TIMESTAMP: "TIMESTAMP",
    TIMESTAMPTZ: "TIMESTAMPTZ",
    "TIMESTAMP WITHOUT TIME ZONE": "TIMESTAMP",
    "TIMESTAMP WITH TIME ZONE": "TIMESTAMPTZ",
    DATE: "DATE",

    // BINARY
    BYTEA: "BYTEA",
  };

  return map[base] ?? base;
}

/**
 * Canonicalize a full type string preserving its modifier.
 * e.g. "varchar(255)" → "VARCHAR(255)"
 *      "numeric(10,2)" → "NUMERIC(10,2)"
 *      "text" → "TEXT"
 */
export function canonicalTypeWithModifier(
  t: string | null | undefined,
): string {
  if (!t) return "";
  const raw = String(t).trim();
  const modifier = extractTypeModifier(raw);
  const base = canonicalType(raw);
  return modifier ? `${base}${modifier}` : base;
}
