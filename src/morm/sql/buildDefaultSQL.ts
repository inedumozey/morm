// sql/buildDefaultSQL.ts

export function buildDefaultSQL(col: {
  type: string;
  default: any;
}): string | null {
  if (col.default === undefined) return null;

  const def = col.default;
  const typeUpper = String(col.type).trim().toUpperCase();

  /* =====================================================
   * IDENTITY HELPERS (NOT DEFAULTS)
   * ===================================================== */
  if (typeof def === "string") {
    const d = def.trim().toLowerCase();

    if (d === "int()") {
      if (typeUpper !== "INT" && typeUpper !== "INTEGER") {
        throw new Error(
          `int() identity can only be used with INT/INTEGER column type`
        );
      }
      return null; // identity handled elsewhere
    }

    if (d === "smallint()") {
      if (typeUpper !== "SMALLINT") {
        throw new Error(
          `smallint() identity can only be used with SMALLINT column type`
        );
      }
      return null;
    }

    if (d === "bigint()") {
      if (typeUpper !== "BIGINT") {
        throw new Error(
          `bigint() identity can only be used with BIGINT column type`
        );
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
        throw new Error(
          `now() default is not valid for column type ${typeUpper}`
        );
    }
  }

  /* =====================================================
   * ARRAYS
   * ===================================================== */
  if (Array.isArray(def)) {
    const items = def.map((v) =>
      typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : `"${String(v).replace(/"/g, '\\"')}"`
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
