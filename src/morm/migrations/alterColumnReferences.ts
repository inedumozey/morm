// migrations/alterColumnReferences.ts

import { colors } from "../utils/logColors.js";

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function getForeignKeys(client: any, table: string) {
  const res = await client.query(
    `
    SELECT
      c.conname,
      a.attname AS column,
      ft.relname AS ref_table,
      fa.attname AS ref_column
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = ANY (c.confkey)
    WHERE c.contype = 'f'
      AND t.relname = $1
    `,
    [table]
  );

  return res.rows;
}

export async function alterColumnReferences(opts: {
  client: any;
  table: string;
  processed: any[];
  messages: string[];
}) {
  const { client, table, processed, messages } = opts;

  const fks = await getForeignKeys(client, table);

  for (const col of processed) {
    if (!col.__renamed) continue;
    if (!col.references) continue;

    // Find old FK by column
    const fk = fks.find((f: any) => f.column === col.name);
    if (!fk) continue;

    // Drop old FK
    await client.query(
      `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(fk.conname)}`
    );

    // Add new FK
    await client.query(`
      ALTER TABLE ${q(table)}
      ADD CONSTRAINT ${q(`${table}_${col.name}_fkey`)}
      FOREIGN KEY (${q(col.name)})
      REFERENCES ${q(col.references.table)} (${q(col.references.column)})
      ON DELETE ${col.references.onDelete ?? "NO ACTION"}
      ON UPDATE ${col.references.onUpdate ?? "NO ACTION"}
    `);

    messages.push(
      `${colors.success}Rebuilt FK:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
    );
  }

  return { ok: true };
}
