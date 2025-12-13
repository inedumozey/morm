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

function escapeSqlLiteral(s: string) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Helper: read all enum types and their values from DB.
 * Returns array of { name, values[] }.
 */
async function readAllDbEnums(client: any) {
  // Query pg_type/pg_enum and aggregate
  const res = await client.query(
    `SELECT t.typname AS typname, e.enumlabel AS enumlabel
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typtype = 'e'
     ORDER BY t.typname, e.enumsortorder`
  );

  const map = new Map<string, string[]>();
  for (const row of res.rows) {
    const n = String(row.typname);
    const v = String(row.enumlabel);
    const arr = map.get(n) ?? [];
    arr.push(v);
    map.set(n, arr);
  }

  const list: { name: string; values: string[] }[] = [];
  for (const [name, values] of map.entries()) {
    list.push({ name, values });
  }
  return list;
}

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

  // Read DB enums once (we will refresh later if we rename/create)
  let dbEnums = [];
  try {
    dbEnums = await readAllDbEnums(client);
  } catch (err: any) {
    messages.push(
      `${colors.red}${colors.bold}ENUM ERROR reading DB enums: ${err.message}${colors.reset}`
    );
    errors++;
    // can't proceed reliably
    return { changed, skipped, errors, ok: false };
  }

  // For quick lookups: map lower(name) -> exact DB name
  const dbNameByLower = new Map<string, string>();
  for (const d of dbEnums) dbNameByLower.set(d.name.toLowerCase(), d.name);

  // Also map a canonical representation of values -> DB name(s)
  // Use joined values with '||' after sorting to create canonical key
  const valuesKey = (vals: string[]) => vals.map((v) => String(v)).join("|||"); // preserves order (enums order matters)

  const dbByValues = new Map<string, string[]>(); // key -> [names]
  for (const d of dbEnums) {
    const key = valuesKey(d.values);
    const arr = dbByValues.get(key) ?? [];
    arr.push(d.name);
    dbByValues.set(key, arr);
  }

  // Iterate desired enums
  for (const e of list) {
    const enumNameRaw = String(e.name).trim(); // preserve case EXACT
    const desiredValues = e.values ?? [];

    // 1) First try case-insensitive name match
    const possibleDbName = dbNameByLower.get(enumNameRaw.toLowerCase());
    let enumExists = !!possibleDbName;

    // If exact-case exists, great.
    const exactDbName = possibleDbName ?? null;

    // 2) If no name-match, check whether any DB enum has the same values (ordered)
    // This detects semantic renames (name changed but values identical).
    let dbNameWithSameValues: string | null | undefined = null;
    if (!enumExists) {
      const key = valuesKey(desiredValues);
      const matches = dbByValues.get(key);
      if (matches && matches.length > 0) {
        // pick the first matching DB enum name
        dbNameWithSameValues = matches[0];
      }
    }

    // If we found a DB enum that has the same values but different name -> RENAME it
    if (dbNameWithSameValues && dbNameWithSameValues !== enumNameRaw) {
      try {
        await client.query(
          `ALTER TYPE "${dbNameWithSameValues}" RENAME TO "${enumNameRaw}"`
        );
        messages.push(
          `${colors.cyan}Renamed enum "${dbNameWithSameValues}" → "${enumNameRaw}"${colors.reset}`
        );
        changed++;

        // Refresh DB enum caches (we changed the DB)
        try {
          dbEnums = await readAllDbEnums(client);
          dbNameByLower.clear();
          dbByValues.clear();
          for (const d of dbEnums) {
            dbNameByLower.set(d.name.toLowerCase(), d.name);
            const k = valuesKey(d.values);
            const arr = dbByValues.get(k) ?? [];
            arr.push(d.name);
            dbByValues.set(k, arr);
          }
        } catch (rerr: any) {
          messages.push(
            `${colors.red}${colors.bold}ENUM ERROR refreshing DB enum cache after rename: ${rerr.message}${colors.reset}`
          );
          errors++;
          continue; // move to next enum, but mark error
        }

        // Now treat enum as existing under desired name
        enumExists = true;
      } catch (err: any) {
        messages.push(
          `${colors.red}${colors.bold}ENUM ERROR renaming "${dbNameWithSameValues}" → "${enumNameRaw}": ${err.message}${colors.reset}`
        );
        errors++;
        continue;
      }
    }

    // 3) If no existing enum at all, create it
    if (!enumExists) {
      try {
        const sqlVals = (desiredValues ?? []).map(escapeSqlLiteral).join(", ");
        await client.query(`CREATE TYPE "${enumNameRaw}" AS ENUM (${sqlVals})`);
        messages.push(
          `${colors.green}Created enum type "${enumNameRaw}"${colors.reset}`
        );
        changed++;

        // refresh db caches
        try {
          dbEnums = await readAllDbEnums(client);
          dbNameByLower.clear();
          dbByValues.clear();
          for (const d of dbEnums) {
            dbNameByLower.set(d.name.toLowerCase(), d.name);
            const k = valuesKey(d.values);
            const arr = dbByValues.get(k) ?? [];
            arr.push(d.name);
            dbByValues.set(k, arr);
          }
        } catch (rerr: any) {
          messages.push(
            `${colors.red}${colors.bold}ENUM ERROR refreshing DB enum cache after create: ${rerr.message}${colors.reset}`
          );
          errors++;
        }

        // done with this enum (no values to diff)
        continue;
      } catch (err: any) {
        messages.push(
          `${colors.red}${colors.bold}ENUM ERROR creating "${enumNameRaw}": ${err.message}${colors.reset}`
        );
        errors++;
        continue;
      }
    }

    // 4) At this point the enum exists (either originally or after rename/create)
    // Read its current values from DB (case-insensitive by name)
    let existingValues: string[] = [];
    try {
      const valRes = await client.query(
        `SELECT enumlabel
         FROM pg_enum
         JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
         WHERE LOWER(pg_type.typname) = LOWER($1)
         ORDER BY enumsortorder`,
        [enumNameRaw]
      );
      existingValues = valRes.rows.map((r: any) => String(r.enumlabel));
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR reading values for "${enumNameRaw}": ${err.message}${colors.reset}`
      );
      errors++;
      continue;
    }

    const desiredSet = new Set(desiredValues);
    const existingSet = new Set(existingValues);

    const addedValues = desiredValues.filter((v) => !existingSet.has(v));
    const removedValues = existingValues.filter((v) => !desiredSet.has(v));

    // 5) Add new values (safe)
    for (const val of addedValues) {
      try {
        await client.query(
          `ALTER TYPE "${enumNameRaw}" ADD VALUE ${escapeSqlLiteral(val)}`
        );
        messages.push(
          `${colors.cyan}Added enum value '${val}' → "${enumNameRaw}"${colors.reset}`
        );
        changed++;
      } catch (err: any) {
        messages.push(
          `${colors.red}${colors.bold}ENUM ERROR adding '${val}' → "${enumNameRaw}": ${err.message}${colors.reset}`
        );
        errors++;
      }
    }

    // 6) Handle removals/renames — requires recreation
    if (removedValues.length === 0) {
      // nothing to remove; continue
      continue;
    }

    // count table rows using this enum type
    let tableCount = 0n;
    try {
      const cntRes = await client.query(
        `SELECT COUNT(*)::bigint AS cnt FROM "${tableName}"`
      );
      tableCount = BigInt(cntRes.rows[0].cnt);
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR counting rows in "${tableName}" for "${enumNameRaw}": ${err.message}${colors.reset}`
      );
      errors++;
      continue;
    }

    const hasData = tableCount > 0n;

    if (hasData && !options?.reset) {
      messages.push(
        `${colors.red}${colors.bold}ENUM BLOCKED: cannot remove/rename values on "${enumNameRaw}" — table "${tableName}" has ${tableCount} rows.${colors.reset}`
      );
      messages.push(
        `${colors.yellow}Use migrate({ reset: true }) to force destructive update (ALL DATA LOST).${colors.reset}`
      );
      errors++;
      continue;
    }

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

    // 7) Recreate enum: create tmp, alter columns to tmp, drop old, rename tmp->real
    const tmpEnumName = `${enumNameRaw}__morm_tmp_${Date.now()}_${Math.floor(
      Math.random() * 1000
    )}`;

    try {
      const valsSql = desiredValues.map(escapeSqlLiteral).join(", ");
      await client.query(`CREATE TYPE "${tmpEnumName}" AS ENUM (${valsSql})`);

      // convert columns that use the old enum to the tmp one (match udt_name case-insensitively)
      const colRes = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = LOWER($1)
           AND LOWER(udt_name) = LOWER($2)`,
        [tableName, enumNameRaw]
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

      await client.query(`DROP TYPE "${enumNameRaw}"`);
      await client.query(
        `ALTER TYPE "${tmpEnumName}" RENAME TO "${enumNameRaw}"`
      );

      messages.push(
        `${
          colors.magenta
        }Recreated enum "${enumNameRaw}" → [${desiredValues.join(", ")}] (${
          hasData ? "RESET" : "SAFE"
        })${colors.reset}`
      );
      changed++;
    } catch (err: any) {
      messages.push(
        `${colors.red}${colors.bold}ENUM ERROR recreating "${enumNameRaw}": ${err.message}${colors.reset}`
      );
      errors++;
      try {
        await client.query(`DROP TYPE IF EXISTS "${tmpEnumName}"`);
      } catch {}
    }
  } // for each enum

  return { changed, skipped, errors, ok: errors === 0 };
}
