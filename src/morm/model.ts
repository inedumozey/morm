import { validateDefaultValue } from "./utils/defaultValidator.js";
import { indexMigrations } from "./migrations/indexMigrations.js";
import { migrateEnums } from "./migrations/enumMigrations.js";
import { buildColumnSQL } from "./sql/buildColumnSQL.js";
import { diffTable } from "./migrations/diffTable.js";

import type { ColumnDefinition } from "./model-types.js";
import { colors } from "./utils/logColors.js";
import { parseCheck } from "./utils/checkParser.js";

/* canonical type used for validation (kept small and consistent with diffTable) */
function canonicalType(t: string | null | undefined): string {
  if (!t) return "";
  const raw = String(t).trim().toUpperCase();

  const map: Record<string, string> = {
    INT: "INTEGER",
    INTEGER: "INTEGER",
    SMALLINT: "SMALLINT",
    BIGINT: "BIGINT",
    TEXT: "TEXT",
    UUID: "UUID",
    BOOLEAN: "BOOLEAN",
    JSON: "JSON",
    JSONB: "JSONB",
    TIMESTAMP: "TIMESTAMP",
    TIMESTAMPTZ: "TIMESTAMPTZ",
    DATE: "DATE",
    TIME: "TIME",
    TIMETZ: "TIMETZ",
    NUMERIC: "NUMERIC",
    DECIMAL: "DECIMAL",
  };

  if (raw === "TIME WITH TIME ZONE") return "TIMEZ";
  if (raw === "TIMESTAMP WITHOUT TIME ZONE") return "TIMESTAMP";
  if (raw === "TIMESTAMP WITH TIME ZONE") return "TIMESTAMPTZ";

  const sansLength = raw.replace(/\(.+\)$/, "").trim();
  return map[raw] ?? map[sansLength] ?? sansLength;
}

export function createModelRuntime(
  morm: any,
  config: {
    table: string;
    columns: readonly ColumnDefinition[];
    indexes?: readonly string[] | undefined;
    enums?: any[] | undefined;
  }
) {
  const validationMessages: string[] = [];

  /** ENUM SETUP (store keys case-insensitively) */
  const enumSqls: string[] = [];
  const enumDefsByName = new Map<string, readonly string[]>(); // key = lower(enumName)
  const enumValsLowerByName = new Map<string, Set<string>>(); // key = lower(enumName), values lowercased

  if (Array.isArray(config.enums)) {
    for (const e of config.enums) {
      const enumNameRaw = String(e.name); // preserve original case for SQL
      const enumKey = enumNameRaw.toLowerCase(); // normalized key for lookups

      const vals = (e.values ?? [])
        .map((v: any) => `'${String(v).replace(/'/g, "''")}'`)
        .join(", ");

      // keep SQL using the exact name the user gave (so DB type matches user intention)
      enumSqls.push(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE LOWER(typname) = LOWER('${enumNameRaw}') ) THEN
          CREATE TYPE "${enumNameRaw}" AS ENUM (${vals});
        END IF;
      END $$;`);

      // store the enum definition keyed by lower-case name for case-insensitive lookups
      enumDefsByName.set(enumKey, e.values ?? []);
      enumValsLowerByName.set(
        enumKey,
        new Set((e.values ?? []).map((v: any) => String(v).toLowerCase()))
      );
    }
  }

  /** ENUM CONFLICT DETECTION (case-insensitive type names) */
  if (Array.isArray(config.enums)) {
    for (const e of config.enums) {
      const enumName = String(e.name);
      const lowerKey = enumName.toLowerCase();

      // If we already have an enum with the same name (case-insensitive)
      for (const [existingName, existingVals] of enumDefsByName.entries()) {
        if (existingName.toLowerCase() === lowerKey) {
          const newVals = (e.values ?? []).map((v: any) => String(v));
          const oldVals = existingVals.map((v: any) => String(v));

          const same =
            newVals.length === oldVals.length &&
            newVals.every((v: any, i: any) => v === oldVals[i]);

          if (!same) {
            validationMessages.push(
              `${colors.red}${colors.bold}MORM ENUM CONFLICT:${colors.reset} enum type "${enumName}" is defined in multiple models with different values.\n` +
                `  Previous: [${oldVals.join(", ")}]\n` +
                `  Current:  [${newVals.join(", ")}]`
            );
          }
        }
      }
    }
  }

  /** PROCESS COLUMNS into a mutable array for migration/runtime */
  type RuntimeColumn = ColumnDefinition & {
    name: string;
    __primary?: boolean;
    __renamed?: boolean;
    __identity?: boolean;
    __isEnumType?: boolean;
    __isArray?: boolean;
    __arrayInner?: string | null;
    __enumKey?: string | null;
  };

  const processed = (config.columns ?? []).map((c) => ({
    ...c,
  })) as RuntimeColumn[];

  /** AUTO-ADD TIMESTAMPS (TIMESTAMPTZ + now()) if missing */
  if (!processed.some((c) => c.name === "created_at")) {
    processed.push({
      name: "created_at",
      type: "TIMESTAMPTZ",
      notNull: true,
      default: "now()",
    } as RuntimeColumn);
  }

  if (!processed.some((c) => c.name === "updated_at")) {
    processed.push({
      name: "updated_at",
      type: "TIMESTAMPTZ",
      notNull: true,
      default: "now()",
    } as RuntimeColumn);
  }

  // ALLOWED SCALAR TYPES (canonical) - case-insensitive matching is applied via canonicalType()
  const ALLOWED_SCALAR = new Set([
    "INT",
    "INTEGER",
    "TEXT",
    "UUID",
    "BOOLEAN",
    "JSON",
    "JSONB",
    "TIMESTAMP",
    "TIMESTAMPTZ",
    "DATE",
    "TIME",
    "TIMETZ",
    "DECIMAL",
  ]);

  function parseTypeInfo(rawType: string) {
    const t = String(rawType).trim();
    const upper = t.toUpperCase();
    const isArray = upper.endsWith("[]");
    const base = isArray ? upper.slice(0, -2) : upper;
    return { raw: t, upper, isArray, base };
  }

  /** VALIDATION LOOP */
  for (const c of processed) {
    c.name = String(c.name);
    c.__primary = !!c.primary;

    const { upper, isArray, base } = parseTypeInfo(String(c.type));

    const enumExactNameRaw = String(c.type); // what the user wrote e.g. "ROLES" or "roles"
    const enumKeyForThisCol = enumExactNameRaw.toLowerCase();
    const enumKeyBase = enumKeyForThisCol.replace(/\[\]$/, "");

    const enumExistsExact =
      enumDefsByName.has(enumKeyForThisCol) ||
      (isArray && enumDefsByName.has(enumKeyBase));

    // canonicalize base type for validation (case-insensitive)
    const canonicalBase = canonicalType(base);

    if (!enumExistsExact && !ALLOWED_SCALAR.has(canonicalBase)) {
      validationMessages.push(
        `${colors.red}${colors.bold}MORM ERROR: column "${c.name}" has unknown type "${c.type}".${colors.reset}`
      );
      continue;
    }

    c.__isEnumType = enumDefsByName.has(enumKeyForThisCol) && !isArray;
    c.__isArray = isArray;
    c.__arrayInner = isArray ? base : null;
    c.__enumKey = c.__isEnumType ? enumKeyForThisCol : null;

    /** DEFAULT VALIDATION (unified, case-insensitive checks) */
    if (c.default !== undefined && c.default !== null) {
      const defaultErrors = validateDefaultValue({
        col: c,
        canonicalBase,
        isArray,
        // pass the enum name key & the precomputed lower-values set (case-insensitive type lookup)
        enumName: c.__isEnumType ? enumExactNameRaw : undefined,
        enumValuesLower: c.__isEnumType
          ? enumValsLowerByName.get(enumKeyForThisCol)
          : undefined,
      });

      if (defaultErrors.length > 0) {
        validationMessages.push(...defaultErrors);
        continue; // skip further checks for this column
      }
    }

    /** CHECK VALIDATION */
    if (c.check && !c.references) {
      try {
        // validate only — do NOT generate SQL here
        parseCheck(String(c.check));
      } catch (err: any) {
        validationMessages.push(
          `${colors.red}${colors.bold}MORM ERROR: invalid CHECK on "${c.name}": ${err.message}${colors.reset}`
        );
      }
    }

    /** RELATION VALIDATION */
    if (c.references && c.references.relation) {
      const rel = String(c.references.relation).toUpperCase();

      if (rel === "MANY-TO-MANY") {
        // MUST be array type
        if (!c.__isArray) {
          validationMessages.push(
            `${colors.red}${colors.bold}MORM ERROR: MANY-TO-MANY relation on column "${c.name}" requires an array type (e.g. UUID[]). Found: ${c.type}.${colors.reset}`
          );
          continue;
        }
      }

      if (rel === "ONE-TO-ONE" || rel === "ONE-TO-MANY") {
        // MUST NOT be array type
        if (c.__isArray) {
          validationMessages.push(
            `${colors.red}${colors.bold}MORM ERROR: ${rel} relation on column "${c.name}" cannot use an array type. Found: ${c.type}.${colors.reset}`
          );
          continue;
        }
      }
    }
  }

  /** VALIDATION FAILED → DO NOT MIGRATE THIS MODEL */
  if (validationMessages.length > 0) {
    console.log(
      `${colors.bold}${colors.red}MORM MIGRATION ERROR: model "${config.table}" validation failed${colors.reset}`
    );
    for (const msg of validationMessages) console.log("  " + msg);
    console.log("");

    morm._migrationSummary ??= [];
    morm._migrationSummary.push({
      table: config.table,
      ok: false,
      changed: 0,
      skipped: 0,
    });

    return {
      table: config.table,
      columns: processed,
      indexes: config.indexes ?? [],
      enums: config.enums,
      sql: { enumSqls, create: "", columns: "" },
      async migrate() {
        return false;
      },
    };
  }

  /** NORMAL TABLE CREATION SQL (used when table doesn't exist) */
  const columnsSQL = processed.map((c) => buildColumnSQL(c)).join(", ");
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS "${config.table}" (
      ${columnsSQL}
    );
  `;

  async function tableExists(client: any) {
    const res = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE LOWER(table_name) = LOWER($1)
       )`,
      [config.table]
    );
    return res.rows[0].exists;
  }

  async function ensureUpdatedAtTrigger(client: any) {
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION morm_set_updated_at()
        RETURNS trigger AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      const trig = `morm_trigger_${config.table}_updated_at`;
      const chk = await client.query(
        `SELECT 1 FROM pg_trigger WHERE tgname = $1`,
        [trig]
      );
      if (chk.rowCount === 0) {
        await client.query(`
          CREATE TRIGGER ${trig}
          BEFORE UPDATE ON "${config.table}"
          FOR EACH ROW
          EXECUTE FUNCTION morm_set_updated_at();
        `);
      }
    } catch {}
  }

  return {
    table: config.table,
    columns: processed,
    indexes: config.indexes ?? [],
    enums: config.enums,
    sql: { enumSqls, create: createTableSQL, columns: columnsSQL },

    async migrate(client: any, options?: { clean?: boolean; reset?: boolean }) {
      const messages: string[] = [];

      try {
        /** ENUM MIGRATIONS */
        await migrateEnums(
          client,
          config.table,
          config.enums as any,
          messages,
          options
        );

        /** CREATE / DIFF TABLE */
        if (!(await tableExists(client))) {
          try {
            await client.query(createTableSQL);
            messages.push(
              `${colors.green}Created table "${config.table}"${colors.reset}`
            );
            await ensureUpdatedAtTrigger(client);
          } catch (err: any) {
            // Bubble up so global migrate sees failure
            throw err;
          }
        } else {
          const diffMessages = await diffTable(
            client,
            { table: config.table },
            processed,
            options
          );
          if (diffMessages) messages.push(...diffMessages);
          await ensureUpdatedAtTrigger(client);
        }

        /** INDEX MIGRATION */
        await indexMigrations(client, config, messages);

        /** CLASSIFY CHANGE TYPES */
        const changed = messages.filter(
          (m) =>
            m.includes(colors.green) ||
            m.includes(colors.cyan) ||
            m.includes(colors.magenta)
        ).length;

        const skipped = messages.filter((m) =>
          m.includes(colors.yellow)
        ).length;

        /** NO logs & no summary: when NOTHING happened */
        if (messages.length === 0 && changed === 0 && skipped === 0) {
          return true; // completely silent
        }

        /** ALWAYS show messages if any exist */
        console.log(
          `${colors.bold}${colors.magenta}MORM MIGRATION: ${config.table}${colors.reset}`
        );
        for (const msg of messages) console.log("  " + msg);
        console.log("");

        /** SUMMARY only when REAL changes or FAILURES */
        if (changed > 0 || skipped > 0) {
          morm._migrationSummary ??= [];
          morm._migrationSummary.push({
            table: config.table,
            ok: true,
            changed,
            skipped,
          });
        }

        return true;
      } catch (err: any) {
        // Distinguish label for better logging (enum/default vs check vs other)
        const msgLower =
          typeof err.message === "string" ? err.message.toLowerCase() : "";
        const isCheckError =
          msgLower.includes("check") || msgLower.includes("check syntax");
        const isEnumError =
          msgLower.includes("enum") || msgLower.includes("enum error");

        const label = isCheckError
          ? "MORM CHECK ERROR"
          : isEnumError
          ? "MORM ENUM ERROR"
          : "MORM MODEL ERROR";

        console.error(
          `${colors.red}${colors.bold}${label} in model "${config.table}"${colors.reset}`
        );

        console.error(colors.red + err.message + colors.reset);

        try {
          await client.query("ROLLBACK");
        } catch {}

        return false;
      }
    },
  };
}
