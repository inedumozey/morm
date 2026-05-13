// migrations/alterColumn.ts

import { buildColumnSQL } from "../sql/buildColumnSQL.js";
import { canonicalType } from "../utils/canonicalType.js";
import { reporter } from "../utils/migrationReporter.js";

type DbColumn = { column_name: string; data_type: string; udt_name: string };
type Counts = { total: number };

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function dbCanonicalType(r: DbColumn): string {
  const dt = r.data_type.toUpperCase();
  if (dt === "ARRAY") return canonicalType(r.udt_name.replace(/^_/, "")) + "[]";
  if (dt === "USER-DEFINED") return canonicalType(r.udt_name);
  return canonicalType(r.data_type);
}

function canonicalTypeWithArray(t: string): string {
  const upper = t.toUpperCase();
  if (upper.endsWith("[]")) return canonicalType(upper.slice(0, -2)) + "[]";
  return canonicalType(upper);
}

export async function alterColumn(opts: {
  client: any;
  table: string;
  existing: Map<string, DbColumn>;
  processed: any[];
  counts: Counts | null;
  dbIdentityNames?: Set<string>; // identity cols that exist in DB
  modelIdentityNames?: Set<string>; // identity cols defined in model
}): Promise<{ ok: boolean }> {
  const {
    client,
    table,
    existing,
    processed,
    counts,
    dbIdentityNames = new Set(),
    modelIdentityNames = new Set(),
  } = opts;

  const tableHasData = (counts?.total ?? 0) > 0;
  const modelNames = processed.map((c) => c.name);
  const existingNames = Array.from(existing.keys());

  // missingInModel: in DB but not in model processed list
  // BUT exclude DB identity columns — they are managed separately
  const missingInModel = existingNames.filter(
    (n) => !modelNames.includes(n) && !dbIdentityNames.has(n),
  );

  // missingInDB: in model but not in DB
  // BUT exclude model identity columns — they are managed separately
  const missingInDB = modelNames.filter(
    (n) => !existing.has(n) && !modelIdentityNames.has(n),
  );

  const modelMap = new Map(processed.map((c) => [c.name, c]));

  /* ---- 1. RENAME ---- */
  const renamedPairs: { from: string; to: string }[] = [];

  for (const oldName of [...missingInModel]) {
    const row = existing.get(oldName);
    if (!row) continue;

    const oldType = dbCanonicalType(row);
    const candidates = missingInDB.filter((newName) => {
      const col = modelMap.get(newName);
      if (!col) return false;
      return (
        canonicalTypeWithArray(col.type) === canonicalTypeWithArray(oldType)
      );
    });

    if (candidates.length !== 1) continue;
    const newName = candidates[0]!;

    if (existing.has(newName)) {
      reporter.addError({
        section: "COLUMN",
        table,
        message: `Column name collision: "${newName}" already exists`,
      });
      return { ok: false };
    }

    await client.query(
      `ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`,
    );
    renamedPairs.push({ from: oldName, to: newName });

    existing.delete(oldName);
    existing.set(newName, row);
    const modelCol = modelMap.get(newName);
    if (modelCol) modelCol.__renamed = true;
    missingInModel.splice(missingInModel.indexOf(oldName), 1);
    missingInDB.splice(missingInDB.indexOf(newName), 1);
  }

  if (renamedPairs.length > 0) {
    reporter.addColumn({ kind: "renamed", table, pairs: renamedPairs });
  }

  /* ---- 2. ADD COLUMNS ---- */
  const added: string[] = [];

  for (const name of missingInDB) {
    const col = modelMap.get(name);
    if (!col || col.__virtual) continue;

    if (tableHasData && col.notNull && col.default === undefined) {
      reporter.addError({
        section: "COLUMN",
        table,
        message: `Cannot ADD "${name}" — table has data and column is NOT NULL without a default`,
      });
      return { ok: false };
    }

    await client.query(
      `ALTER TABLE ${q(table)} ADD COLUMN ${buildColumnSQL(col)}`,
    );
    added.push(name);
  }

  if (added.length > 0)
    reporter.addColumn({ kind: "added", table, names: added });

  /* ---- 3. DROP COLUMNS ---- */
  const dropped: string[] = [];

  for (const name of missingInModel) {
    // If model wants this column as identity, alterColumnTypes will
    // handle the drop+recreate — skip here
    if (modelIdentityNames.has(name)) continue;

    if (!tableHasData) {
      await client.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(name)}`);
      dropped.push(name);
    } else {
      reporter.addError({
        section: "COLUMN",
        table,
        message: `Cannot DROP "${name}" — table contains data. Run migrate({ reset: true }) to proceed`,
      });
      return { ok: false };
    }
  }

  if (dropped.length > 0)
    reporter.addColumn({ kind: "dropped", table, names: dropped });

  return { ok: true };
}
