// migrations/resetDatabase.ts

import { reporter } from "../utils/migrationReporter.js";

export async function resetDatabase(client: any) {
  const droppedExtensions: string[] = [];
  const droppedTables: string[] = [];
  const droppedEnums: string[] = [];

  const exts = await client.query(
    `SELECT extname FROM pg_extension WHERE extname NOT IN ('plpgsql')`,
  );
  for (const e of exts.rows) {
    await client.query(`DROP EXTENSION IF EXISTS "${e.extname}" CASCADE`);
    droppedExtensions.push(e.extname);
  }

  const tables = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  for (const t of tables.rows) {
    await client.query(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
    droppedTables.push(t.tablename);
  }

  const enums = await client.query(
    `SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace`,
  );
  for (const e of enums.rows) {
    await client.query(`DROP TYPE IF EXISTS "${e.typname}" CASCADE`);
    droppedEnums.push(e.typname);
  }

  // We don't report drops here — everything dropped will be immediately
  // recreated by migrateEnumsGlobal and tableMigrations.
  // Reporting drops + creates for the same items is noisy and confusing.
  // Instead morm.ts adds a single reset notice before the reporter renders.
}
