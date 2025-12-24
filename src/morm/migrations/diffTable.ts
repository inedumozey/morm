import { colors } from "../utils/logColors.js";
import { alterColumnCheck } from "./alterColumnCheck.js";
import { alterColumn } from "./alterColumn.js";
import { alterColumnTypes } from "./alterColumnTypes.js";
import { alterColumnNullity } from "./alterColumnNullity.js";
import { alterColumnUnique } from "./alterColumnUnique.js";
import { alterColumnDefault } from "./alterColumnDefault.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type Row = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
};

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

/* ===================================================== */
/* DB READERS                                            */
/* ===================================================== */

async function batchCounts(client: any, table: string, cols: string[]) {
  try {
    const parts = cols.map((c) => `count(${q(c)}) as ${q(c)}`).join(", ");
    const r = await client.query(
      `SELECT count(*) as total, ${parts} FROM ${q(table)}`
    );
    const row = r.rows[0];
    const total = Number(row.total || 0);
    const nonNull: Record<string, number> = {};
    cols.forEach((c) => (nonNull[c] = Number(row[c] || 0)));
    return { total, nonNull };
  } catch {
    return null;
  }
}

export async function diffTable(
  client: any,
  config: { table: string },
  processed: any[]
) {
  const alters: string[] = [];
  const messages: string[] = [];

  const res = await client.query(
    `
    SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND LOWER(table_name) = LOWER($1)
    `,
    [config.table]
  );

  const existing = new Map<string, Row>(
    res.rows.map((r: Row) => [r.column_name, r])
  );

  const existingNames = Array.from(existing.keys());
  const counts = await batchCounts(client, config.table, existingNames);

  /* 1. ---------- CREATE OR ALTER COLUMN NAMES ---------- */
  {
    const rename = await alterColumn({
      client,
      table: config.table,
      existing,
      processed,
      messages,
      counts,
    });
    if (!rename.ok) {
      return false;
    }
  }

  /* 2. ---------- CREATE OR ALTER COLUMN TYPES ---------- */
  {
    const typeRes = await alterColumnTypes({
      client,
      table: config.table,
      existing,
      processed,
      counts,
      messages,
    });
    if (!typeRes.ok) {
      return false;
    }
  }

  /* 3. ---------- CREATE OR ALTER NULL CONSTRAINT ---------- */
  {
    const typeNull = await alterColumnNullity({
      client,
      table: config.table,
      existing,
      processed,
      counts,
      messages,
    });
    if (!typeNull.ok) {
      return false;
    }
  }

  /* 4. ---------- CREATE OR ALTER NULL CONSTRAINT ---------- */
  {
    const typeUnique = await alterColumnUnique({
      client,
      table: config.table,
      processed,
      counts,
      messages,
    });
    if (!typeUnique.ok) {
      return false;
    }
  }

  /* 5. ---------- CREATE OR ALTER CHECK CONSTRAINT ---------- */
  {
    const typeCheck = await alterColumnCheck({
      client,
      table: config.table,
      processed,
      messages,
    });
    if (!typeCheck.ok) {
      return false;
    }
  }

  /* 6. ---------- CREATE / UPDATE / DROP DEFAULT ---------- */
  {
    const typeDefault = await alterColumnDefault({
      client,
      table: config.table,
      existing,
      processed,
      messages,
    });
    if (!typeDefault.ok) {
      return false;
    }
  }

  /* ---------- PRINT LOGS (ONCE) ---------- */
  if (messages.length > 0) {
    console.log(
      `${colors.section}${colors.bold}MODEL MIGRATION:${colors.reset}`
    );
    console.log(`  ${colors.subject}${config.table}${colors.reset}`);
    for (const m of messages) {
      console.log(`    ${m}`);
    }
    console.log("");
  }

  /* ===================================================== */
  /* APPLY                                                 */
  /* ===================================================== */

  if (alters.length > 0) {
    await client.query(`ALTER TABLE ${q(config.table)} ${alters.join(", ")}`);
    return messages;
  }

  return [];
}
