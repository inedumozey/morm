// migrations/alterColumnUnique.t

import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type Counts = {
  total: number;
};

type DbUniqueMap = Map<string, string>; // column -> constraint name

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function isAllowedUniqueDefault(def: any): boolean {
  if (def === null) return true;
  if (typeof def !== "string") return false;

  const v = def.trim().toLowerCase();
  return v === "int()" || v === "uuid()";
}

async function getUniqueConstraints(
  client: any,
  table: string
): Promise<DbUniqueMap> {
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
      c.contype = 'u'
      AND t.relname = $1
    `,
    [table]
  );

  const map = new Map<string, string>();
  for (const r of res.rows) {
    map.set(r.column, r.conname);
  }
  return map;
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterColumnUnique(opts: {
  client: any;
  table: string;
  processed: any[];
  counts: Counts | null;
  messages: string[];
}): Promise<{ ok: boolean }> {
  const { client, table, processed, counts, messages } = opts;
  const dbUniques = await getUniqueConstraints(client, table);
  const tableHasData = (counts?.total ?? 0) > 0;

  for (const col of processed) {
    if (col.__virtual) continue;
    if (col.__primary) continue;

    const wantsUnique = !!col.unique;
    const hasUnique = dbUniques.has(col.name);
    const constraintName = dbUniques.get(col.name);

    /* ---------- NO CHANGE ---------- */
    if (wantsUnique === hasUnique) continue;

    /* ===================================================== */
    /* ADD UNIQUE                                            */
    /* ===================================================== */

    if (wantsUnique && !hasUnique) {
      if (tableHasData) {
        if (!isAllowedUniqueDefault(col.default)) {
          console.log(
            `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
          );
          console.log(`  ${colors.subject}${table}${colors.reset}`);
          console.log(
            `    ${colors.error}Cannot ADD UNIQUE:${colors.reset} ` +
              `${colors.subject}${col.name}${colors.reset} ` +
              `(table contains data and default is not guaranteed unique), reset database or change default to int() | uuid()`
          );
          console.log("");
          return { ok: false };
        }
      }

      await client.query(`ALTER TABLE ${q(table)} ADD UNIQUE (${q(col.name)})`);

      messages.push(
        `${colors.success}Added UNIQUE:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );

      continue;
    }

    /* ===================================================== */
    /* DROP UNIQUE                                           */
    /* ===================================================== */

    if (!wantsUnique && hasUnique && constraintName) {
      await client.query(
        `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(constraintName)}`
      );

      messages.push(
        `${colors.success}Dropped UNIQUE:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );
    }
  }

  return { ok: true };
}
