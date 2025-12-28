// migrations/indexMigrations.ts

import { colors } from "../utils/logColors.js";

/**
 * - Migrate indexes:
 * - add missing indexes
 * - drop stale indexes
 * - log ONLY when something actually changes
 */

export async function indexMigrations(
  client: any,
  config: {
    table: string;
    indexes?: readonly string[] | undefined;
  }
): Promise<string[]> {
  const modelIndexes = new Set<string>(
    (config.indexes ?? []).map((c) => String(c))
  );
  const createdIndexes: string[] = [];

  /* ---------- READ EXISTING ---------- */
  const res = await client.query(
    `
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = $1
    `,
    [config.table]
  );

  const existingIndexes = new Set<string>();
  for (const row of res.rows) {
    existingIndexes.add(String(row.indexname));
  }

  /* ---------- DESIRED ---------- */
  const desiredIndexNames = new Set<string>();
  for (const col of modelIndexes) {
    desiredIndexNames.add(`${config.table}_${col}_idx`);
  }

  /* ---------- DROP STALE ---------- */
  for (const idxName of existingIndexes) {
    // never touch primary keys
    if (idxName.startsWith(`${config.table}_pkey`)) continue;

    // only manage MORM-style indexes
    if (!idxName.startsWith(`${config.table}_`) || !idxName.endsWith(`_idx`)) {
      continue;
    }

    if (!desiredIndexNames.has(idxName)) {
      await client.query(`DROP INDEX "${idxName}"`);
      createdIndexes.push(idxName);
    }
  }

  /* ---------- CREATE MISSING ---------- */
  /* ---------- VALIDATE INDEX COLUMNS ---------- */
  const colsRes = await client.query(
    `
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND LOWER(table_name) = LOWER($1)
  `,
    [config.table]
  );

  const dbCols = new Set(colsRes.rows.map((r: any) => String(r.column_name)));

  /* ---------- CREATE MISSING ---------- */
  for (const col of modelIndexes) {
    if (!dbCols.has(col)) {
      throw new Error(
        `Invalid index definition: column "${col}" does not exist ` +
          `on table "${config.table}"`
      );
    }

    const idxName = `${config.table}_${col}_idx`;
    if (!existingIndexes.has(idxName)) {
      await client.query(
        `CREATE INDEX "${idxName}" ON "${config.table}"("${col}")`
      );
      createdIndexes.push(idxName);
    }
  }

  return createdIndexes;
}
