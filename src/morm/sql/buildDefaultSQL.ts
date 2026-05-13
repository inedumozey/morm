// sql/buildDefaultSQL.ts

import { canonicalType, stripTypeModifier } from "../utils/canonicalType.js";

export function buildDefaultSQL(col: {
  type: string;
  default: any;
}): string | null {
  if (col.default === undefined) return null;

  const def = col.default;

  // Strip modifier and canonicalize — "VARCHAR(255)" → "VARCHAR", "numeric(10,2)" → "NUMERIC"
  const typeUpper = canonicalType(stripTypeModifier(String(col.type).trim()));

  /* =====================================================
   * IDENTITY HELPERS (NOT DEFAULTS)
   * ===================================================== */
  if (typeof def === "string") {
    const d = def.trim().toLowerCase();

    if (d === "int()") {
      if (typeUpper !== "INT" && typeUpper !== "INTEGER") {
        return null; // int() identity only supported for INT/INTEGER, but not an error if used with other types (handled elsewhere)
      }
      return null; // identity handled elsewhere
    }

    if (d === "smallint()") {
      if (typeUpper !== "SMALLINT") {
        return null; // smallint() identity only supported for SMALLINT, but not an error if used with other types (handled elsewhere)
      }
      return null;
    }

    if (d === "bigint()") {
      if (typeUpper !== "BIGINT") {
        return null; // bigint() identity only supported for BIGINT, but not an error if used with other types (handled elsewhere)
      }
      return null;
    }
  }

  /* =====================================================
   * UUID
   * ===================================================== */
  if (typeof def === "string" && def.trim().toLowerCase() === "uuid()") {
    return "gen_random_uuid()";
  }

  /* =====================================================
   * TIME / DATE / TIMESTAMP (now())
   * ===================================================== */
  if (typeof def === "string" && def.trim().toLowerCase() === "now()") {
    switch (typeUpper) {
      case "TIME":
        return "CURRENT_TIME::time";

      case "TIMETZ":
        return "CURRENT_TIME";

      case "DATE":
        return "CURRENT_DATE";

      case "TIMESTAMP":
        return "CURRENT_TIMESTAMP::timestamp";

      case "TIMESTAMPTZ":
        return "CURRENT_TIMESTAMP";

      default:
        return null;
    }
  }

  /* =====================================================
   * ARRAYS
   * ===================================================== */
  if (Array.isArray(def)) {
    if (typeUpper === "JSON" || typeUpper === "JSONB") {
      // Plain JSON/JSONB — serialize as JSON string
      return `'${JSON.stringify(def).replace(/'/g, "''")}'`;
    }
    if (typeUpper === "JSON[]" || typeUpper === "JSONB[]") {
      // Array of JSON/JSONB — only empty array supported as default
      if (def.length === 0) return "'{}'";
      return null; // non-empty array defaults not supported for JSON[]/JSONB[]
    }
    const items = def.map((v) =>
      typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : `"${String(v).replace(/"/g, '\\"')}"`,
    );
    return `'{${items.join(",")}}'`;
  }

  /* =====================================================
   * SCALARS
   * ===================================================== */
  if (typeof def === "number" || typeof def === "boolean") {
    return String(def);
  }

  if (typeof def === "string") {
    // Integer / numeric string defaults — pass as unquoted numeric literal
    // e.g. "42" → DEFAULT 42, "9223372036854775807" → DEFAULT 9223372036854775807
    const INTEGER_TYPES = new Set([
      "SMALLINT",
      "INTEGER",
      "BIGINT",
      "NUMERIC",
      "DECIMAL",
    ]);
    if (INTEGER_TYPES.has(typeUpper) && /^-?\d+(\.\d+)?$/.test(def.trim())) {
      return def.trim();
    }

    // All other string defaults — quoted literal
    return `'${def.replace(/'/g, "''")}'`;
  }

  /* =====================================================
   * JSON / OBJECT
   * ===================================================== */
  if (typeof def === "object") {
    return `'${JSON.stringify(def).replace(/'/g, "''")}'`;
  }

  return null;
}
