// utils/canonicalType.ts
export function canonicalType(t: string | null | undefined): string {
  if (!t) return "";
  const raw = String(t).trim().toUpperCase();
  const map: Record<string, string> = {
    INT: "INTEGER",
    INTEGER: "INTEGER",
    INT4: "INTEGER", // ← ADD THIS
    SERIAL: "INTEGER", // ← ADD THIS
    BIGSERIAL: "BIGINT", // ← ADD THIS
    SMALLINT: "SMALLINT",
    BIGINT: "BIGINT",
    TEXT: "TEXT",
    UUID: "UUID",
    BOOLEAN: "BOOLEAN",
    JSON: "JSON",
    JSONB: "JSONB",
    TIMESTAMP: "TIMESTAMP",
    TIMESTAMPTZ: "TIMESTAMPTZ",
    DATE: "DATE",
    TIME: "TIME",
    TIMEZ: "TIMEZ",
    NUMERIC: "NUMERIC",
    DECIMAL: "DECIMAL",
  };

  return map[raw] || raw;
}
