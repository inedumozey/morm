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

export function createModelRuntime(
  morm: any,
  config: {
    table: string;
    columns: readonly ColumnDefinition[];
    indexes?: readonly string[] | undefined;
    sanitize?: boolean | "strict";
  }
) {
  const userDefinedCreatedAt = config.columns.some(
    (c) => String(c.name).trim().toLowerCase() === "created_at"
  );

  const userDefinedUpdatedAt = config.columns.some(
    (c) => String(c.name).trim().toLowerCase() === "updated_at"
  );

  const validationMessages: string[] = [];

  type RuntimeColumn = any & {
    name: string;
    __primary?: boolean;
    __renamed?: boolean;
    __identity?: boolean;
    __isArray?: boolean;
    __arrayInner?: string | null;
    __virtual?: boolean;
    sanitize?: boolean | "strict";
    __isEnum?: boolean;
    __enumName?: string;
    __enumValuesLower?: Set<string>;
  };

  /* ---------- GET ALL COLUMNS (PROPERTIS + VALUES) ---------- */
  const processed: RuntimeColumn[] = config.columns.map((c) => ({ ...c }));

  /* ---------- AUTO TIMESTAMPS ---------- */
  if (!userDefinedCreatedAt) {
    processed.push({
      name: "created_at",
      type: "TIMESTAMPTZ",
      notNull: true,
      default: "now()",
    });
  }

  if (!userDefinedUpdatedAt) {
    processed.push({
      name: "updated_at",
      type: "TIMESTAMPTZ",
      notNull: true,
      default: "now()",
    });
  }

  /** TYPE INFO PARSER --------------------------------------------------------- */
  function parseTypeInfo(rawType: string) {
    const t = String(rawType).trim();
    const upper = t.toUpperCase();
    const isArray = upper.endsWith("[]"); // check for array => true | false
    const base = isArray ? upper.slice(0, -2) : upper; // get base type (TEXT[] => TEXT, TEXT=> TEXT)
    return { isArray, base };
  }

  /* MAIN LOOP ---------------------------------------------------------------- */
  for (const c of processed) {
    c.name = String(c.name).toLowerCase();
    // console.log(c);
    c.__primary = !!c.primary;
    const { isArray, base } = parseTypeInfo(String(c.type));
    c.__isArray = isArray; // IS THE COLUMN AN ARRAY?
    c.__arrayInner = isArray ? base : null; // GET THE INNER TYPE IF ARRAY
    const d =
      c.default == "string" ? c.default.trim().toLowerCase() : c.default;

    const rawType = String(c.type).trim();
    const upperType = rawType.toUpperCase();

    // Detect enum type (non-built-in, non-array)
    if (!upperType.endsWith("[]") && morm.enumRegistry?.has(upperType)) {
      const enumDef = morm.enumRegistry.get(upperType);

      c.__isEnum = true;
      c.__enumName = upperType;
      c.__enumValuesLower = new Set(
        enumDef.values.map((v: string) => v.toLowerCase())
      );
    }

    /** VALIDATE DEFAULT VALUE -------------------------------------------------- */
    if (c.default) {
      const errs = validateDefaultValue({
        col: c,
        base,
        isArray,
        enumValuesLower: c.__enumValuesLower,
      });

      for (const err of errs) {
        validationMessages.push(
          `${colors.error}${colors.bold}${err}${colors.reset}`
        );
      }
    }

    /* ADD IDENTITY TO COLUMN -------------------------------------------------------------- */
    {
      if (
        (d === "int()" && base === "INT") ||
        (d === "smallint()" && base === "SMALLINT") ||
        (d === "bigint()" && base === "BIGINT")
      ) {
        c.__identity = true;
      }
    }

    /** VALIDATE AND PARSE CHECK VALUE --------------------------------------------------- */
    if (c.check && !c.references) {
      try {
        parseCheck(String(c.check));
      } catch (err: any) {
        validationMessages.push(`Invalid check on ${c.name}: ${err.message}`);
      }
    }

    /* MARK COLUMNS WITH MANY-TO-MANY VIRTUAL COLUMNS----------------------------- */
    if (c.references?.relation) {
      const rel = normalizeRelation(c.references.relation);
      // ONE-TO-ONE implies UNIQUE and (by default) NOT NULL
      if (rel === "ONE-TO-ONE") {
        if (c.notNull !== false) {
          c.notNull = true;
        }
        c.unique = true;
      }

      if (rel === "MANY-TO-MANY") {
        c.__virtual = true;
        continue;
      }
    }
  }

  /* VALIDATION FAILED ----------------------------------------------------------- */
  if (validationMessages.length > 0) {
    console.log(
      `${colors.section}${colors.bold}MODEL VALIDATION:${colors.reset}`
    );
    console.log(`  ${colors.subject}${config.table}${colors.reset}`);

    for (const msg of validationMessages) {
      console.log(
        `    ${colors.error}Invalid:${colors.reset} ${
          colors.subject
        }${msg.replace(/^.*?:\s*/, "")}${colors.reset}`
      );
    }

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
      sql: { create: "", columns: "" },
      async migrate() {
        return false;
      },
    };
  }

  /* SQL ------------------------------------------------------------------------- */
  const columnsSQL = processed
    .map((c) => buildColumnSQL(c))
    .filter(Boolean)
    .join(", ");

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS "${config.table}" (
      ${columnsSQL}
    );
  `;

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
        `SELECT 1 FROM pg_trigger WHERE tgname=$1`,
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

  function sanitizeRow(data: Record<string, any>) {
    const out = { ...data };
    for (const col of processed) {
      const mode = shouldSanitize(config.sanitize ?? false, col.sanitize);
      if (!mode || !(col.name in out)) continue;

      const type = String(col.type).toUpperCase();
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

    async migrate(client: any, createdTables?: Set<string>) {
      const messages: string[] = [];
      if (createdTables?.has(config.table)) {
        return true;
      }
      try {
        const diff = await diffTable(
          client,
          { table: config.table },
          processed
        );
        if (diff) messages.push(...diff);
        await ensureUpdatedAtTrigger(client);

        const indexChanges = await indexMigrations(client, config);

        if (indexChanges.length > 0) {
          morm._indexSummary ??= new Map();
          morm._indexSummary.set(config.table, indexChanges);
        }

        const changed = messages.filter((m) =>
          m.includes(colors.success)
        ).length;
        const skipped = messages.filter((m) => m.includes(colors.warn)).length;

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
        console.log(
          `${colors.section}${colors.bold}MODEL MIGRATION:${colors.reset}`
        );
        console.log(
          ` ${colors.reset} ${colors.subject}${config.table}${colors.reset}`
        );
        console.log(
          `     ${colors.error}Aborted: ${colors.subject}${err.message}${colors.reset}`
        );
        return false;
      }
    },
  };
}
