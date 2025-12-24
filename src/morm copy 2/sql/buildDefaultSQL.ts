// sql/buildDefaultSQL.ts

export function buildDefaultSQL(col: {
  type: string;
  default: any;
}): string | null {
  if (col.default === undefined) return null;

  const typUpper = String(col.type).toUpperCase();
  const def = col.default;

  // uuid()
  if (typeof def === "string" && def.trim().toLowerCase() === "uuid()") {
    return "gen_random_uuid()";
  }

  // SQL functions (now(), current_timestamp, etc)
  if (typeof def === "string" && /\w+\s*\(.*\)/.test(def)) {
    return def;
  }

  // ARRAY default
  if (Array.isArray(def)) {
    const arr = def.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",");
    return `'{${arr}}'::${typUpper}`;
  }

  // STRING (TEXT / ENUM)
  if (typeof def === "string") {
    return `'${def.replace(/'/g, "''")}'`;
  }

  // NUMBER / BOOLEAN
  if (typeof def === "number" || typeof def === "boolean") {
    return String(def);
  }

  // JSON / fallback
  return `'${JSON.stringify(def).replace(/'/g, "''")}'`;
}
