// migrations/alterPrimaryKey.ts

import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type Counts = {
  total: number;
};

type DbPrimaryKey = {
  name: string;
  column: string;
} | null;

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function getPrimaryKey(
  client: any,
  table: string
): Promise<DbPrimaryKey> {
  const res = await client.query(
    `
    SELECT
      c.conname,
      a.attname AS column
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid
    JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord)
      ON cols.attnum = a.attnum
    WHERE
      c.contype = 'p'
      AND t.relname = $1
    `,
    [table]
  );

  if (res.rowCount === 0) return null;

  // single-column PK only (by design)
  return {
    name: res.rows[0].conname,
    column: res.rows[0].column,
  };
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterPrimaryKey(opts: {
  client: any;
  table: string;
  processed: any[];
  counts: Counts | null;
  messages: string[];
}): Promise<{ ok: boolean }> {
  const { client, table, processed, counts, messages } = opts;

  const tableHasData = (counts?.total ?? 0) > 0;

  const dbPK = await getPrimaryKey(client, table);
  const modelPKs = processed.filter((c) => c.__primary);

  /* ===================================================== */
  /* VALIDATION                                            */
  /* ===================================================== */

  if (modelPKs.length > 1) {
    console.log(
      `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
    );
    console.log(`  ${colors.subject}${table}${colors.reset}`);
    console.log(
      `    ${colors.error}Multiple PRIMARY KEYs defined:${colors.reset} ` +
        modelPKs.map((c) => c.name).join(", ")
    );
    console.log("");
    return { ok: false };
  }

  /* ---------- NO CHANGE ---------- */
  if (dbPK && modelPKs.length === 1 && dbPK.column === modelPKs[0].name) {
    return { ok: true };
  }

  /* ===================================================== */
  /* DROP PRIMARY KEY                                      */
  /* ===================================================== */

  if (dbPK && modelPKs.length === 0) {
    if (tableHasData) {
      console.log(
        `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
      );
      console.log(`  ${colors.subject}${table}${colors.reset}`);
      console.log(
        `    ${colors.error}Cannot DROP PRIMARY KEY:${colors.reset} ` +
          `${colors.subject}table contains data, reset database to proceed`
      );
      console.log("");
      return { ok: false };
    }

    await client.query(
      `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(dbPK.name)}`
    );

    messages.push(
      `${colors.success}Dropped PRIMARY KEY:${colors.reset} ${colors.subject}${dbPK.column}${colors.reset}`
    );

    return { ok: true };
  }

  /* ===================================================== */
  /* ADD PRIMARY KEY                                       */
  /* ===================================================== */

  if (!dbPK && modelPKs.length === 1) {
    await client.query(
      `ALTER TABLE ${q(table)} ADD PRIMARY KEY (${q(modelPKs[0].name)})`
    );

    messages.push(
      `${colors.success}Added PRIMARY KEY:${colors.reset} ${colors.subject}${modelPKs[0].name}${colors.reset}`
    );

    return { ok: true };
  }

  /* ===================================================== */
  /* CONFLICT (PK MOVE / CHANGE)                            */
  /* ===================================================== */

  if (dbPK && modelPKs.length === 1 && dbPK.column !== modelPKs[0].name) {
    console.log(
      `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
    );
    console.log(`  ${colors.subject}${table}${colors.reset}`);
    console.log(
      `    ${colors.error}Cannot CHANGE PRIMARY KEY:${colors.reset} ` +
        `${colors.subject}${dbPK.column}${colors.reset} → ${colors.subject}${modelPKs[0].name}${colors.reset} ` +
        `${colors.subject}(reset database required)`
    );
    console.log("");
    return { ok: false };
  }

  return { ok: true };
}
