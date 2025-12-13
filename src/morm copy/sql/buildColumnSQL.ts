import type { ColumnDefinition } from "../model-types.js";

const BUILTIN_TYPES = new Set([
  "TEXT",
  "INT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "UUID",
  "BOOLEAN",
  "JSONB",
  "TIMESTAMP",
  "DATE",
  "TIME",
  "NUMERIC",
  "DECIMAL",
  "TEXT[]",
  "INT[]",
  "UUID[]",
]);

/**
 * Normalize SQL type case
 */
function normalizeType(type: string): string {
  const raw = type.trim();

  // 1. Built-in types → uppercased
  const upper = raw.toUpperCase();
  if (BUILTIN_TYPES.has(upper)) {
    return upper;
  }

  // 2. Enum type → preserve original case
  return raw;
}

/**
 * Convert JS-style check operators (===, ==, !=, !==)
 * to PG equivalents.
 */
function convertCheck(expr: string): string {
  return expr
    .replace(/===/g, "=")
    .replace(/==/g, "=")
    .replace(/!==/g, "<>")
    .replace(/!=/g, "<>");
}

/**
 * Build SQL for a single column definition.
 * This function is PURE — no DB access.
 *
 * Handles:
 *  - PRIMARY KEY
 *  - UNIQUE
 *  - NOT NULL
 *  - DEFAULT
 *  - CHECK(...)
 */
export function buildColumnSQL(
  col: ColumnDefinition & { name: string; __primary?: boolean }
): string {
  const parts: string[] = [];

  // column name
  parts.push(`"${col.name}"`);

  // type
  parts.push(normalizeType(col.type));

  // primary
  if (col.__primary) parts.push("PRIMARY KEY");

  // unique
  if (col.unique) parts.push("UNIQUE");

  // NOT NULL
  if (col.notNull) parts.push("NOT NULL");

  // DEFAULT
  if (col.default !== undefined) {
    if (typeof col.default === "string") {
      parts.push(`DEFAULT ${col.default}`); // allow NOW() and functions
    } else {
      parts.push(`DEFAULT ${col.default}`);
    }
  }

  // CHECK
  if (col.check) {
    parts.push(`CHECK (${convertCheck(col.check)})`);
  }

  return parts.join(" ");
}
