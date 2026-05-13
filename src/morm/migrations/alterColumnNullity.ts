// migrations/alterColumnNullity.ts

import { reporter } from "../utils/migrationReporter.js";

type DbColumn = { column_name: string; is_nullable: string };
type Counts = { total: number; nonNull: Record<string, number> };

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

export async function alterColumnNullity(opts: {
  client: any;
  table: string;
  existing: Map<string, DbColumn>;
  processed: any[];
  counts: Counts | null;
  skipCols?: Set<string>;
  silentCols?: Set<string>;
}): Promise<{ ok: boolean }> {
  const { client, table, existing, processed, counts, skipCols, silentCols } =
    opts;
  const tableHasData = (counts?.total ?? 0) > 0;

  const setList: string[] = [];
  const droppedList: string[] = [];

  for (const col of processed) {
    if (col.__virtual) continue;
    if (col.__primary) continue;
    if (skipCols?.has(col.name)) continue;

    const row = existing.get(col.name);
    if (!row) continue;

    const modelNN = col.notNull === true;
    const dbNN = row.is_nullable === "NO";

    if (modelNN === dbNN) continue;

    if (!modelNN && dbNN) {
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} DROP NOT NULL`,
      );
      droppedList.push(col.name);
      continue;
    }

    if (modelNN && !dbNN) {
      if (tableHasData && col.default === undefined) {
        reporter.addError({
          section: "COLUMN",
          table,
          message: `Cannot SET NOT NULL on "${col.name}" — table has data and no default. Add a default or run migrate({ reset: true })`,
        });
        return { ok: false };
      }
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} SET NOT NULL`,
      );
      setList.push(col.name);
    }
  }

  const reportedDropped = droppedList.filter((n) => !silentCols?.has(n));
  const reportedSet = setList.filter((n) => !silentCols?.has(n));

  if (reportedSet.length > 0 || reportedDropped.length > 0) {
    reporter.addColumn({
      kind: "notNull",
      table,
      set: reportedSet,
      dropped: reportedDropped,
    });
  }

  return { ok: true };
}
