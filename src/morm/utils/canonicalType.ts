// utils/canonicalType.ts

export function canonicalType(t: string | null | undefined): string {
  if (!t) return "";

  const raw = String(t).trim().toUpperCase();

  const map: Record<string, string> = {
    // INTEGER FAMILY
    INT: "INTEGER",
    INTEGER: "INTEGER",
    INT4: "INTEGER",
    SMALLINT: "SMALLINT",
    INT2: "SMALLINT",
    BIGINT: "BIGINT",
    INT8: "BIGINT",

    // NUMERIC
    NUMERIC: "NUMERIC",
    DECIMAL: "NUMERIC",

    // BOOLEAN
    BOOLEAN: "BOOLEAN",
    BOOL: "BOOLEAN",

    // TEXT
    TEXT: "TEXT",

    // UUID
    UUID: "UUID",

    // JSON
    JSON: "JSON",
    JSONB: "JSONB",

    // TIME / DATE
    TIME: "TIME",
    "TIME WITHOUT TIME ZONE": "TIME",
    TIMESTAMP: "TIMESTAMP",
    "TIMESTAMP WITHOUT TIME ZONE": "TIMESTAMP",
    TIMESTAMPTZ: "TIMESTAMPTZ",
    "TIMESTAMP WITH TIME ZONE": "TIMESTAMPTZ",
    DATE: "DATE",
  };

  return map[raw] ?? raw;
}
