// migrations/resetDatabase.ts

import { colors } from "../utils/logColors.js";

function subject(v: string) {
  return `${colors.subject}${v}${colors.reset}`;
}

/**
 * FULL DATABASE RESET (PUBLIC SCHEMA)
 * ----------------------------------
 * Drops, in correct order:
 * 1) extensions (pgcrypto, etc.)
 * 2) tables (CASCADE removes triggers & FKs)
 * 3) enums
 *
 * Extension-owned functions are NEVER dropped directly.
 */
export async function resetDatabase(client: any) {
  console.log(`${colors.section}${colors.bold}DATABASE RESET:${colors.reset}`);

  /* ─────────────────────────────── */
  /* EXTENSIONS                      */
  /* ─────────────────────────────── */
  const exts = await client.query(`
    SELECT extname
    FROM pg_extension
    WHERE extname NOT IN ('plpgsql')
  `);

  for (const e of exts.rows) {
    await client.query(`DROP EXTENSION IF EXISTS "${e.extname}" CASCADE`);
    console.log(
      `  ${colors.processing}Dropped extension:${colors.reset} ${subject(
        e.extname
      )}`
    );
  }

  /* ─────────────────────────────── */
  /* TABLES (CASCADE drops triggers) */
  /* ─────────────────────────────── */
  const tables = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `);

  for (const t of tables.rows) {
    await client.query(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
    console.log(
      `  ${colors.processing}Dropped table:${colors.reset} ${subject(
        t.tablename
      )}`
    );
  }

  /* ─────────────────────────────── */
  /* ENUM TYPES                      */
  /* ─────────────────────────────── */
  const enums = await client.query(`
    SELECT typname
    FROM pg_type
    WHERE typtype = 'e'
      AND typnamespace = 'public'::regnamespace
  `);

  for (const e of enums.rows) {
    await client.query(`DROP TYPE IF EXISTS "${e.typname}" CASCADE`);
    console.log(
      `  ${colors.processing}Dropped enum:${colors.reset} ${subject(e.typname)}`
    );
  }

  console.log("");
}
