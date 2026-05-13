// migrations/alterColumnCheck.ts

import { reporter } from "../utils/migrationReporter.js";
import { parseCheck } from "../utils/checkParser.js";

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

async function getCheckConstraints(client: any, table: string) {
  const res = await client.query(
    `
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.contype = 'c' AND c.conrelid = $1::regclass
    `,
    [table],
  );
  const map = new Map<string, string>();
  for (const r of res.rows) {
    if (!r.conname || !r.def) continue;
    map.set(String(r.conname), normalizeCheck(String(r.def)));
  }
  return map;
}

export async function alterColumnCheck(opts: {
  client: any;
  table: string;
  processed: any[];
}): Promise<{ ok: boolean }> {
  const { client, table, processed } = opts;

  const alters: string[] = [];
  const added: string[] = [];
  const dropped: string[] = [];
  const updated: string[] = [];

  const dbChecks = await getCheckConstraints(client, table);

  for (const col of processed) {
    if (col.__virtual) continue;

    const cName = checkName(table, col.name);
    const modelCheck =
      col.check != null ? normalizeCheck(parseCheck(String(col.check))) : null;
    const dbCheck = dbChecks.get(cName) ?? null;

    if (modelCheck && !dbCheck) {
      alters.push(
        `ADD CONSTRAINT ${q(cName)} CHECK (${parseCheck(String(col.check))})`,
      );
      added.push(col.name);
      continue;
    }

    if (!modelCheck && dbCheck) {
      alters.push(`DROP CONSTRAINT ${q(cName)}`);
      dropped.push(col.name);
      continue;
    }

    if (modelCheck && dbCheck && modelCheck !== dbCheck) {
      alters.push(`DROP CONSTRAINT ${q(cName)}`);
      alters.push(
        `ADD CONSTRAINT ${q(cName)} CHECK (${parseCheck(String(col.check))})`,
      );
      updated.push(col.name);
    }
  }

  if (alters.length > 0) {
    await client.query(`ALTER TABLE ${q(table)} ${alters.join(", ")}`);
  }

  if (added.length > 0 || dropped.length > 0 || updated.length > 0) {
    reporter.addColumn({ kind: "check", table, added, dropped, updated });
  }

  return { ok: true };
}
