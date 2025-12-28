// migrations/dropAddTable.ts

import { buildColumnSQL } from "../sql/buildColumnSQL.js";
import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function tableExists(client: any, table: string): Promise<boolean> {
  const r = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND LOWER(table_name) = LOWER($1)
    `,
    [table]
  );
  return r.rowCount > 0;
}

async function tableHasData(client: any, table: string): Promise<boolean> {
  const r = await client.query(`SELECT 1 FROM ${q(table)} LIMIT 1`);
  return r.rowCount > 0;
}

async function tableIsReferenced(
  client: any,
  table: string
): Promise<string[]> {
  const r = await client.query(
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

  return r.rows.map((r: any) => r.table_name);
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function dropAddTable(opts: {
  client: any;
  table: string;
  modelTables: Set<string>;
  modelColumns?: any[];
  messages: string[];
}): Promise<{ ok: boolean; created?: boolean }> {
  const { client, table, modelTables, modelColumns, messages } = opts;

  const exists = await tableExists(client, table);

  /* ===================================================== */
  /* CREATE TABLE                                         */
  /* ===================================================== */

  if (!exists && modelTables.has(table)) {
    if (!modelColumns || modelColumns.length === 0) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Cannot CREATE table:${colors.reset} no columns defined`
      );
      console.log("");
      return { ok: false };
    }

    const cols = modelColumns
      .filter((c) => !c.__virtual)
      .map((c) => buildColumnSQL(c))
      .filter(Boolean);

    await client.query(`CREATE TABLE ${q(table)} (${cols.join(", ")})`);

    messages.push(
      `${colors.success}Created TABLE:${colors.reset} ${colors.subject}${table}${colors.reset}`
    );

    return { ok: true };
  }

  /* ===================================================== */
  /* DROP TABLE                                           */
  /* ===================================================== */

  if (exists && !modelTables.has(table)) {
    if (await tableHasData(client, table)) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Cannot DROP table:${colors.reset} table contains data`
      );
      console.log(
        `    Run morm.migration({ reset: true }) to reset the database`
      );
      console.log("");
      return { ok: false };
    }

    const refs = await tableIsReferenced(client, table);
    if (refs.length > 0) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Cannot DROP table:${colors.reset} referenced by`
      );
      for (const r of refs) {
        console.log(`      ${colors.subject}${r}${colors.reset}`);
      }
      console.log("");
      return { ok: false };
    }

    await client.query(`DROP TABLE ${q(table)}`);

    messages.push(
      `${colors.success}Dropped TABLE:${colors.reset} ${colors.subject}${table}${colors.reset}`
    );
  }

  return { ok: true, created: true };
}
