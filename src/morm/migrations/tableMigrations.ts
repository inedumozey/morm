// migrations/tableMigrations.ts

import { buildColumnSQL } from "../sql/buildColumnSQL.js";
import { canonicalType } from "../utils/canonicalType.js";
import { reporter } from "../utils/migrationReporter.js";

type DbColumn = { column_name: string; data_type: string; udt_name: string };
type RenameCandidate = { from: string; to: string; score: number };

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function getDbTables(client: any): Promise<string[]> {
  const res = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  return res.rows.map((r: any) => r.table_name);
}

async function getDbColumns(client: any, table: string): Promise<DbColumn[]> {
  const res = await client.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND LOWER(table_name) = LOWER($1)`,
    [table],
  );
  return res.rows;
}

async function isTableReferenced(
  client: any,
  table: string,
): Promise<string[]> {
  const res = await client.query(
    `
    SELECT tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND LOWER(ccu.table_name) = LOWER($1)
    `,
    [table],
  );
  return res.rows.map((r: any) => r.table_name);
}

function isManagedJunction(table: string, models: any[]): boolean {
  if (!table.endsWith("_junction")) return false;
  const modelTables = new Set(models.map((m) => m.table));
  const base = table.replace(/_junction$/, "");
  const parts = base.split("_");
  if (parts.length !== 2) return false;
  return modelTables.has(parts[0]) && modelTables.has(parts[1]);
}

function resolveDbType(col: DbColumn): string {
  const dt = col.data_type.toUpperCase();
  if (dt === "ARRAY")
    return canonicalType(col.udt_name.replace(/^_/, "")) + "[]";
  if (dt === "USER-DEFINED") return canonicalType(col.udt_name);
  return canonicalType(col.data_type);
}

function resolveModelType(col: any): string {
  const raw = String(col.type ?? "")
    .trim()
    .toUpperCase();
  if (raw.endsWith("[]")) return canonicalType(raw.slice(0, -2)) + "[]";
  return canonicalType(raw);
}

const EXCLUDED_COLS = new Set(["created_at", "updated_at"]);
const RENAME_THRESHOLD = 0.5;

function similarityScore(dbCols: DbColumn[], modelCols: any[]): number {
  const dbFiltered = dbCols.filter(
    (c) => !EXCLUDED_COLS.has(c.column_name.toLowerCase()),
  );
  const modelFiltered = modelCols.filter(
    (c) => !EXCLUDED_COLS.has(String(c.name).toLowerCase()) && !c.__virtual,
  );

  if (dbFiltered.length === 0 && modelFiltered.length === 0) return 0;

  const dbMap = new Map<string, string>();
  for (const c of dbFiltered)
    dbMap.set(c.column_name.toLowerCase(), resolveDbType(c));

  let matched = 0;
  for (const mc of modelFiltered) {
    const name = String(mc.name).toLowerCase();
    const modelType = resolveModelType(mc);
    const dbType = dbMap.get(name);
    if (dbType && dbType === modelType) matched++;
  }

  if (matched === 0) return 0;
  return matched / Math.max(dbFiltered.length, modelFiltered.length);
}

async function resolveRenames(
  client: any,
  removed: string[],
  added: string[],
  models: any[],
): Promise<RenameCandidate[]> {
  const modelMap = new Map<string, any>(models.map((m) => [m.table, m]));
  const candidatesPerRemoved = new Map<string, RenameCandidate[]>();

  for (const fromTable of removed) {
    const dbCols = await getDbColumns(client, fromTable);
    const candidates: RenameCandidate[] = [];

    for (const toTable of added) {
      const model = modelMap.get(toTable);
      if (!model) continue;
      const score = similarityScore(dbCols, model.columns ?? []);
      if (score >= RENAME_THRESHOLD)
        candidates.push({ from: fromTable, to: toTable, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    candidatesPerRemoved.set(fromTable, candidates);
  }

  const claimedTo = new Set<string>();
  const claimedFrom = new Set<string>();
  const renames: RenameCandidate[] = [];

  const allCandidates: RenameCandidate[] = [];
  for (const candidates of candidatesPerRemoved.values()) {
    const best = candidates[0];
    if (best) allCandidates.push(best);
  }
  allCandidates.sort((a, b) => b.score - a.score);

  for (const c of allCandidates) {
    if (claimedFrom.has(c.from) || claimedTo.has(c.to)) continue;
    claimedFrom.add(c.from);
    claimedTo.add(c.to);
    renames.push(c);
  }

  return renames;
}

export async function tableMigrations(
  client: any,
  models: { table: string; columns: any[]; primaryKey?: string[] }[],
) {
  const modelTables = models.map((m) => m.table);
  const dbTables = await getDbTables(client);
  const dbBaseTables = dbTables.filter((t) => !isManagedJunction(t, models));
  const modelBaseTables = modelTables.filter(
    (t) => !isManagedJunction(t, models),
  );

  const removed = dbBaseTables.filter((t) => !modelBaseTables.includes(t));
  const added = modelBaseTables.filter((t) => !dbBaseTables.includes(t));

  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();
  const renamedPairs: { from: string; to: string }[] = [];

  /* ---- Rename detection ---- */
  if (removed.length > 0 && added.length > 0) {
    const resolved = await resolveRenames(client, removed, added, models);

    for (const r of resolved) {
      const refs = await isTableReferenced(client, r.from);
      if (refs.length > 0) {
        reporter.addError({
          section: "TABLE",
          table: r.from,
          message: `Cannot RENAME to "${r.to}" — referenced by: ${refs.join(", ")}. Run migrate({ reset: true })`,
        });
        return false;
      }

      await client.query(`ALTER TABLE ${q(r.from)} RENAME TO ${q(r.to)}`);
      renamedFrom.add(r.from);
      renamedTo.add(r.to);
      renamedPairs.push({ from: r.from, to: r.to });
    }
  }

  const dbTablesAfterRename = await getDbTables(client);

  /* ---- Create tables ---- */
  const created: string[] = [];

  for (const model of models) {
    if (
      !dbTablesAfterRename.includes(model.table) &&
      !renamedTo.has(model.table) &&
      !isManagedJunction(model.table, models)
    ) {
      const cols = model.columns
        .filter((c) => !c.__virtual)
        .map((c) => buildColumnSQL(c))
        .filter(Boolean);

      const compositePkSQL = Array.isArray(model.primaryKey)
        ? `, PRIMARY KEY (${model.primaryKey.map((k: string) => `"${k}"`).join(", ")})`
        : "";

      await client.query(
        `CREATE TABLE ${q(model.table)} (${cols.join(", ")}${compositePkSQL})`,
      );
      created.push(model.table);
    }
  }

  /* ---- Drop tables ---- */
  const dropped: string[] = [];

  for (const table of dbTablesAfterRename) {
    if (
      !modelTables.includes(table) &&
      !renamedFrom.has(table) &&
      !isManagedJunction(table, models)
    ) {
      await client.query(`DROP TABLE ${q(table)} CASCADE`);
      dropped.push(table);
    }
  }

  /* ---- Report ---- */
  if (renamedPairs.length > 0)
    reporter.addTable({ kind: "renamed", pairs: renamedPairs });
  if (created.length > 0)
    reporter.addTable({ kind: "created", names: created });
  if (dropped.length > 0)
    reporter.addTable({ kind: "dropped", names: dropped });

  return new Set<string>(created);
}
