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
  return values.join("|||"); // order-sensitive
}

export class EnumRegistry {
  private enumsByName = new Map<string, string[]>();
  private enumNameByValues = new Map<string, string>();
  private errors: string[] = [];

  register(defs: EnumDef[]) {
    for (const e of defs) {
      const name = normName(e.name);
      const values = e.values.map(String);

      // same name, different values
      if (this.enumsByName.has(name)) {
        const existing = this.enumsByName.get(name)!;
        const same =
          existing.length === values.length &&
          existing.every((v, i) => v === values[i]);

        if (!same) {
          this.errors.push(
            `${colors.error}${colors.bold}ENUM MIGRATION ERROR:${colors.reset} enum "${name}" redefined with different values`
          );
        }
        continue;
      }

      // different names, same values
      const key = valuesKey(values);
      if (this.enumNameByValues.has(key)) {
        const other = this.enumNameByValues.get(key)!;
        this.errors.push(
          `${colors.error}${colors.bold}ENUM MIGRATION ERROR:${colors.reset} enums "${other}" and "${name}" have identical values`
        );
        continue;
      }

      this.enumsByName.set(name, values);
      this.enumNameByValues.set(key, name);
    }
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  printErrors() {
    for (const e of this.errors) console.error(e);
  }

  clearErrors() {
    this.errors = [];
  }

  get(name: string) {
    return this.enumsByName.get(normName(name));
  }

  all() {
    return this.enumsByName;
  }
}

/* ===================================================== */
/* ================= DB MIGRATION ====================== */
/* ===================================================== */
export async function migrateEnumsGlobal(
  client: any,
  enums: Map<string, string[]>
) {
  for (const [name, desired] of enums.entries()) {
    const res = await client.query(
      `
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
      WHERE LOWER(pg_type.typname) = LOWER($1)
      ORDER BY enumsortorder
      `,
      [name]
    );

    // ─────────────────────────────────────────
    // ENUM DOES NOT EXIST → CREATE
    // ─────────────────────────────────────────
    if (res.rowCount === 0) {
      const sqlVals = desired
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(", ");

      await client.query(`CREATE TYPE "${name}" AS ENUM (${sqlVals})`);

      console.log(
        `${colors.success}ENUM MIGRATION:${colors.reset} created enum "${name}"`
      );
      continue;
    }

    const existing = res.rows.map((r: any) => String(r.enumlabel));
    const existingSet = new Set(existing);
    const desiredSet = new Set(desired);

    const added = desired.filter((v) => !existingSet.has(v));
    const removed = existing.filter((v: any) => !desiredSet.has(v));

    // ─────────────────────────────────────────
    // SAFE: ADD VALUES
    // ─────────────────────────────────────────
    for (const v of added) {
      await client.query(
        `ALTER TYPE "${name}" ADD VALUE '${v.replace(/'/g, "''")}'`
      );

      console.log(
        `${colors.info}ENUM MIGRATION:${colors.reset} added value "${v}" → ${name}`
      );
    }

    // ─────────────────────────────────────────
    // CHECK ENUM USAGE
    // ─────────────────────────────────────────
    const usage = await enumUsage(client, name);

    // BLOCKED: enum in use and values removed
    if (removed.length > 0 && usage.length > 0) {
      console.log(
        `${colors.error}${colors.bold}ENUM MIGRATION ERROR:${colors.reset} enum "${name}" is in use`
      );

      for (const u of usage) {
        console.log(`${colors.error}  - ${u.table}.${u.column}${colors.reset}`);
      }

      console.log(
        `${colors.warn}ENUM MIGRATION WARNING:${colors.reset} value removal requires migrate({ reset: true })`
      );

      // ❗ DO NOT THROW — just skip
      continue;
    }

    // ─────────────────────────────────────────
    // UNUSED ENUM → RECREATE
    // ─────────────────────────────────────────
    if (removed.length > 0 && usage.length === 0) {
      console.log(
        `${colors.processing}ENUM MIGRATION:${colors.reset} recreating unused enum "${name}"`
      );

      await client.query(`DROP TYPE "${name}"`);

      const sqlVals = desired
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(", ");

      await client.query(`CREATE TYPE "${name}" AS ENUM (${sqlVals})`);

      console.log(
        `${colors.success}ENUM MIGRATION:${colors.reset} recreated enum "${name}"`
      );
    }
  }
}

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
