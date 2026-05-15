// migrations/alterColumnUnique.ts

import { reporter } from "../utils/migrationReporter.js";

type Counts = { total: number };
type DbUniqueMap = Map<string, string>; // column → constraint name

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function isAllowedUniqueDefault(def: any): boolean {
  if (def === null || def === undefined) return true;
  if (typeof def !== "string") return false;
  const v = def.trim().toLowerCase();
  return v === "int()" || v === "uuid()";
}

async function getUniqueConstraints(
  client: any,
  table: string,
): Promise<DbUniqueMap> {
  const res = await client.query(
    `
    SELECT c.conname, a.attname AS column
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid
    JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON cols.attnum = a.attnum
    WHERE c.contype = 'u' AND t.relname = $1

    UNION

    SELECT i.relname AS conname, a.attname AS column
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE ix.indisunique = true
      AND ix.indisprimary = false
      AND t.relname = $1
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conindid = ix.indexrelid
          AND c.contype = 'u'
      )
    `,
    [table],
  );
  const map = new Map<string, string>();
  for (const r of res.rows) map.set(r.column, r.conname);
  return map;
}

export async function alterColumnUnique(opts: {
  client: any;
  table: string;
  processed: any[];
  counts: Counts | null;
  skipCols?: Set<string>;
  silentCols?: Set<string>;
}): Promise<{ ok: boolean }> {
  const { client, table, processed, counts, skipCols, silentCols } = opts;
  const dbUniques = await getUniqueConstraints(client, table);
  const tableHasData = (counts?.total ?? 0) > 0;

  const setList: string[] = [];
  const droppedList: string[] = [];

  for (const col of processed) {
    if (col.__virtual) continue;
    if (col.__primary) continue;
    if (skipCols?.has(col.name)) continue;

    const wantsUnique = !!col.unique;
    const hasUnique = dbUniques.has(col.name);
    const constraintName = dbUniques.get(col.name);

    /* ---- Rebuild unique on rename ---- */
    if (col.__renamed && hasUnique && constraintName) {
      await client.query(
        `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(constraintName)}`,
      );
      await client.query(`ALTER TABLE ${q(table)} ADD UNIQUE (${q(col.name)})`);
      continue; // not counted as a change — just a rebuild
    }

    if (wantsUnique === hasUnique) continue;

    /* ---- Add unique ---- */
    if (wantsUnique && !hasUnique) {
      if (tableHasData && !isAllowedUniqueDefault(col.default)) {
        reporter.addError({
          section: "COLUMN",
          table,
          message: `Cannot ADD UNIQUE on "${col.name}" — table has data and default is not guaranteed unique (use uuid() or int())`,
        });
        return { ok: false };
      }
      await client.query(`ALTER TABLE ${q(table)} ADD UNIQUE (${q(col.name)})`);
      setList.push(col.name);
      continue;
    }

    /* ---- Drop unique ---- */
    if (!wantsUnique && hasUnique && constraintName) {
      await client.query(
        `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(constraintName)}`,
      );
      droppedList.push(col.name);
    }
  }

  const reportedSet = setList.filter((n) => !silentCols?.has(n));
  const reportedDropped = droppedList.filter((n) => !silentCols?.has(n));

  if (reportedSet.length > 0 || reportedDropped.length > 0) {
    reporter.addColumn({
      kind: "unique",
      table,
      set: reportedSet,
      dropped: reportedDropped,
    });
  }
  return { ok: true };
}
