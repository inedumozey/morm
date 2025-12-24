// model.ts

import { validateDefaultValue } from "./utils/defaultValidator.js";
import { indexMigrations } from "./migrations/indexMigrations.js";
import { buildColumnSQL } from "./sql/buildColumnSQL.js";
import { diffTable } from "./migrations/diffTable.js";
import { sanitizeText, shouldSanitize } from "./utils/sanitize.js";
import type { ColumnDefinition } from "./model-types.js";
import { colors } from "./utils/logColors.js";
import { parseCheck } from "./utils/checkParser.js";
import { normalizeRelation } from "./utils/relationValidator.js";
import { canonicalType } from "./utils/canonicalType.js";

export function createModelRuntime(
  morm: any,
  config: {
    table: string;
    columns: readonly ColumnDefinition[];
    indexes?: readonly string[] | undefined;
    sanitize?: boolean | "strict";
  }
) {
  const validationMessages: string[] = [];

  /** PROCESS COLUMNS into a mutable array for migration/runtime */
  type RuntimeColumn = ColumnDefinition & {
    name: string;
    __primary?: boolean;
    __renamed?: boolean;
    __identity?: boolean;
    __isArray?: boolean;
    __arrayInner?: string | null;
    __virtual?: boolean;
    sanitize?: boolean | "strict";
  };

  // clone columns once
  const processed: RuntimeColumn[] = config.columns.map((c) => ({ ...c }));

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

    // RELATION VALIDATION (MODEL LEVEL)
    if (c.references && c.references.relation) {
      const rel = normalizeRelation(c.references.relation);
      // MANY-TO-MANY
      if (rel === "MANY-TO-MANY") {
        c.__virtual = true;

        // MM columns NEVER produce SQL
        continue;
      }
    }

    const { isArray, base } = parseTypeInfo(String(c.type));

    // canonicalize base type for validation (case-insensitive)
    const canonicalBase = canonicalType(base);

    c.__isArray = isArray;
    c.__arrayInner = isArray ? base : null;

    /** DEFAULT VALIDATION (unified, case-insensitive checks) */
    if (c.default !== undefined && c.default !== null) {
      const defaultErrors = validateDefaultValue({
        col: c,
        canonicalBase,
        isArray,
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
  }

  /** VALIDATION FAILED → DO NOT MIGRATE THIS MODEL */
  if (validationMessages.length > 0) {
    console.log(
      `${colors.bold}${colors.red}MORM MIGRATION ERROR: model "${config.table}" validation failed${colors.reset}`
    );
    for (const msg of validationMessages) console.log("  " + msg);
    console.log("");

    return {
      table: config.table,
      columns: processed,
      indexes: config.indexes ?? [],
      sql: { create: "", columns: "" },
      async migrate() {
        return false;
      },
    };
  }

  /** NORMAL TABLE CREATION SQL (used when table doesn't exist) */
  const columnsSQL = processed
    .map((c) => buildColumnSQL(c))
    .filter((sql) => sql && sql.trim().length > 0)
    .join(", ");

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

  // SANITIZE
  function sanitizeRow(data: Record<string, any>) {
    const out: Record<string, any> = { ...data };

    for (const col of processed) {
      const mode = shouldSanitize(config.sanitize ?? false, col.sanitize);

      if (!mode) continue;
      if (!(col.name in out)) continue;

      const type = String(col.type).toUpperCase();

      // Only sanitize text-like columns
      if (type === "TEXT" || type.startsWith("VARCHAR")) {
        out[col.name] = sanitizeText(out[col.name], mode);
      }
    }

    return out;
  }

  const primaryKey = processed.find((c) => c.__primary)?.name ?? "id";

  return {
    table: config.table,
    primaryKey,
    columns: processed,
    indexes: config.indexes ?? [],
    sql: { create: createTableSQL, columns: columnsSQL },
    sanitize: config.sanitize ?? false,
    sanitizeRow,

    async migrate(client: any, options?: { clean?: boolean; reset?: boolean }) {
      const messages: string[] = [];

      try {
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

        /** NO logs when NOTHING happened */
        if (messages.length === 0 && changed === 0 && skipped === 0) {
          return true; // completely silent
        }

        /** ALWAYS show messages if any exist */
        console.log(
          `${colors.bold}${colors.magenta}MORM MIGRATION: ${config.table}${colors.reset}`
        );
        for (const msg of messages) console.log("  " + msg);
        console.log("");

        return true;
      } catch (err: any) {
        // Distinguish label for better logging (enum/default vs check vs other)
        const msgLower =
          typeof err.message === "string" ? err.message.toLowerCase() : "";
        const isCheckError =
          msgLower.includes("check") || msgLower.includes("check syntax");
        const label = isCheckError ? "MORM CHECK ERROR" : "MORM MODEL ERROR";

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
