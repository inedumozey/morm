import { indexMigrations } from "./migrations/indexMigrations.js";
import { migrateEnums } from "./migrations/enumMigrations.js";
import { buildColumnSQL } from "./sql/buildColumnSQL.js";
import { diffTable } from "./migrations/diffTable.js";

import type { ColumnDefinition } from "./model-types.js";
import { colors } from "./utils/logColors.js";

/* createModelRuntime: runtime-only (no compile-time generics) */
export function createModelRuntime(
  morm: any,
  config: {
    table: string;
    columns: readonly ColumnDefinition[];
    indexes?: readonly string[] | undefined;
    enums?: any[] | undefined;
  }
) {
  // Create enum SQLs first
  const enumSqls: string[] = [];
  if (Array.isArray(config.enums)) {
    for (const e of config.enums) {
      const vals = e.values
        .map((v: any) => `'${v.replace("'", "''")}'`)
        .join(", ");
      enumSqls.push(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${e.name}') THEN
          CREATE TYPE "${e.name}" AS ENUM (${vals});
        END IF;
      END $$;`);
    }
  }

  // Runtime column type with optional rename marker
  type RuntimeColumn = ColumnDefinition & {
    name: string;
    __primary?: boolean;
    __renamed?: boolean;
  };

  // Process columns
  const processed = config.columns.map((col) => {
    const name = col.name;
    const isPrimary = !!col.primary;
    return {
      ...col,
      name,
      __primary: isPrimary,
    } as RuntimeColumn;
  });

  // ===== RUNTIME VALIDATION: single primary key =====
  const primaryCols = processed.filter((c: any) => c.__primary);

  if (primaryCols.length > 1) {
    const list = primaryCols.map((c: any) => `"${c.name}"`).join(", ");

    console.log(
      `${colors.red}${colors.bold}MORM MIGRATION ERROR: table "${config.table}" has multiple primary keys:${colors.reset}`
    );
    console.log(`  ${colors.red}${list}${colors.reset}`);
    console.log(
      `  ${colors.yellow}Only one primary key is allowed.${colors.reset}`
    );
    console.log("");

    // Stop this model’s migration but DO NOT crash
    return {
      table: config.table,
      columns: processed,
      migrate: async () => false,
    };
  }

  // Prevent empty column list
  if (processed.length === 0) {
    throw new Error(`Model '${config.table}' must define at least one column.`);
  }

  const columnsSQL = processed.map((c) => buildColumnSQL(c)).join(", ");

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS "${config.table}" (
      ${columnsSQL}
    );
  `;

  async function tableExists(client: any) {
    try {
      const res = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = $1
        )`,
        [config.table]
      );
      return res.rows[0].exists;
    } catch (err: any) {
      console.error(
        `${colors.red}${colors.bold}MORM MIGRATION ERROR checking table existence:${colors.reset}`
      );
      console.error(`${colors.red}${err.message}${colors.reset}`);
      return false;
    }
  }

  return {
    table: config.table,
    columns: processed,
    indexes: config.indexes ?? [],
    enums: config.enums,
    sql: {
      enumSqls,
      create: createTableSQL,
      columns: columnsSQL,
    },

    async migrate(client: any, options?: { clean?: boolean; reset?: boolean }) {
      try {
        const messages: string[] = [];

        // ENUM MIGRATION =-- FIRST
        await migrateEnums(
          client,
          config.table,
          config.enums as any,
          messages,
          options
        );

        // CREATE OR UPDATE TABLE
        if (!(await tableExists(client))) {
          try {
            await client.query(createTableSQL);
            messages.push(
              `${colors.green}Created table "${config.table}"${colors.reset}`
            );
          } catch (err: any) {
            console.error(
              `${colors.red}${colors.bold}MORM MIGRATION ERROR creating table "${config.table}":${colors.reset}`
            );
            console.error(`${colors.red}${err.message}${colors.reset}`);
          }
        } else {
          const diffMessages = await diffTable(
            client,
            { table: config.table },
            processed,
            options
          );
          if (!diffMessages) {
            await client.query("ROLLBACK");
            return false;
          }
          messages.push(...diffMessages);
        }

        // MIGRATE INDEXES =-- LAST
        await indexMigrations(client, config, messages);

        const changed = messages.filter(
          (m) =>
            m.includes(`${colors.green}`) ||
            m.includes(`${colors.cyan}`) ||
            m.includes(`${colors.magenta}`)
        ).length;
        const skipped = messages.filter((m) =>
          m.includes(`${colors.yellow}`)
        ).length;

        if (changed > 0 || skipped > 0) {
          console.log(
            `${colors.bold}${colors.magenta}MORM MIGRATION: ${config.table}${colors.reset}`
          );
          for (const msg of messages) console.log("  " + msg);
          console.log("");
        }

        return true;
      } catch (err: any) {
        console.error(
          `${colors.red}${colors.bold}MORM ERROR in model migrate "${config.table}":${colors.reset}`
        );
        console.error(`${colors.red}${err.message}${colors.reset}`);
        return false;
      }
    },
  };
}
