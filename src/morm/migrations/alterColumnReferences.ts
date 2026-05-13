// migrations/alterColumnReferences.ts

import { reporter } from "../utils/migrationReporter.js";

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

type FKRow = {
  conname: string;
  column: string;
  ref_table: string;
  ref_column: string;
  on_delete: string;
  on_update: string;
};

async function getForeignKeys(client: any, table: string): Promise<FKRow[]> {
  const res = await client.query(
    `
    SELECT
      c.conname,
      a.attname               AS column,
      ft.relname              AS ref_table,
      fa.attname              AS ref_column,
      CASE c.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END                     AS on_delete,
      CASE c.confupdtype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END                     AS on_update
    FROM pg_constraint c
    JOIN pg_class t  ON t.oid  = c.conrelid
    JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN pg_attribute fa ON fa.attrelid = ft.oid AND fa.attnum = ANY(c.confkey)
    WHERE c.contype = 'f'
      AND t.relname = $1
    `,
    [table],
  );
  return res.rows as FKRow[];
}

export async function alterColumnReferences(opts: {
  client: any;
  table: string;
  processed: any[];
  phase?: "drop" | "add" | "all";
}): Promise<{
  ok: boolean;
  addedFkCols: Set<string>;
  droppedFkCols: Set<string>;
}> {
  const { client, table, processed, phase = "all" } = opts;

  const fks = await getForeignKeys(client, table);
  const fkByColumn = new Map<string, FKRow>(fks.map((f) => [f.column, f]));

  const added: string[] = [];
  const dropped: string[] = [];
  const rebuilt: { col: string; reasons: string }[] = [];

  for (const col of processed) {
    if (col.__virtual) continue;

    /* ---- FK removed from model ---- */
    if (!col.references) {
      if (phase === "drop" || phase === "all") {
        const existingFk = fkByColumn.get(col.name);
        if (existingFk) {
          await client.query(
            `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(existingFk.conname)}`,
          );

          /* Drop implied UNIQUE unless user explicitly kept unique: true */
          if (!col.unique) {
            const uniqRes = await client.query(
              `
              SELECT c.conname, 'constraint' AS source
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_attribute a ON a.attrelid = t.oid
              JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord)
                ON cols.attnum = a.attnum
              WHERE c.contype = 'u'
                AND t.relname = $1
                AND a.attname = $2

              UNION

              SELECT i.relname AS conname, 'index' AS source
              FROM pg_index ix
              JOIN pg_class t ON t.oid = ix.indrelid
              JOIN pg_class i ON i.oid = ix.indexrelid
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
              WHERE ix.indisunique = true
                AND ix.indisprimary = false
                AND t.relname = $1
                AND a.attname = $2
                AND NOT EXISTS (
                  SELECT 1 FROM pg_constraint c
                  WHERE c.conindid = ix.indexrelid AND c.contype = 'u'
                )
              `,
              [table, col.name],
            );
            for (const row of uniqRes.rows) {
              if (row.source === "index") {
                await client.query(`DROP INDEX IF EXISTS ${q(row.conname)}`);
              } else {
                await client.query(
                  `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(row.conname)}`,
                );
              }
            }
          }

          dropped.push(col.name);
        }
      }
      continue;
    }

    const ref = col.references;
    const modelOnDelete = (ref.onDelete ?? "CASCADE").toUpperCase();
    const modelOnUpdate = (ref.onUpdate ?? "CASCADE").toUpperCase();
    const modelRefTable = String(ref.table);
    const modelRefColumn = String(ref.column);

    const existing = fkByColumn.get(col.name);

    /* ---- New FK on existing column (column was added via ADD COLUMN — FK
       already created by buildColumnSQL. But if the column already existed
       without a FK, we need to add it now.) ---- */
    if (!existing) {
      if (!col.__renamed && (phase === "add" || phase === "all")) {
        await client.query(`
          ALTER TABLE ${q(table)}
          ADD CONSTRAINT ${q(`${table}_${col.name}_fkey`)}
          FOREIGN KEY (${q(col.name)})
          REFERENCES ${q(modelRefTable)} (${q(modelRefColumn)})
          ON DELETE ${modelOnDelete}
          ON UPDATE ${modelOnUpdate}
        `);

        /* Apply NOT NULL if column requires it */
        if (col.notNull) {
          await client.query(
            `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} SET NOT NULL`,
          );
        }

        /* Apply UNIQUE if column requires it and it doesn't already exist */
        if (col.unique) {
          const existingUniq = await client.query(
            `
            SELECT 1
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE ix.indisunique = true
              AND ix.indisprimary = false
              AND t.relname = $1
              AND a.attname = $2
            `,
            [table, col.name],
          );
          if (existingUniq.rowCount === 0) {
            await client.query(
              `ALTER TABLE ${q(table)} ADD UNIQUE (${q(col.name)})`,
            );
          }
        }

        added.push(col.name);
      }
      continue;
    }

    /* ---- Determine if rebuild is needed ---- */
    const refTableChanged =
      existing.ref_table.toLowerCase() !== modelRefTable.toLowerCase();
    const refColumnChanged =
      existing.ref_column.toLowerCase() !== modelRefColumn.toLowerCase();
    const onDeleteChanged = existing.on_delete !== modelOnDelete;
    const onUpdateChanged = existing.on_update !== modelOnUpdate;
    const wasRenamed = !!col.__renamed;

    const needsRebuild =
      wasRenamed ||
      refTableChanged ||
      refColumnChanged ||
      onDeleteChanged ||
      onUpdateChanged;

    if (!needsRebuild) continue;

    /* ---- Drop old FK (phase: drop or all) ---- */
    if (phase === "drop" || phase === "all") {
      await client.query(
        `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(existing.conname)}`,
      );
    }

    /* ---- Add updated FK (phase: add or all) ---- */
    if (phase === "add" || phase === "all") {
      const newConstraintName = `${table}_${col.name}_fkey`;
      await client.query(`
        ALTER TABLE ${q(table)}
        ADD CONSTRAINT ${q(newConstraintName)}
        FOREIGN KEY (${q(col.name)})
        REFERENCES ${q(modelRefTable)} (${q(modelRefColumn)})
        ON DELETE ${modelOnDelete}
        ON UPDATE ${modelOnUpdate}
      `);

      const reasons: string[] = [];
      if (wasRenamed) reasons.push("renamed");
      if (refTableChanged)
        reasons.push(`ref table: ${existing.ref_table} → ${modelRefTable}`);
      if (refColumnChanged)
        reasons.push(`ref col: ${existing.ref_column} → ${modelRefColumn}`);
      if (onDeleteChanged)
        reasons.push(`ON DELETE: ${existing.on_delete} → ${modelOnDelete}`);
      if (onUpdateChanged)
        reasons.push(`ON UPDATE: ${existing.on_update} → ${modelOnUpdate}`);

      rebuilt.push({ col: col.name, reasons: reasons.join(", ") });
    }
  }

  if (added.length > 0 || dropped.length > 0 || rebuilt.length > 0) {
    reporter.addColumn({ kind: "fk", table, added, dropped, rebuilt });
  }

  return {
    ok: true,
    addedFkCols: new Set(added),
    droppedFkCols: new Set(dropped),
  };
}
