// migrations/alterColumnCheck.ts

import { colors } from "../utils/logColors.js";
import { parseCheck } from "../utils/checkParser.js";

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function checkName(table: string, col: string) {
  return `${table}_${col}_check`;
}

function normalizeCheck(sql: string) {
  return sql
    .replace(/^CHECK\s*\((.*)\)$/i, "$1")
    .replace(/^\((.*)\)$/, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* ===================================================== */
/* DB READ                                               */
/* ===================================================== */

async function getCheckConstraints(client: any, table: string) {
  const res = await client.query(
    `
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid = $1::regclass
    `,
    [table]
  );

  const map = new Map<string, string>();
  for (const r of res.rows) {
    if (!r.conname || !r.def) continue;
    map.set(String(r.conname), normalizeCheck(String(r.def)));
  }
  return map;
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterColumnCheck({
  client,
  table,
  processed,
  messages,
}: {
  client: any;
  table: string;
  processed: any[];
  messages: string[];
}) {
  const alters: string[] = [];

  const dbChecks = await getCheckConstraints(client, table);

  for (const col of processed) {
    if (col.__virtual) continue;

    const cName = checkName(table, col.name);

    const modelCheck =
      col.check != null ? normalizeCheck(parseCheck(String(col.check))) : null;

    const dbCheck = dbChecks.get(cName) ?? null;

    /* ---------- ADD ---------- */
    if (modelCheck && !dbCheck) {
      alters.push(
        `ADD CONSTRAINT ${q(cName)} CHECK (${parseCheck(String(col.check))})`
      );
      messages.push(
        `${colors.success}Added CHECK:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );
      continue;
    }

    /* ---------- DROP ---------- */
    if (!modelCheck && dbCheck) {
      alters.push(`DROP CONSTRAINT ${q(cName)}`);
      messages.push(
        `${colors.success}Dropped CHECK:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );
      continue;
    }

    /* ---------- UPDATE ---------- */
    if (modelCheck && dbCheck && modelCheck !== dbCheck) {
      alters.push(`DROP CONSTRAINT ${q(cName)}`);
      alters.push(
        `ADD CONSTRAINT ${q(cName)} CHECK (${parseCheck(String(col.check))})`
      );
      messages.push(
        `${colors.success}Updated CHECK:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );
    }
  }

  if (alters.length > 0) {
    await client.query(`ALTER TABLE ${q(table)} ${alters.join(", ")}`);
  }

  return { ok: true };
}
