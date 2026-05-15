// migrations/alterColumnDefault.ts

import { reporter } from "../utils/migrationReporter.js";
import { buildDefaultSQL } from "../sql/buildDefaultSQL.js";

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function normalizeDefault(d: string | null | undefined): string | null {
  if (d == null) return null;
  let s = String(d).trim().toLowerCase();
  while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  const castIdx = s.indexOf("::");
  if (castIdx !== -1) s = s.slice(0, castIdx);
  if (s === "current_timestamp" || s === "current_timestamp()")
    return "current_timestamp";
  if (s === "gen_random_uuid()" || s === "gen_random_uuid")
    return "gen_random_uuid";

  // JSON/JSONB defaults — normalize by parsing and re-stringifying
  // to handle whitespace differences without corrupting the value
  const trimmed = s.replace(/^'|'$/g, "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      // not valid JSON — fall through to normal normalization
    }
  }

  s = s.replace(/^array\s*\[(.*)\]$/i, "{$1}");
  s = s.replace(/"/g, "").replace(/'/g, "").replace(/\s+/g, "");
  return s;
}

export async function alterColumnDefault(opts: {
  client: any;
  table: string;
  existing: Map<string, any>;
  processed: any[];
  counts: { total: number } | null;
}): Promise<{ ok: boolean }> {
  const { client, table, existing, processed, counts } = opts;
  const tableHasData = (counts?.total ?? 0) > 0;

  const alters: string[] = [];
  const setList: string[] = [];
  const droppedList: string[] = [];

  for (const col of processed) {
    if (col.__virtual) continue;
    const row = existing.get(col.name);
    if (!row) continue;

    const modelSQL = buildDefaultSQL(col);
    const dbSQL = row.column_default;
    const nModel = normalizeDefault(modelSQL);
    const nDb = normalizeDefault(dbSQL);

    if (nModel === nDb) continue;

    /* ---- Drop identity if no longer wanted ---- */
    if (!col.__identity && row.is_identity === "YES") {
      await client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${col.name}" DROP IDENTITY IF EXISTS`,
      );
      droppedList.push(col.name);
    }

    /* ---- Drop default ---- */
    if (nModel == null && nDb != null) {
      if (tableHasData && col.notNull) {
        reporter.addError({
          section: "COLUMN",
          table,
          message: `Cannot DROP default on "${col.name}" — column is NOT NULL and table has data. Future inserts will fail`,
        });
        return { ok: false };
      }
      alters.push(`ALTER COLUMN ${q(col.name)} DROP DEFAULT`);
      droppedList.push(col.name);
      continue;
    }

    /* ---- Set identity ---- */
    if (col.__identity && row.is_identity !== "YES") {
      await client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${col.name}" ADD GENERATED ALWAYS AS IDENTITY`,
      );
      setList.push(col.name);
      continue; // identity columns don't also get a SET DEFAULT
    }

    /* ---- Set default ---- */
    if (nModel != null) {
      alters.push(`ALTER COLUMN ${q(col.name)} SET DEFAULT ${modelSQL}`);
      setList.push(col.name);
    }
  }

  if (alters.length > 0) {
    await client.query(`ALTER TABLE ${q(table)} ${alters.join(", ")}`);
  }

  if (setList.length > 0 || droppedList.length > 0) {
    reporter.addColumn({
      kind: "default",
      table,
      set: setList,
      dropped: droppedList,
    });
  }

  return { ok: true };
}
