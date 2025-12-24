// migrations/alterColumnTypes.ts

import { canonicalType } from "../utils/canonicalType.js";
import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type DbColumn = {
  column_name: string;
  data_type: string;
  udt_name: string;
  column_default: string | null;
};

type Counts = {
  total: number;
};

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function isArray(t: string) {
  return t.endsWith("[]");
}

function baseType(t: string) {
  return isArray(t) ? t.slice(0, -2) : t;
}

function canonicalDbType(row: DbColumn): string {
  const dt = row.data_type.toLowerCase();

  if (dt === "array") {
    return canonicalType(row.udt_name.replace(/^_/, "")) + "[]";
  }

  if (dt === "timestamp with time zone") return "TIMESTAMPTZ";
  if (dt === "timestamp without time zone") return "TIMESTAMP";

  if (dt === "user-defined") {
    return canonicalType(row.udt_name);
  }

  return canonicalType(row.data_type);
}

const BUILTIN_TYPES = new Set([
  "TEXT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "UUID",
  "BOOLEAN",
  "JSON",
  "JSONB",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DATE",
  "TIME",
  "TIMEZ",
  "NUMERIC",
  "DECIMAL",
]);

function renderTypeSql(t: string) {
  if (t.endsWith("[]")) {
    const base = t.slice(0, -2);

    // builtin array
    if (BUILTIN_TYPES.has(base)) {
      return `${base}[]`;
    }

    // enum array
    return `"${base}"[]`;
  }

  // builtin scalar
  if (BUILTIN_TYPES.has(t)) {
    return t;
  }

  // enum scalar
  return `"${t}"`;
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterColumnTypes(opts: {
  client: any;
  table: string;
  existing: Map<string, DbColumn>;
  processed: any[];
  counts: Counts | null;
  messages: string[];
}): Promise<{ ok: boolean }> {
  const { client, table, existing, processed, counts, messages } = opts;

  const tableHasData = (counts?.total ?? 0) > 0;

  /* ===================================================== */
  /* LOAD ENUM TYPES (FOR VALIDATION ONLY)                  */
  /* ===================================================== */
  const enumRes = await client.query(`
    SELECT typname
    FROM pg_type
    WHERE typtype = 'e'
  `);

  const enumTypes = new Set<string>(
    enumRes.rows.map((r: { typname: string }) => canonicalType(r.typname))
  );

  for (const col of processed) {
    if (col.__virtual) continue;

    const row = existing.get(col.name);
    if (!row) continue;

    const raw = String(col.type);
    const isArr = isArray(raw);
    const desiredBase = canonicalType(baseType(raw));
    const desired = isArr ? `${desiredBase}[]` : desiredBase;

    const current = canonicalDbType(row);

    /* ---------- CASE-INSENSITIVE MATCH ---------- */
    if (desired === current) continue;

    /* ===================================================== */
    /* VALIDATION: TYPE MUST BE KNOWN                         */
    /* ===================================================== */

    const base = baseType(desired);

    // valid if canonicalType recognizes it OR it's an enum
    const isEnum = enumTypes.has(base);
    const isRecognized = canonicalType(base) === base;

    if (!isRecognized && !isEnum) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Invalid TYPE:${colors.reset} ` +
          `${colors.subject}${col.name}${colors.reset} → ${colors.subject}${desired}${colors.reset} ` +
          `(type not supported or enum not registered)`
      );
      console.log("");
      return { ok: false };
    }

    /* ===================================================== */
    /* TABLE NOT EMPTY → HARD ERROR                           */
    /* ===================================================== */

    if (tableHasData) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Blocked TYPE change:${colors.reset} ` +
          `${colors.subject}${col.name}${colors.reset}. Table contains data, run await morm.migrate({ reset: true }) to drop & rebuild tables`
      );
      console.log("");

      return { ok: false };
    }

    /* ===================================================== */
    /* SAFE: EMPTY TABLE                                     */
    /* ===================================================== */

    // ----- DROP DEFAULT IF IT EXISTS (required for type change so it will not block the change) -----
    if (row.column_default !== null) {
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} DROP DEFAULT`
      );
    }

    /* ----- DROP CHECK CONSTRAINT IF IT EXISTS (may block type change) */
    const checkName = `${table}_${col.name}_check`;
    await client.query(
      `ALTER TABLE ${q(table)} DROP CONSTRAINT IF EXISTS ${q(checkName)}`
    );

    const typeSql = renderTypeSql(desired);

    await client.query(
      `ALTER TABLE ${q(table)} ` +
        `ALTER COLUMN ${q(col.name)} TYPE ${typeSql} USING NULL::${typeSql}`
    );

    messages.push(
      `${colors.success}Changed TYPE:${colors.reset} ` +
        `${colors.subject}${current}${colors.reset} ` +
        `→ ${colors.subject}${desired}${colors.reset}`
    );
  }

  return { ok: true };
}
