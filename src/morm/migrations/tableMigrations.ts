// migrations/tableMigrations.ts

import { buildColumnSQL } from "../sql/buildColumnSQL.js";
import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function getDbTables(client: any): Promise<string[]> {
  const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  return res.rows.map((r: any) => r.table_name);
}

async function isTableReferenced(
  client: any,
  table: string
): Promise<string[]> {
  const res = await client.query(
    `
    SELECT tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND LOWER(ccu.table_name) = LOWER($1)
    `,
    [table]
  );

  return res.rows.map((r: any) => r.table_name);
}

/**
 * Junction tables are managed elsewhere — never touch
 */
function isManagedJunction(table: string, models: any[]): boolean {
  if (!table.endsWith("_junction")) return false;

  const modelTables = new Set(models.map((m) => m.table));
  const base = table.replace(/_junction$/, "");
  const parts = base.split("_");
  if (parts.length !== 2) return false;

  return modelTables.has(parts[0]) && modelTables.has(parts[1]);
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function tableMigrations(
  client: any,
  models: { table: string; columns: any[] }[]
) {
  const modelTables = models.map((m) => m.table);
  const dbTables = await getDbTables(client);

  const dbBaseTables = dbTables.filter((t) => !isManagedJunction(t, models));

  const modelBaseTables = modelTables.filter(
    (t) => !isManagedJunction(t, models)
  );

  const removed = dbBaseTables.filter((t) => !modelBaseTables.includes(t));

  const added = modelBaseTables.filter((t) => !dbBaseTables.includes(t));

  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();

  /* ===================================================== */
  /* MULTI RENAME (POSITIONAL, SAFE)                       */
  /* ===================================================== */

  const renames: Array<{ from: string; to: string }> = [];

  if (removed.length === added.length && removed.length > 0) {
    for (let i = 0; i < removed.length; i++) {
      const from: any = removed[i];
      const to: any = added[i];

      const refs = await isTableReferenced(client, from);
      if (refs.length > 0) {
        console.log(
          `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
        );
        console.log(`  ${colors.subject}${from}${colors.reset}`);
        console.log(
          `    ${colors.error}Cannot RENAME table:${colors.reset} referenced by`
        );
        for (const r of refs) {
          console.log(`      ${colors.subject}${r}${colors.reset}`);
        }
        console.log(`    Run morm.migrate({ reset: true }) to reset database`);
        console.log("");
        return false;
      }
      renames.push({ from, to });
      renamedFrom.add(from);
      renamedTo.add(to);
    }
  }

  for (const r of renames) {
    await client.query(`ALTER TABLE ${q(r.from)} RENAME TO ${q(r.to)}`);
  }

  /* ===================================================== */
  /* RELOAD TABLES AFTER RENAME                            */
  /* ===================================================== */

  const dbTablesAfterRename = await getDbTables(client);

  /* ===================================================== */
  /* CREATE TABLES                                        */
  /* ===================================================== */

  const created: string[] = [];

  for (const model of models) {
    if (
      !dbTablesAfterRename.includes(model.table) &&
      !renamedTo.has(model.table) &&
      !isManagedJunction(model.table, models)
    ) {
      const cols = model.columns
        .filter((c) => !c.__virtual)
        .map((c) => buildColumnSQL(c))
        .filter(Boolean);

      await client.query(`CREATE TABLE ${q(model.table)} (${cols.join(", ")})`);

      created.push(model.table);
    }
  }

  /* ===================================================== */
  /* DROP TABLES (ONLY IF NOT RENAMED)                     */
  /* ===================================================== */

  const dropped: string[] = [];

  for (const table of dbTablesAfterRename) {
    if (
      !modelTables.includes(table) &&
      !renamedFrom.has(table) &&
      !isManagedJunction(table, models)
    ) {
      await client.query(`DROP TABLE ${q(table)}`);
      dropped.push(table);
    }
  }

  /* ===================================================== */
  /* LOGGING                                              */
  /* ===================================================== */

  if (renames.length || created.length || dropped.length) {
    console.log(
      `${colors.section}${colors.bold}MODEL MIGRATION:${colors.reset}`
    );

    for (const r of renames) {
      console.log(
        `  ${colors.processing}Renamed TABLE:${colors.reset} ${colors.subject}${r.from} → ${r.to}${colors.reset}`
      );
    }

    if (created.length) {
      console.log(
        `  ${colors.success}Created TABLES:${colors.reset} ${
          colors.subject
        }${created.join(", ")}${colors.reset}`
      );
    }

    if (dropped.length) {
      console.log(
        `  ${colors.success}Dropped TABLES:${colors.reset} ${
          colors.subject
        }${dropped.join(", ")}${colors.reset}`
      );
    }

    console.log("");
  }

  return true;
}
