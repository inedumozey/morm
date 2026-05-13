// migrations/alterColumnTypes.ts

import {
  canonicalType,
  stripTypeModifier,
  extractTypeModifier,
} from "../utils/canonicalType.js";
import { reporter } from "../utils/migrationReporter.js";
import { buildColumnSQL } from "../sql/buildColumnSQL.js";

type DbColumn = {
  column_name: string;
  data_type: string;
  udt_name: string;
  column_default: string | null;
};
type Counts = { total: number };

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function canonicalDbType(row: DbColumn): string {
  const dt = row.data_type.toLowerCase();
  if (dt === "array")
    return canonicalType(row.udt_name.replace(/^_/, "")) + "[]";
  if (dt === "timestamp with time zone") return "TIMESTAMPTZ";
  if (dt === "timestamp without time zone") return "TIMESTAMP";
  if (dt === "user-defined") return canonicalType(row.udt_name);
  return canonicalType(row.data_type);
}

function isArr(t: string) {
  return t.endsWith("[]");
}
function baseType(t: string) {
  return isArr(t) ? t.slice(0, -2) : t;
}

const BUILTIN_TYPES = new Set([
  "TEXT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "UUID",
  "BOOLEAN",
  "JSON",
  "JSONB",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DATE",
  "TIME",
  "TIMETZ",
  "NUMERIC",
  "DECIMAL",
  "REAL",
  "FLOAT8",
  "VARCHAR",
  "CHAR",
  "BYTEA",
]);

function renderTypeSql(t: string) {
  const modifier = extractTypeModifier(t);
  const base = modifier ? t.slice(0, t.lastIndexOf("(")).trim() : t;
  if (base.endsWith("[]")) {
    const inner = base.slice(0, -2);
    return BUILTIN_TYPES.has(inner) ? `${inner}[]` : `"${inner}"[]`;
  }
  if (BUILTIN_TYPES.has(base)) return modifier ? `${base}${modifier}` : base;
  return modifier ? `"${base}"${modifier}` : `"${base}"`;
}

const SAFE_CASTS = new Map<string, Set<string>>([
  [
    "SMALLINT",
    new Set([
      "INTEGER",
      "BIGINT",
      "NUMERIC",
      "REAL",
      "FLOAT8",
      "TEXT",
      "VARCHAR",
    ]),
  ],
  [
    "INTEGER",
    new Set(["BIGINT", "NUMERIC", "REAL", "FLOAT8", "TEXT", "VARCHAR"]),
  ],
  ["BIGINT", new Set(["NUMERIC", "TEXT", "VARCHAR"])],
  ["REAL", new Set(["FLOAT8", "NUMERIC", "TEXT", "VARCHAR"])],
  ["FLOAT8", new Set(["NUMERIC", "TEXT", "VARCHAR"])],
  ["NUMERIC", new Set(["TEXT", "VARCHAR"])],
  ["DECIMAL", new Set(["TEXT", "VARCHAR"])],
  ["CHAR", new Set(["TEXT", "VARCHAR"])],
  ["VARCHAR", new Set(["TEXT"])],
  ["UUID", new Set(["TEXT", "VARCHAR"])],
  ["DATE", new Set(["TEXT", "VARCHAR", "TIMESTAMP", "TIMESTAMPTZ"])],
  ["TIME", new Set(["TEXT", "VARCHAR", "TIMETZ"])],
  ["TIMETZ", new Set(["TEXT", "VARCHAR"])],
  ["TIMESTAMP", new Set(["TEXT", "VARCHAR", "TIMESTAMPTZ"])],
  ["TIMESTAMPTZ", new Set(["TEXT", "VARCHAR", "TIMESTAMP"])],
  ["JSON", new Set(["JSONB", "TEXT", "VARCHAR"])],
  ["JSONB", new Set(["TEXT", "VARCHAR"])],
  ["BOOLEAN", new Set(["TEXT", "VARCHAR"])],
  ["BYTEA", new Set(["TEXT"])],
]);

function isSafeCast(from: string, to: string): boolean {
  const fromBase = baseType(from);
  const toBase = baseType(to);
  if (isArr(from) !== isArr(to)) return false;
  return SAFE_CASTS.get(fromBase)?.has(toBase) ?? false;
}

function buildUsingClause(colName: string, from: string, to: string): string {
  const fromBase = baseType(from);
  const toBase = baseType(to);
  const typeSql = renderTypeSql(to);

  if (
    fromBase === "DATE" &&
    (toBase === "TIMESTAMP" || toBase === "TIMESTAMPTZ")
  )
    return `USING ${q(colName)}::${typeSql}`;
  if (
    (fromBase === "TIMESTAMP" && toBase === "TIMESTAMPTZ") ||
    (fromBase === "TIMESTAMPTZ" && toBase === "TIMESTAMP")
  )
    return `USING ${q(colName)}::${typeSql}`;
  if (fromBase === "TIME" && toBase === "TIMETZ")
    return `USING ${q(colName)}::${typeSql}`;
  if (fromBase === "JSON" && toBase === "JSONB")
    return `USING ${q(colName)}::${typeSql}`;

  const numericTypes = new Set([
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "REAL",
    "FLOAT8",
    "NUMERIC",
    "DECIMAL",
  ]);
  if (numericTypes.has(fromBase) && numericTypes.has(toBase))
    return `USING ${q(colName)}::${typeSql}`;
  if (toBase === "TEXT" || toBase === "VARCHAR")
    return `USING ${q(colName)}::${typeSql}`;

  return `USING ${q(colName)}::${typeSql}`;
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterColumnTypes(opts: {
  client: any;
  table: string;
  existing: Map<string, DbColumn>;
  processed: any[];
  counts: Counts | null;
}): Promise<{ ok: boolean }> {
  const { client, table, existing, processed, counts } = opts;
  const tableHasData = (counts?.total ?? 0) > 0;

  const enumRes = await client.query(
    `SELECT typname FROM pg_type WHERE typtype = 'e'`,
  );
  const enumTypes = new Set<string>(
    enumRes.rows.map((r: any) => canonicalType(r.typname)),
  );

  const typePairs: { col: string; from: string; to: string }[] = [];

  for (const col of processed) {
    if (col.__virtual) continue;

    const row = existing.get(col.name);
    if (!row) continue;

    const raw = String(col.type);
    const isArray = isArr(raw);
    const desiredBase = canonicalType(baseType(raw));
    const modifier = extractTypeModifier(raw);
    const desired = isArray
      ? `${desiredBase}[]`
      : modifier
        ? `${desiredBase}${modifier}`
        : desiredBase;
    const current = canonicalDbType(row);
    const currentBase = stripTypeModifier(current);
    const desiredBaseOnly = desiredBase;
    const currentBaseCanon = canonicalType(currentBase);
    const desiredBaseCanon = canonicalType(desiredBaseOnly);
    const desiredForSQL = desired;
    const currentFull = current;
    const desiredFull = desired;

    if (desiredFull === currentFull) continue;

    /* ---- Identity-related rebuild check ---- */
    const dbIdentRes = await client.query(
      `SELECT a.attname
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relname = $1
         AND a.attname = $2
         AND a.attidentity IN ('a', 'd')
         AND a.attnum > 0`,
      [table, col.name],
    );

    const isDbIdentity = dbIdentRes.rows.length > 0;
    const modelWantsIdentity = !!col.__identity;
    const intTypes = new Set(["INTEGER", "SMALLINT", "BIGINT"]);
    const currentIsInt = intTypes.has(canonicalType(baseType(current)));
    const needsRebuild =
      (isDbIdentity && !intTypes.has(desiredBaseOnly)) ||
      (modelWantsIdentity && !currentIsInt);

    if (needsRebuild) {
      if (tableHasData) {
        reporter.addError({
          section: "COLUMN",
          table,
          message: `Cannot rebuild column "${col.name}" — table has data. Run migrate({ reset: true })`,
        });
        return { ok: false };
      }

      const fkRes = await client.query(
        `SELECT tc.table_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_schema = 'public'
           AND LOWER(ccu.table_name) = LOWER($1)
           AND ccu.column_name = $2`,
        [table, col.name],
      );

      if (fkRes.rows.length > 0) {
        reporter.addError({
          section: "COLUMN",
          table,
          message: `Cannot rebuild column "${col.name}" — referenced as FK by: ${fkRes.rows.map((r: any) => r.table_name).join(", ")}. Drop the FK first or run migrate({ reset: true })`,
        });
        return { ok: false };
      }

      // Safe — drop and recreate column with new definition
      await client.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(col.name)}`);
      await client.query(
        `ALTER TABLE ${q(table)} ADD COLUMN ${buildColumnSQL(col)}`,
      );
      // Remove from existing map so downstream alter functions skip this
      // column — their data would be stale since the column was fully rebuilt
      existing.delete(col.name);
      typePairs.push({ col: col.name, from: currentFull, to: desiredFull });
      continue;
    }

    /* ---- Validate the target type is known ---- */
    const base = desiredBaseOnly;
    const isEnum = enumTypes.has(base);
    const isKnown = canonicalType(base) === base;

    if (!isKnown && !isEnum) {
      reporter.addError({
        section: "COLUMN",
        table,
        message: `Invalid TYPE on "${col.name}": "${desired}" is not supported or enum not registered`,
      });
      return { ok: false };
    }

    /* ---- Table has data — safe cast matrix ---- */
    if (tableHasData) {
      if (!isSafeCast(currentBaseCanon, desiredBaseCanon)) {
        reporter.addError({
          section: "COLUMN",
          table,
          message: `Cannot change TYPE of "${col.name}" from ${currentFull} → ${desiredFull} — unsafe with existing data. Run migrate({ reset: true }) or migrate data manually first`,
        });
        return { ok: false };
      }

      if (row.column_default !== null) {
        await client.query(
          `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} DROP DEFAULT`,
        );
      }

      const checkName = `${table}_${col.name}_check`;
      await client.query(
        `ALTER TABLE ${q(table)} DROP CONSTRAINT IF EXISTS ${q(checkName)}`,
      );

      const typeSql = renderTypeSql(desiredForSQL);
      const usingClause = buildUsingClause(
        col.name,
        currentBaseCanon,
        desiredBaseCanon,
      );
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} TYPE ${typeSql} ${usingClause}`,
      );

      typePairs.push({ col: col.name, from: currentFull, to: desiredFull });
      continue;
    }

    /* ---- Empty table — allow any type change freely ---- */
    if (row.column_default !== null) {
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} DROP DEFAULT`,
      );
    }

    const checkName = `${table}_${col.name}_check`;
    await client.query(
      `ALTER TABLE ${q(table)} DROP CONSTRAINT IF EXISTS ${q(checkName)}`,
    );

    const typeSql = renderTypeSql(desiredForSQL);
    await client.query(
      `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} TYPE ${typeSql} USING NULL::${typeSql}`,
    );

    typePairs.push({ col: col.name, from: currentFull, to: desiredFull });
  }

  if (typePairs.length > 0) {
    reporter.addColumn({ kind: "type", table, pairs: typePairs });
  }

  return { ok: true };
}
