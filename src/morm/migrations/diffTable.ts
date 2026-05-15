// migrations/diffTable.ts

import { alterColumn } from "./alterColumn.js";
import { alterColumnTypes } from "./alterColumnTypes.js";
import { alterColumnNullity } from "./alterColumnNullity.js";
import { alterColumnUnique } from "./alterColumnUnique.js";
import { alterColumnDefault } from "./alterColumnDefault.js";
import { alterColumnCheck } from "./alterColumnCheck.js";
import { alterPrimaryKey } from "./alterPrimaryKey.js";
import { alterColumnReferences } from "./alterColumnReferences.js";
import { reporter } from "../utils/migrationReporter.js";

type Row = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function batchCounts(client: any, table: string, cols: string[]) {
  try {
    const parts = cols.map((c) => `count(${q(c)}) as ${q(c)}`).join(", ");
    const r = await client.query(
      `SELECT count(*) as total, ${parts} FROM ${q(table)}`,
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
  config: { table: string; primaryKey?: string[] },
  processed: any[],
): Promise<boolean> {
  const res = await client.query(
    `
    SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity,
           character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND LOWER(table_name) = LOWER($1)
    `,
    [config.table],
  );

  const existing = new Map<string, Row>(
    res.rows.map((r: Row) => [r.column_name, r]),
  );
  const existingNames = Array.from(existing.keys());
  const counts = await batchCounts(client, config.table, existingNames);

  // Collect DB identity column names — columns managed by GENERATED AS IDENTITY
  const identRes = await client.query(
    `SELECT a.attname
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname = $1
     AND a.attidentity IN ('a', 'd')
     AND a.attnum > 0`,
    [config.table],
  );
  const dbIdentityNames = new Set<string>(
    identRes.rows.map((r: any) => r.attname),
  );

  // Collect model identity column names
  const modelIdentityNames = new Set<string>(
    processed.filter((c) => c.__identity).map((c) => c.name),
  );

  // processedNoIdentity — used ONLY by alterColumn (add/drop/rename)
  // Identity columns must not be added/dropped/renamed through alterColumn
  const processedNoIdentity = processed.filter((c) => !c.__identity);

  /* 1. Column names (add / drop / rename) — uses processedNoIdentity */
  const rename = await alterColumn({
    client,
    table: config.table,
    existing,
    processed: processedNoIdentity,
    counts,
    dbIdentityNames,
    modelIdentityNames,
  });
  if (!rename.ok) return false;

  /* 2. Primary key — uses processedNoIdentity + identity name sets */
  const pk = await alterPrimaryKey({
    client,
    table: config.table,
    processed: processedNoIdentity,
    counts,
    dbIdentityNames,
    modelIdentityNames,
    ...(config.primaryKey && { compositePk: config.primaryKey }),
  });
  if (!pk.ok) return false;

  /* 3. FK drop phase — drop removed/rebuilt FKs before type changes so
        Postgres allows ALTER COLUMN TYPE on FK columns */
  const fkDropRes = await alterColumnReferences({
    client,
    table: config.table,
    processed,
    phase: "drop",
  });
  if (!fkDropRes.ok) return false;

  /* 4. Column types — uses full processed (identity cols can change type) */
  const typeRes = await alterColumnTypes({
    client,
    table: config.table,
    existing,
    processed,
    counts,
  });
  if (!typeRes.ok) return false;

  /* 5. FK references — runs before nullity/unique so implied constraints
        from ONE-TO-ONE relations don't produce spurious NOT NULL / UNIQUE reports */
  const fkRes = await alterColumnReferences({
    client,
    table: config.table,
    processed,
    phase: "add",
  });
  if (!fkRes.ok) return false;

  /* 6. Defaults — uses full processed */
  const defRes = await alterColumnDefault({
    client,
    table: config.table,
    existing,
    processed,
    counts,
  });
  if (!defRes.ok) return false;

  /* 7. Nullity — skip columns whose NOT NULL was implied by a FK that just
        changed (added or dropped) this same migration run */
  const nullRes = await alterColumnNullity({
    client,
    table: config.table,
    existing,
    processed,
    counts,
    skipCols: fkRes.addedFkCols,
    silentCols: fkDropRes.droppedFkCols,
  });
  if (!nullRes.ok) return false;

  /* 8. Unique — same skip logic as nullity */
  /* Only skip ONE-TO-ONE FK columns — they own their own UNIQUE */
  const oneToOneAddedCols = new Set(
    [...fkRes.addedFkCols].filter((colName) => {
      const col = processed.find((c) => c.name === colName);
      return col?.__isOneToOne === true;
    }),
  );

  const uniqRes = await alterColumnUnique({
    client,
    table: config.table,
    processed,
    counts,
    skipCols: oneToOneAddedCols,
    silentCols: fkDropRes.droppedFkCols,
  });
  if (!uniqRes.ok) return false;

  /* 9. Check constraints — uses full processed */
  const checkRes = await alterColumnCheck({
    client,
    table: config.table,
    processed,
  });
  if (!checkRes.ok) return false;

  return true;
}
