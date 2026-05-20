// model.ts

import { validateDefaultValue } from "./utils/defaultValidator.js";
import { validateColumnType } from "./utils/validateColumnType.js";
import { indexMigrations } from "./migrations/indexMigrations.js";
import { buildColumnSQL } from "./sql/buildColumnSQL.js";
import { diffTable } from "./migrations/diffTable.js";
import { sanitizeText, resolveSanitize } from "./utils/sanitize.js";
import type { SanitizeConfig } from "./utils/sanitize.js";
import type { ColumnDefinition } from "./model-types.js";
import type { IndexDefinition } from "./migrations/indexMigrations.js";
import { normalizeRelation } from "./utils/relationValidator.js";
import { reporter } from "./utils/migrationReporter.js";

export function createModelRuntime(
  morm: any,
  config: {
    table: string;
    columns: readonly ColumnDefinition[];
    indexes?: readonly IndexDefinition[] | undefined;
    primaryKey?: string[];
    sanitize?: SanitizeConfig;
  },
) {
  const userDefinedCreatedAt = config.columns.some(
    (c) => String(c.name).trim().toLowerCase() === "created_at",
  );

  const userDefinedUpdatedAt = config.columns.some(
    (c) => String(c.name).trim().toLowerCase() === "updated_at",
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
    sanitize?: SanitizeConfig;
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
    // Strip modifier before checking for array e.g. "VARCHAR(255)[]" → "VARCHAR[]"
    const withoutModifier = upper.replace(/\s*\(.*?\)/, "");
    const isArray = withoutModifier.endsWith("[]");
    const base = isArray ? withoutModifier.slice(0, -2) : withoutModifier;
    return { isArray, base };
  }

  /* MAIN LOOP ---------------------------------------------------------------- */
  for (const c of processed) {
    const originalName = String(c.name);
    c.name = originalName.toLowerCase();

    /* WARN IF NAME WAS NOT LOWERCASE ----------------------------------------- */
    if (originalName !== c.name) {
      reporter.addWarning({
        section: "NAME",
        table: config.table,
        message: `Column "${originalName}" was lowercased to "${c.name}" — define column names in lowercase to avoid confusion`,
      });
    }

    c.__primary = !!c.primary || (config.primaryKey?.includes(c.name) ?? false);
    c.__compositePk = config.primaryKey?.includes(c.name) ?? false;

    const { isArray, base } = parseTypeInfo(String(c.type));
    c.__isArray = isArray;
    c.__arrayInner = isArray ? base : null;
    const d =
      typeof c.default === "string"
        ? c.default.trim().toLowerCase()
        : c.default;

    const rawType = String(c.type).trim();
    const upperType = rawType.toUpperCase();

    /* VALIDATE COLUMN TYPE --------------------------------------------------- */
    const typeErrors = validateColumnType(rawType);
    for (const err of typeErrors) {
      validationMessages.push(`Column "${c.name}": ${err}`);
    }

    // Detect enum type (non-built-in, non-array) — strip modifier first
    const upperTypeBase = upperType.replace(/\s*\(.*?\)/, "").trim();
    if (!upperTypeBase.endsWith("[]") && morm.hasEnum?.(upperTypeBase)) {
      const enumDef = morm.getEnum?.(upperTypeBase);

      c.__isEnum = true;
      c.__enumName = upperType;
      c.__enumValuesLower = new Set(
        enumDef.values.map((v: string) => v.toLowerCase()),
      );
      c.__enumValues = new Set(enumDef.values);
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
        validationMessages.push(err);
      }
    }

    /* ADD IDENTITY TO COLUMN -------------------------------------------------------------- */
    {
      if (
        (d === "int()" && (base === "INT" || base === "INTEGER")) ||
        (d === "smallint()" && base === "SMALLINT") ||
        (d === "bigint()" && base === "BIGINT")
      ) {
        c.__identity = true;
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
        c.__isOneToOne = true;
      }

      if (rel === "MANY-TO-MANY") {
        c.__virtual = true;
        continue;
      }
    }
  }

  /* DUPLICATE COLUMN NAMES ---------------------------------------------------- */
  const columnNames = processed.map((c) => c.name);
  const duplicates = columnNames.filter((n, i) => columnNames.indexOf(n) !== i);
  if (duplicates.length > 0) {
    validationMessages.push(
      `Duplicate column name${duplicates.length > 1 ? "s" : ""}: ${[...new Set(duplicates)].join(", ")} — each column name must be unique`,
    );
  }

  /* UNIQUE WITH STATIC DEFAULT ---------------------------------------------------- */
  for (const c of processed) {
    if (c.unique && c.default !== undefined && !c.__primary) {
      const def =
        typeof c.default === "string"
          ? c.default.trim().toLowerCase()
          : c.default;
      if (
        def !== "uuid()" &&
        def !== "int()" &&
        def !== "smallint()" &&
        def !== "bigint()" &&
        def !== null
      ) {
        validationMessages.push(
          `Column "${c.name}" is UNIQUE but has a static default "${c.default}" — every row without an explicit value will collide. Use uuid(), int(), smallint(), bigint(), or null instead, or remove the default`,
        );
      }
    }
  }

  /* NO PRIMARY KEY ---------------------------------------------------------------- */
  const hasPrimaryKey = processed.some((c) => c.__primary);
  if (!hasPrimaryKey) {
    validationMessages.push(
      `Table "${config.table}" has no PRIMARY KEY — add primary: true to a column or use primaryKey: ["col1", "col2"] for composite keys`,
    );
  }

  /* VALIDATE COMPOSITE PRIMARY KEY ------------------------------------------------ */
  if (config.primaryKey && config.primaryKey.length > 0) {
    if (config.primaryKey.length === 1) {
      validationMessages.push(
        `Table "${config.table}" — primaryKey with a single column is not allowed, use primary: true on the column instead`,
      );
    }
    const columnNameSet = new Set(processed.map((c) => c.name));
    for (const pk of config.primaryKey) {
      if (!columnNameSet.has(pk)) {
        validationMessages.push(
          `Table "${config.table}" — primaryKey references "${pk}" which does not exist in columns`,
        );
      }
    }
  }

  /* VALIDATION FAILED ----------------------------------------------------------- */
  if (validationMessages.length > 0) {
    for (const msg of validationMessages) {
      reporter.addError({
        section: "MODEL",
        table: config.table,
        message: msg,
      });
    }

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

  const compositePkSQL = config.primaryKey?.length
    ? `, PRIMARY KEY (${config.primaryKey.map((k) => `"${k}"`).join(", ")})`
    : "";

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS "${config.table}" (
      ${columnsSQL}${compositePkSQL}
    );
  `;

  async function ensureUpdatedAtTrigger(client: any) {
    try {
      // The morm_set_updated_at() function is created once at DB level
      // in morm.ts before this runs — here we only attach the trigger
      // to this specific table if it doesn't already exist.
      const trig = `morm_trigger_${config.table}_updated_at`;
      const chk = await client.query(
        `SELECT 1 FROM pg_trigger WHERE tgname = $1`,
        [trig],
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

  const primaryKey: string | string[] = config.primaryKey?.length
    ? config.primaryKey
    : (processed.find((c) => c.__primary)?.name ?? "id");

  return {
    table: config.table,
    primaryKey,
    columns: processed,
    indexes: config.indexes ?? [],
    sql: { create: createTableSQL, columns: columnsSQL },
    sanitize: config.sanitize ?? undefined,

    async migrate(client: any, createdTables?: Set<string>) {
      if (createdTables?.has(config.table)) return true;

      try {
        const ok = await diffTable(
          client,
          {
            table: config.table,
            ...(config.primaryKey && { primaryKey: config.primaryKey }),
          },
          processed,
        );
        if (!ok)
          throw new Error(`Migration failed for table "${config.table}"`);

        await ensureUpdatedAtTrigger(client);

        const indexResult = await indexMigrations(client, config);

        if (indexResult.created.length > 0) {
          reporter.addIndex({
            kind: "created",
            table: config.table,
            names: indexResult.created,
          });
        }
        if (indexResult.dropped.length > 0) {
          reporter.addIndex({
            kind: "dropped",
            table: config.table,
            names: indexResult.dropped,
          });
        }

        return true;
      } catch (err: any) {
        reporter.addError({
          section: "MIGRATION",
          table: config.table,
          message: err.message,
        });
        return false;
      }
    },
  };
}
