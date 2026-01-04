// migrations/alterColumn.ts

import { buildColumnSQL } from "../sql/buildColumnSQL.js";
import { canonicalType } from "../utils/canonicalType.js";
import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type DbColumn = {
  column_name: string;
  data_type: string;
  udt_name: string;
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

function dbCanonicalType(r: DbColumn): string {
  const dt = r.data_type.toUpperCase();

  // ARRAY types (THIS IS THE BUG FIX)
  if (dt === "ARRAY") {
    const base = r.udt_name.replace(/^_/, ""); // _json → json
    return canonicalType(base) + "[]";
  }

  // ENUM / USER-DEFINED (non-array)
  if (dt === "USER-DEFINED") {
    return canonicalType(r.udt_name);
  }

  return canonicalType(r.data_type);
}

function canonicalTypeWithArray(t: string): string {
  const upper = t.toUpperCase();

  if (upper.endsWith("[]")) {
    const base = upper.slice(0, -2);
    return canonicalType(base) + "[]";
  }

  return canonicalType(upper);
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterColumn(opts: {
  client: any;
  table: string;
  existing: Map<string, DbColumn>;
  processed: any[];
  counts: Counts | null;
  messages: string[];
}): Promise<{ ok: boolean }> {
  const { client, table, existing, processed, counts, messages } = opts;

  const tableHasData = (counts?.total ?? 0) > 0;

  const modelNames = processed.map((c) => c.name);
  const existingNames = Array.from(existing.keys());

  const missingInModel = existingNames.filter((n) => !modelNames.includes(n));
  const missingInDB = modelNames.filter((n) => !existing.has(n));

  const modelMap = new Map(processed.map((c) => [c.name, c]));

  /* ===================================================== */
  /* 1. RENAME (FIRST — PRESERVE DATA)                     */
  /* ===================================================== */

  for (const oldName of [...missingInModel]) {
    const row = existing.get(oldName);
    if (!row) continue;

    const oldType = dbCanonicalType(row);

    const candidates = missingInDB.filter((newName) => {
      const col = modelMap.get(newName);
      if (!col) return false;
      return (
        canonicalTypeWithArray(col.type) === canonicalTypeWithArray(oldType)
      );
    });

    // Must be EXACTLY one safe match
    if (candidates.length !== 1) continue;

    const newName = candidates[0];

    /* ---------- HARD COLLISION ---------- */
    if (existing.has(newName)) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Column name collision:${colors.reset} ` +
          `${colors.subject}${newName}${colors.reset} already exists`
      );
      console.log("");
      return { ok: false };
    }

    /* ---------- EXECUTE RENAME ---------- */
    await client.query(
      `ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`
    );

    messages.push(
      `${colors.processing}Renamed COLUMN:${colors.reset} ` +
        `${colors.subject}${oldName}${colors.reset} → ${colors.subject}${newName}${colors.reset}`
    );

    /* ---------- MUTATE STATE ---------- */
    existing.delete(oldName);
    existing.set(newName, row);

    const modelCol = modelMap.get(newName);
    if (modelCol) modelCol.__renamed = true;

    missingInModel.splice(missingInModel.indexOf(oldName), 1);
    missingInDB.splice(missingInDB.indexOf(newName), 1);
  }

  /* ===================================================== */
  /* 2. ADD COLUMNS                                       */
  /* ===================================================== */

  for (const name of missingInDB) {
    const col = modelMap.get(name);
    if (!col || col.__virtual) continue;

    if (tableHasData) {
      if (col.notNull && col.default === undefined) {
        console.log(
          `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
        );
        console.log(`  ${colors.subject}${table}${colors.reset}`);
        console.log(
          `    ${colors.error}Cannot ADD column:${colors.reset} ` +
            `${colors.subject}${name}${colors.reset} ` +
            `(table has data and column is NOT NULL without default)`
        );
        console.log("");
        return { ok: false };
      }
    }

    await client.query(
      `ALTER TABLE ${q(table)} ADD COLUMN ${buildColumnSQL(col)}`
    );

    messages.push(
      `${colors.success}Added COLUMN:${colors.reset} ${colors.subject}${name}${colors.reset}`
    );
  }

  /* ===================================================== */
  /* 3. DROP COLUMNS                                      */
  /* ===================================================== */
  for (const name of missingInModel) {
    console.log(name);
    if (!tableHasData) {
      await client.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(name)}`);

      messages.push(
        `${colors.success}Dropped COLUMN:${colors.reset} ${colors.subject}${name}${colors.reset}`
      );
    } else {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Cannot DROP column:${colors.reset} ` +
          `${colors.subject}${name}${colors.reset} ` +
          `(table contains data), reset database to proceed`
      );
      console.log("");
      return { ok: false };
    }
  }

  return { ok: true };
}
