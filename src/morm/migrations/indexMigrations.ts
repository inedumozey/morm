import { colors } from "../utils/logColors.js";

/**
 * - Migrate indexes:
 * - add missing indexes
 * - drop stale indexes
 * - no repeated creation
 * - supports clean & reset drop logic
 */

export async function indexMigrations(
  client: any,
  config: {
    table: string;
    indexes?: readonly string[] | undefined;
  },
  messages: string[]
) {
  // Normalize model list
  const modelIndexes = new Set<string>(
    (config.indexes ?? []).map((c) => String(c))
  );

  // ========= READ EXISTING INDEXES ========
  const res = await client.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE tablename = $1`,
    [config.table]
  );

  const existingIndexes = new Set<string>();
  for (const row of res.rows) {
    existingIndexes.add(String(row.indexname));
  }

  // ========= DESIRED INDEX NAMES =========
  const desiredIndexNames = new Set<string>();
  for (const col of modelIndexes) {
    desiredIndexNames.add(`${config.table}_${col}_idx`);
  }

  // ========= DROP STALE INDEXES =========
  for (const idxName of existingIndexes) {
    // skip primary key
    if (idxName.startsWith(`${config.table}_pkey`)) continue;

    // only drop morm-style indexes
    if (!idxName.startsWith(`${config.table}_`) || !idxName.endsWith(`_idx`)) {
      continue;
    }

    // index not required anymore (includes: modelIndexes = [])
    if (!desiredIndexNames.has(idxName)) {
      await client.query(`DROP INDEX IF EXISTS "${idxName}"`);
      messages.push(`${colors.green}Dropped index "${idxName}"${colors.reset}`);
    }
  }

  // ========= ADD MISSING INDEXES =========
  for (const col of modelIndexes) {
    const idxName = `${config.table}_${col}_idx`;
    if (!existingIndexes.has(idxName)) {
      await client.query(
        `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${config.table}"("${col}")`
      );
      messages.push(
        `${colors.green}Created index "${idxName}" on "${col}"${colors.reset}`
      );
    }
  }

  // ========= NOTHING TO DO =========
  // If model has no indexes and we dropped nothing — stay silent
  if (messages.length === 0 && modelIndexes.size === 0) {
    // no logging at all
    return;
  }
}
