// migrations/enumRegistry.ts

import { colors } from "../utils/logColors.js";

export type EnumDef = {
  name: string;
  values: string[];
};

function normName(name: string) {
  return name.trim().toUpperCase();
}

function valuesKey(values: string[]) {
  return values.join("|||");
}

function subject(name: string) {
  return `${colors.subject}${name}${colors.reset}`;
}

/* ===================================================== */
/* ================= ENUM REGISTRY ===================== */
/* ===================================================== */

export class EnumRegistry {
  private enumsByName = new Map<string, string[]>();
  private enumNameByValues = new Map<string, string>();
  private errors: string[] = [];

  register(defs: EnumDef[]) {
    for (const e of defs) {
      const name = normName(e.name);
      const values = e.values.map(String);

      if (this.enumsByName.has(name)) {
        const existing = this.enumsByName.get(name)!;
        const same =
          existing.length === values.length &&
          existing.every((v, i) => v === values[i]);

        if (!same) {
          this.errors.push(`${subject(name)} redefined with different values`);
        }
        continue;
      }

      const key = valuesKey(values);
      if (this.enumNameByValues.has(key)) {
        const other = this.enumNameByValues.get(key)!;
        this.errors.push(
          `duplicate values between ${subject(other)} and ${subject(name)}`
        );
        continue;
      }

      this.enumsByName.set(name, values);
      this.enumNameByValues.set(key, name);
    }
  }

  has(name: string): boolean {
    return this.enumsByName.has(String(name).toUpperCase());
  }

  get(name: string): { name: string; values: string[] } | undefined {
    const key = String(name).toUpperCase();
    const values = this.enumsByName.get(key);
    if (!values) return undefined;
    return { name: key, values };
  }

  allNames(): string[] {
    return Array.from(this.enumsByName.keys());
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  printErrors() {
    if (this.errors.length === 0) return;

    console.log(
      `${colors.section}${colors.bold}ENUM VALIDATION:${colors.reset}`
    );

    for (const e of this.errors) {
      console.log(`  ${colors.error}Error:${colors.reset} ${e}`);
    }

    console.log("");
  }

  clearErrors() {
    this.errors = [];
  }

  all() {
    return this.enumsByName;
  }
}

/* ===================================================== */
/* ================= ENUM MIGRATION ==================== */
/* ===================================================== */

export async function migrateEnumsGlobal(
  client: any,
  enums: Map<string, string[]>
) {
  let didWork = false;

  const created: string[] = [];
  const updated: string[] = [];
  const dropped: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const blocked = new Map<string, { table: string; column: string }[]>();

  /* ---------- READ EXISTING ---------- */
  const existingRes = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typtype = 'e'
    ORDER BY t.typname, e.enumsortorder
  `);

  const dbEnums = new Map<string, string[]>();
  for (const r of existingRes.rows) {
    const name = normName(r.typname);
    if (!dbEnums.has(name)) dbEnums.set(name, []);
    dbEnums.get(name)!.push(String(r.enumlabel));
  }

  const desiredEnums = new Map<string, string[]>();
  for (const [k, v] of enums.entries()) {
    desiredEnums.set(normName(k), v.map(String));
  }

  /* ---------- RENAME DETECTION ---------- */
  for (const [dbName, dbValues] of dbEnums.entries()) {
    if (desiredEnums.has(dbName)) continue;

    const dbKey = valuesKey(dbValues);

    for (const [desiredName, desiredValues] of desiredEnums.entries()) {
      if (dbEnums.has(desiredName)) continue;
      if (valuesKey(desiredValues) === dbKey) {
        renamed.push({ from: dbName, to: desiredName });
        break;
      }
    }
  }

  const renamedFrom = new Set(renamed.map((r) => r.from));
  const renamedTo = new Set(renamed.map((r) => r.to));

  /* ---------- DROP REMOVED ---------- */
  for (const [name] of dbEnums.entries()) {
    if (renamedFrom.has(name)) continue;
    if (!desiredEnums.has(name)) {
      const usage = await enumUsage(client, name);
      if (usage.length > 0) {
        blocked.set(name, usage);
        continue;
      }
      await client.query(`DROP TYPE "${name}"`);
      dropped.push(name);
      didWork = true;
    }
  }

  /* ---------- CREATE / UPDATE ---------- */
  for (const [name, desired] of desiredEnums.entries()) {
    if (renamedTo.has(name)) continue;

    if (!dbEnums.has(name)) {
      const sqlVals = desired
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(", ");
      await client.query(`CREATE TYPE "${name}" AS ENUM (${sqlVals})`);
      created.push(name);
      didWork = true;
      continue;
    }

    const existing = dbEnums.get(name)!;
    const existingSet = new Set(existing);

    const added = desired.filter((v) => !existingSet.has(v));
    const removed = existing.filter((v) => !desired.includes(v));

    if (removed.length > 0) {
      const usage = await enumUsage(client, name);
      if (usage.length > 0) {
        blocked.set(name, usage);
        continue;
      }

      await client.query(`DROP TYPE "${name}"`);
      const sqlVals = desired
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(", ");
      await client.query(`CREATE TYPE "${name}" AS ENUM (${sqlVals})`);
      updated.push(name);
      didWork = true;
      continue;
    }

    for (const v of added) {
      await client.query(
        `ALTER TYPE "${name}" ADD VALUE '${v.replace(/'/g, "''")}'`
      );
      didWork = true;
    }

    if (added.length > 0) updated.push(name);
  }

  /* ---------- APPLY RENAME ---------- */
  for (const r of renamed) {
    const values = desiredEnums.get(r.to)!;
    await client.query(`DROP TYPE "${r.from}"`);
    const sqlVals = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    await client.query(`CREATE TYPE "${r.to}" AS ENUM (${sqlVals})`);
    didWork = true;
  }

  /* ---------- LOG ONLY IF WORK WAS DONE ---------- */
  if (!didWork && blocked.size === 0) return;

  console.log(`${colors.section}${colors.bold}ENUM MIGRATION:${colors.reset}`);

  if (renamed.length > 0) {
    console.log(
      `  ${colors.success}Updated:${colors.reset} ${renamed
        .map((r) => `${subject(r.from)} → ${subject(r.to)}`)
        .join(", ")}`
    );
  }

  if (created.length > 0) {
    console.log(
      `  ${colors.success}Created:${colors.reset} ${created
        .map(subject)
        .join(", ")}`
    );
  }

  if (updated.length > 0) {
    console.log(
      `  ${colors.success}Updated:${colors.reset} ${updated
        .map(subject)
        .join(", ")}`
    );
  }

  if (dropped.length > 0) {
    console.log(
      `  ${colors.processing}Dropped:${colors.reset} ${dropped
        .map(subject)
        .join(", ")}`
    );
  }

  if (blocked.size > 0) {
    console.log(`  ${colors.warn}Blocked:${colors.reset} enum(s) still in use`);
  }

  console.log("");
}

/* ===================================================== */
/* ================= ENUM USAGE ======================== */
/* ===================================================== */

async function enumUsage(client: any, enumName: string) {
  const res = await client.query(
    `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE LOWER(udt_name) = LOWER($1)
    `,
    [enumName]
  );

  return res.rows.map((r: any) => ({
    table: r.table_name,
    column: r.column_name,
  }));
}
