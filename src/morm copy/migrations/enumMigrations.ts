import { colors } from "../utils/logColors.js";

export type EnumRuntimeDef = {
  name: string;
  values: string[];
};

export type EnumMigrationResult = {
  changed: number;
  skipped: number;
  errors: number;
  ok: boolean;
};

/**
 * ================================================
 * ENUM MIGRATION RULES (with reset safety)
 * ================================================
 *
 * SAFE (reset:false)
 *  -----------------
 *  ✔ Create enum type
 *  ✔ Add enum values
 *  ✔ Rename enum type
 *  ✔ Remove / rename enum values IF table using it is empty
 *
 * DANGEROUS (reset:true)
 *  ---------------------
 *  Remove / rename enum values IF table has data
 *     -> table rows are deleted prior to recreation
 *
 * NOTES:
 *  - Enum creation / modification happens OUTSIDE transaction
 *    to avoid "current transaction aborted" errors.
 *  - Migration does NOT break even if an enum fails.
 *    It logs nicely and continues with other models.
 */

export async function migrateEnums(
  client: any,
  tableName: string,
  enums: readonly EnumRuntimeDef[] | undefined,
  messages: string[],
  options?: { reset?: boolean }
): Promise<EnumMigrationResult> {
  let changed = 0;
  let skipped = 0;
  let errors = 0;

  const list = enums ?? [];
  if (list.length === 0) {
    return { changed, skipped, errors, ok: errors === 0 };
  }

  // ==========================================
  // STEP 1 — Iterate all enum definitions
  // ==========================================
  for (const e of list) {
    const enumName = e.name;
    const desiredValues = e.values;

    // ==========================================
    // STEP 2 — Detect whether enum exists
    // ==========================================
    let enumExists = false;

    try {
      const existsRes = await client.query(
        `SELECT 1 FROM pg_type WHERE typname = $1`,
        [enumName]
      );
      enumExists = existsRes.rowCount > 0;
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR checking type "${enumName}": ${err.message}${colors.reset}`
      );
      errors++;
      continue;
    }

    // ==========================================
    // STEP 3 — CREATE NEW ENUM TYPE (SAFE)
    // ==========================================
    if (!enumExists) {
      try {
        const sqlVals = desiredValues
          .map((v) => `'${v.replace(/'/g, "''")}'`)
          .join(", ");

        await client.query(`CREATE TYPE "${enumName}" AS ENUM (${sqlVals})`);

        messages.push(
          `${colors.green}Created enum type "${enumName}"${colors.reset}`
        );
        changed++;
        continue; // no need to diff values
      } catch (err: any) {
        messages.push(
          `${colors.red}${colors.bold}ENUM ERROR creating "${enumName}": ${err.message}${colors.reset}`
        );
        errors++;
        continue;
      }
    }

    // ==========================================
    // STEP 4 — READ EXISTING ENUM VALUES
    // ==========================================
    let existingValues: string[] = [];

    try {
      const valRes = await client.query(
        `SELECT enumlabel
         FROM pg_enum
         JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
         WHERE pg_type.typname = $1
         ORDER BY enumlabel`,
        [enumName]
      );

      existingValues = valRes.rows.map((r: any) => String(r.enumlabel));
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR reading values for "${enumName}": ${err.message}${colors.reset}`
      );
      errors++;
      continue;
    }

    const desiredSet = new Set(desiredValues);
    const existingSet = new Set(existingValues);

    const addedValues = desiredValues.filter((v) => !existingSet.has(v));
    const removedValues = existingValues.filter((v) => !desiredSet.has(v));

    // ==========================================
    // STEP 5 — ADD NEW VALUES (SAFE)
    // ==========================================
    for (const val of addedValues) {
      const escaped = val.replace(/'/g, "''");
      try {
        await client.query(`ALTER TYPE "${enumName}" ADD VALUE '${escaped}'`);
        messages.push(
          `${colors.cyan}Added enum value '${val}' → "${enumName}"${colors.reset}`
        );
        changed++;
      } catch (err: any) {
        messages.push(
          `${colors.red}${colors.bold}ENUM ERROR adding '${val}' → "${enumName}": ${err.message}${colors.reset}`
        );
        errors++;
      }
    }

    // ==========================================
    // STEP 6 — HANDLE REMOVED OR RENAMED VALUES
    // ==========================================
    if (removedValues.length === 0) continue;

    // Count rows using this enum
    let tableCount = 0n;

    try {
      const countRes = await client.query(
        `SELECT COUNT(*)::bigint AS cnt FROM "${tableName}"`
      );
      tableCount = BigInt(countRes.rows[0].cnt);
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR counting rows in "${tableName}" for "${enumName}": ${err.message}${colors.reset}`
      );
      errors++;
      continue;
    }

    const hasData = tableCount > 0n;

    // ==========================================
    // STEP 7 — SAFE REMOVE (no data OR reset:true)
    // ==========================================

    // (7a) TABLE HAS DATA BUT RESET = FALSE
    if (hasData && !options?.reset) {
      messages.push(
        `${colors.red}${colors.bold}ENUM BLOCKED: cannot remove or rename values on "${enumName}" — table "${tableName}" has data (${tableCount} rows).${colors.reset}`
      );
      messages.push(
        `${colors.yellow}Use migrate({ reset: true }) to force destructive update (ALL DATA LOST).${colors.reset}`
      );
      errors++;
      continue;
    }

    // (7b) TABLE HAS DATA BUT RESET = TRUE (destructive)
    if (hasData && options?.reset) {
      messages.push(
        `${colors.red}${colors.bold}ENUM RESET: clearing table "${tableName}" before enum recreate — DATA LOST.${colors.reset}`
      );

      try {
        await client.query(`DELETE FROM "${tableName}"`);
      } catch (err: any) {
        messages.push(
          `${colors.red}${colors.bold}ENUM ERROR clearing table: ${err.message}${colors.reset}`
        );
        errors++;
        continue;
      }
    }

    // ==========================================
    // STEP 8 — RECREATE ENUM TYPE (rename/remove safe)
    // ==========================================
    const tmpEnumName = `${enumName}__morm_tmp`;

    try {
      // 8a. create temp enum
      const valsSql = desiredValues
        .map((v) => `'${v.replace(/'/g, "''")}'`)
        .join(", ");
      await client.query(`CREATE TYPE "${tmpEnumName}" AS ENUM (${valsSql})`);

      // 8b. convert all columns using old enum → new enum
      const colRes = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = LOWER($1)
           AND udt_name = $2`,
        [tableName, enumName]
      );

      for (const row of colRes.rows) {
        const colName = String(row.column_name);

        await client.query(
          `ALTER TABLE "${tableName}"
             ALTER COLUMN "${colName}"
             TYPE "${tmpEnumName}"
             USING "${colName}"::text::"${tmpEnumName}"`
        );
      }

      // 8c. drop old
      await client.query(`DROP TYPE "${enumName}"`);

      // 8d. rename temp to real name
      await client.query(`ALTER TYPE "${tmpEnumName}" RENAME TO "${enumName}"`);

      messages.push(
        `${colors.magenta}Recreated enum "${enumName}" → [${desiredValues.join(
          ", "
        )}] (${hasData ? "RESET" : "SAFE"})${colors.reset}`
      );
      changed++;
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR recreating "${enumName}": ${err.message}${colors.reset}`
      );
      errors++;

      // cleanup temp type (best effort)
      try {
        await client.query(`DROP TYPE IF EXISTS "${tmpEnumName}"`);
      } catch {}
    }
  }

  return {
    changed,
    skipped,
    errors,
    ok: errors === 0,
  };
}
