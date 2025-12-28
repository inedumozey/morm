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
  const droppedExtensions: string[] = [];
  const droppedTables: string[] = [];
  const droppedEnums: string[] = [];
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
    droppedExtensions.push(e.extname);
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
    droppedTables.push(t.tablename);
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
    droppedEnums.push(e.typname);
  }

  /** PRINT MESSAGES */
  if (droppedExtensions.length > 0) {
    console.log(
      `  ${colors.processing}Dropped extensions:${colors.reset} ${subject(
        droppedExtensions.join(", ")
      )}`
    );
  }

  if (droppedTables.length > 0) {
    console.log(
      `  ${colors.processing}Dropped tables:${colors.reset} ${subject(
        droppedTables.join(", ")
      )}`
    );
  }

  if (droppedEnums.length > 0) {
    console.log(
      `  ${colors.processing}Dropped enums:${colors.reset} ${subject(
        droppedEnums.join(", ")
      )}`
    );
  }

  console.log("");
}
