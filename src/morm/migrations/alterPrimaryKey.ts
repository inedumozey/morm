// migrations/alterPrimaryKey.ts

import { reporter } from "../utils/migrationReporter.js";

type Counts = { total: number };
type DbPrimaryKey = { name: string; column: string } | null;

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function getPrimaryKey(
  client: any,
  table: string,
): Promise<DbPrimaryKey> {
  const res = await client.query(
    `
    SELECT c.conname, a.attname AS column
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid
    JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON cols.attnum = a.attnum
    WHERE c.contype = 'p' AND t.relname = $1
    `,
    [table],
  );
  if (res.rowCount === 0) return null;
  return { name: res.rows[0].conname, column: res.rows[0].column };
}

export async function alterPrimaryKey(opts: {
  client: any;
  table: string;
  processed: any[];
  counts: Counts | null;
  dbIdentityNames?: Set<string>;
  modelIdentityNames?: Set<string>;
  compositePk?: string[];
}): Promise<{ ok: boolean }> {
  const {
    client,
    table,
    processed,
    counts,
    dbIdentityNames = new Set(),
    modelIdentityNames = new Set(),
    compositePk,
  } = opts;

  const tableHasData = (counts?.total ?? 0) > 0;
  const dbPK = await getPrimaryKey(client, table);
  const modelPKs = processed.filter((c) => c.__primary);

  /* Composite PK — verify it matches the DB */
  if (compositePk && compositePk.length > 0) {
    const dbPK = await getPrimaryKey(client, table);
    if (dbPK) {
      const dbPkRes = await client.query(
        `
        SELECT a.attname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = t.oid
        JOIN unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ord) ON cols.attnum = a.attnum
        WHERE c.contype = 'p' AND t.relname = $1
        ORDER BY cols.ord
        `,
        [table],
      );
      const dbPkCols = dbPkRes.rows.map((r: any) => r.attname);
      const modelPkSorted = [...compositePk].sort();
      const dbPkSorted = [...dbPkCols].sort();
      const same =
        modelPkSorted.length === dbPkSorted.length &&
        modelPkSorted.every((v, i) => v === dbPkSorted[i]);

      if (!same) {
        if (tableHasData) {
          reporter.addError({
            section: "PK",
            table,
            message: `Cannot change composite PRIMARY KEY from (${dbPkCols.join(", ")}) to (${compositePk.join(", ")}) — table has data. Run migrate({ reset: true })`,
          });
          return { ok: false };
        }

        /* No data — drop and recreate the PK constraint */
        await client.query(
          `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(dbPK.name)}`,
        );
        await client.query(
          `ALTER TABLE ${q(table)} ADD PRIMARY KEY (${compositePk.map((k) => q(k)).join(", ")})`,
        );
        reporter.addColumn({
          kind: "pk",
          table,
          added: compositePk,
          dropped: dbPkCols,
        });
      }
    }
    return { ok: true };
  }

  /* Multiple PKs in model — only error if not a composite PK */
  if (modelPKs.length > 1 && (!compositePk || compositePk.length === 0)) {
    reporter.addError({
      section: "COLUMN",
      table,
      message: `Multiple PRIMARY KEYs defined: ${modelPKs.map((c) => c.name).join(", ")}`,
    });
    return { ok: false };
  }

  /* DB PK is an identity column */
  if (dbPK && dbIdentityNames.has(dbPK.column)) {
    if (modelIdentityNames.size > 0) {
      const newIdentityName = Array.from(modelIdentityNames)[0]!;

      if (newIdentityName !== dbPK.column) {
        // Check if any other table references this column as a FK
        const fkRes = await client.query(
          `
          SELECT tc.table_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_schema = 'public'
            AND LOWER(ccu.table_name) = LOWER($1)
            AND ccu.column_name = $2
          `,
          [table, dbPK.column],
        );

        if (fkRes.rows.length > 0) {
          // FK references exist — cannot rename safely
          const refs = fkRes.rows.map((r: any) => r.table_name).join(", ");
          reporter.addError({
            section: "PK",
            table,
            message: `Cannot rename identity PK "${dbPK.column}" to "${newIdentityName}" — referenced by FK in: ${refs}. Drop the FK constraints first or run migrate({ reset: true })`,
          });
          return { ok: false };
        }

        // No FK references — safe to rename directly
        await client.query(
          `ALTER TABLE ${q(table)} RENAME COLUMN ${q(dbPK.column)} TO ${q(newIdentityName)}`,
        );
        reporter.addColumn({
          kind: "renamed",
          table,
          pairs: [{ from: dbPK.column, to: newIdentityName }],
        });
      }
    }
    // Identity PK managed by PostgreSQL — nothing else to do
    return { ok: true };
  }

  /* No change */
  if (dbPK && modelPKs.length === 1 && dbPK.column === modelPKs[0].name) {
    return { ok: true };
  }

  /* Drop PK */
  if (dbPK && modelPKs.length === 0) {
    if (tableHasData) {
      reporter.addError({
        section: "COLUMN",
        table,
        message: `Cannot DROP PRIMARY KEY — table has data. Run migrate({ reset: true })`,
      });
      return { ok: false };
    }
    await client.query(
      `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(dbPK.name)}`,
    );
    reporter.addColumn({
      kind: "pk",
      table,
      added: [],
      dropped: [dbPK.column],
    });
    return { ok: true };
  }

  /* Add PK */
  if (!dbPK && modelPKs.length === 1) {
    await client.query(
      `ALTER TABLE ${q(table)} ADD PRIMARY KEY (${q(modelPKs[0].name)})`,
    );
    reporter.addColumn({
      kind: "pk",
      table,
      added: [modelPKs[0].name],
      dropped: [],
    });
    return { ok: true };
  }

  /* PK conflict */
  if (dbPK && modelPKs.length === 1 && dbPK.column !== modelPKs[0].name) {
    reporter.addError({
      section: "COLUMN",
      table,
      message: `Cannot change PRIMARY KEY from "${dbPK.column}" to "${modelPKs[0].name}" — run migrate({ reset: true })`,
    });
    return { ok: false };
  }

  return { ok: true };
}
