// query/create.ts

import { MormError, throwQueryError } from "../utils/queryError.js";
import { resolveSanitize, sanitizeText } from "../utils/sanitize.js";
import type { SanitizeConfig } from "../utils/sanitize.js";
import {
  normalizeKeys,
  resolveProjection,
  type CreateClause,
  type CreateResult,
  type ExcludeClause,
  type IncludeClause,
} from "./index.js";
import {
  parseDateColumns,
  resolveObject,
  resolveValue,
  validateNumericString,
} from "./validation/queryUtility.js";

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function isTextColumn(type: string): boolean {
  const t = type.toUpperCase();
  return t === "TEXT" || t.startsWith("VARCHAR") || t.startsWith("CHAR");
}

/** Apply sanitize to a data row based on column types */
function sanitizeRow(
  data: Record<string, any>,
  columns: any[],
  globalSanitize: SanitizeConfig | undefined,
  schemaSanitize: SanitizeConfig | undefined,
  querySanitize: SanitizeConfig | undefined,
): Record<string, any> {
  const out = { ...data };
  for (const col of columns) {
    if (!(col.name in out)) continue;
    if (!isTextColumn(String(col.type))) continue;

    const resolved = resolveSanitize(
      globalSanitize,
      schemaSanitize,
      col.sanitize,
      querySanitize,
    );

    if (!resolved) continue;
    out[col.name] = sanitizeText(out[col.name], resolved);
  }
  return out;
}

/** Build SELECT column list from projection */
function buildSelectSQL(
  table: string,
  columns: any[],
  include?: IncludeClause,
  exclude?: ExcludeClause,
): string {
  const projection = resolveProjection(include, exclude);

  // Filter to only scalar columns (not virtual/relation columns)
  const scalarCols = columns.filter((c) => !c.__virtual);

  let selectedCols: any[];

  if (projection.mode === "include") {
    // Only include non-relation keys
    const includeKeys = new Set(
      Object.entries(include ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    );
    selectedCols = scalarCols.filter((c) => includeKeys.has(c.name));
  } else if (projection.mode === "exclude") {
    const excludeKeys = new Set(Object.keys(exclude ?? {}));
    selectedCols = scalarCols.filter((c) => !excludeKeys.has(c.name));
  } else {
    selectedCols = scalarCols;
  }

  if (selectedCols.length === 0) {
    return `${q(table)}.*`;
  }

  return selectedCols.map((c) => `${q(table)}.${q(c.name)}`).join(", ");
}

/* ===================================================== */
/* MAIN CREATE FUNCTION                                   */
/* ===================================================== */

export async function runCreate(
  client: any,
  model: any,
  clause: CreateClause,
  globalSanitize?: SanitizeConfig,
  debug = false,
): Promise<CreateResult | Record<string, any> | Record<string, any>[]> {
  const start = Date.now();
  const normalized = normalizeKeys(clause) as CreateClause;

  /* ---- Resolve clause-level functions ---- */
  const includeResolved =
    typeof (normalized as any).include === "function"
      ? await (normalized as any).include()
      : (normalized as any).include;
  const include = includeResolved
    ? await resolveObject(includeResolved)
    : includeResolved;

  const excludeResolved =
    typeof (normalized as any).exclude === "function"
      ? await (normalized as any).exclude()
      : (normalized as any).exclude;
  const exclude = excludeResolved
    ? await resolveObject(excludeResolved)
    : excludeResolved;

  const skipDuplicates =
    typeof (normalized as any).skipduplicates === "function"
      ? await resolveValue((normalized as any).skipduplicates)
      : (normalized as any).skipduplicates;

  const resolvedNormalized = {
    ...normalized,
    include,
    exclude,
    skipDuplicates,
  };

  const isMany = Array.isArray(normalized.data);
  const rows: Record<string, any>[] = isMany
    ? (normalized.data as Record<string, any>[])
    : [normalized.data as Record<string, any>];

  if (rows.length === 0) return { count: 0 };

  const { columns, table } = model;
  const schemaSanitize = model.sanitize;
  const querySanitize = normalized.sanitize;

  /* ---- Validate data is an object ---- */
  for (const row of rows) {
    if (typeof row !== "object" || Array.isArray(row) || row === null) {
      throw new MormError(
        {
          code: "MORM_INVALID_DATA",
          message: `data must be an object or array of objects`,
        },
        "create",
        table,
      );
    }
  }

  /* ---- Resolve functions in data ---- */
  const resolvedRows = await Promise.all(rows.map((row) => resolveObject(row)));

  /* ---- Sanitize all rows ---- */
  const sanitizedRows = resolvedRows.map((row) =>
    sanitizeRow(row, columns, globalSanitize, schemaSanitize, querySanitize),
  );

  /* ---- Validate column names in data ---- */
  const validColumns = new Set(
    columns.filter((c: any) => !c.__virtual).map((c: any) => c.name),
  );

  for (const row of sanitizedRows) {
    for (const key of Object.keys(row)) {
      if (!validColumns.has(key)) {
        throw new MormError(
          {
            code: "MORM_INVALID_COLUMN",
            message: `Column "${key}" does not exist on table "${table}"`,
            column: key,
          },
          "create",
          table,
        );
      }

      // Validate NaN and Infinity
      const val = row[key];
      if (typeof val === "number" && !isFinite(val)) {
        throw new MormError(
          {
            code: "MORM_INVALID_VALUE",
            message: `Invalid value "${val}" for column "${key}" — NaN and Infinity are not allowed`,
            column: key,
          },
          "create",
          table,
        );
      }

      // Validate string numbers
      const colDef = columns.find((c: any) => c.name === key);
      if (colDef && typeof val === "string") {
        const isNumericCol = [
          "INT",
          "INTEGER",
          "BIGINT",
          "SMALLINT",
          "NUMERIC",
          "DECIMAL",
          "REAL",
          "FLOAT8",
        ].some((t) => String(colDef.type).toUpperCase().startsWith(t));
        if (isNumericCol)
          validateNumericString(val, key, table, "create", String(colDef.type));
      }

      // Validate text column receives string value
      if (colDef && isTextColumn(String(colDef.type))) {
        if (val !== null && val !== undefined && typeof val !== "string") {
          throw new MormError(
            {
              code: "MORM_INVALID_VALUE",
              message: `Column "${key}" expects a string value, got "${typeof val}"`,
              column: key,
            },
            "create",
            table,
          );
        }
      }

      // Validate boolean column
      if (colDef && String(colDef.type).toUpperCase() === "BOOLEAN") {
        if (val !== null && val !== undefined && typeof val !== "boolean") {
          throw new MormError(
            {
              code: "MORM_INVALID_VALUE",
              message: `Column "${key}" expects a boolean value, got "${typeof val}"`,
              column: key,
            },
            "create",
            table,
          );
        }
      }

      // Validate array column
      if (colDef && String(colDef.type).toUpperCase().endsWith("[]")) {
        if (val !== null && val !== undefined && !Array.isArray(val)) {
          throw new MormError(
            {
              code: "MORM_INVALID_VALUE",
              message: `Column "${key}" expects an array value, got "${typeof val}"`,
              column: key,
            },
            "create",
            table,
          );
        }
        if (Array.isArray(val)) {
          const baseType = String(colDef.type).toUpperCase().slice(0, -2);
          const isTextArray = ["TEXT", "VARCHAR", "CHAR"].some((t) =>
            baseType.startsWith(t),
          );
          const isNumberArray = [
            "INT",
            "INTEGER",
            "BIGINT",
            "SMALLINT",
            "NUMERIC",
            "DECIMAL",
            "REAL",
            "FLOAT8",
          ].some((t) => baseType.startsWith(t));
          const isBoolArray = baseType === "BOOLEAN";
          for (const item of val) {
            if (item === null || item === undefined) continue;
            if (isTextArray && typeof item !== "string") {
              throw new MormError(
                {
                  code: "MORM_INVALID_VALUE",
                  message: `Array column "${key}" expects string items, got "${typeof item}"`,
                  column: key,
                },
                "create",
                table,
              );
            }
            if (isNumberArray && typeof item === "string") {
              validateNumericString(item, key, table, "create", baseType);
            }
            if (isBoolArray && typeof item !== "boolean") {
              throw new MormError(
                {
                  code: "MORM_INVALID_VALUE",
                  message: `Array column "${key}" expects boolean items, got "${typeof item}"`,
                  column: key,
                },
                "create",
                table,
              );
            }
          }
        }
      }

      // Validate enum column
      if (colDef && colDef.__isEnum) {
        if (val !== null && val !== undefined) {
          const enumValues = colDef.__enumValues as Set<string>;
          if (!enumValues.has(String(val))) {
            throw new MormError(
              {
                code: "MORM_INVALID_VALUE",
                message: `Invalid enum value "${val}" for column "${key}" — expected one of: ${[...enumValues].join(", ")}`,
                column: key,
              },
              "create",
              table,
            );
          }
        }
      }
    }

    // Validate VARCHAR length
    for (const col of columns) {
      if (!col.type || !String(col.type).toUpperCase().startsWith("VARCHAR"))
        continue;
      if (
        !(col.name in row) ||
        row[col.name] === null ||
        row[col.name] === undefined
      )
        continue;

      const match = String(col.type).match(/\((\d+)\)/);
      if (!match) continue;

      const maxLen = parseInt(match[1]!);
      if (String(row[col.name]).length > maxLen) {
        throw new MormError(
          {
            code: "22001",
            message: `Value too long for column "${col.name}" — max length is ${maxLen}`,
            column: col.name,
          },
          "create",
          table,
        );
      }
    }
  }

  /* ---- Build INSERT SQL ---- */
  /* ---- Group rows by key signature ---- */
  const groups = new Map<string, Record<string, any>[]>();

  for (const row of sanitizedRows) {
    const keys = Object.keys(row).sort().join(",");
    if (!groups.has(keys)) groups.set(keys, []);
    groups.get(keys)!.push(row);
  }

  const onConflict =
    normalized.skipDuplicates || (normalized as any).skipduplicates
      ? " ON CONFLICT DO NOTHING"
      : "";

  /* ---- Determine if we need to return rows ---- */
  const projection = resolveProjection(include, exclude);

  /* ---- Build RETURNING clause ---- */
  const needsReturning =
    projection.mode === "include" ||
    projection.mode === "exclude" ||
    (projection.mode === "all" && include !== undefined);
  /* ---- Execute each group ---- */
  let totalCount = 0;
  const allReturnedRows: Record<string, any>[] = [];

  for (const [, groupRows] of groups) {
    const groupKeys = Object.keys(groupRows[0]!);
    // console.log("group size:", groupRows.length);
    // console.log("chunkSize:", Math.floor(65535 / groupKeys.length));

    const maxParams = 65535;
    const chunkSize = Math.floor(maxParams / groupKeys.length);

    for (let i = 0; i < groupRows.length; i += chunkSize) {
      const chunk = groupRows.slice(i, i + chunkSize);
      const colList = groupKeys.map(q).join(", ");

      const valuePlaceholders = chunk.map((row, rowIdx) => {
        const vals = groupKeys.map(
          (_, colIdx) => `$${rowIdx * groupKeys.length + colIdx + 1}`,
        );
        return `(${vals.join(", ")})`;
      });

      const flatValues = chunk.flatMap((row) =>
        groupKeys.map((k) => (row[k] !== undefined ? row[k] : null)),
      );

      let sql: string;
      if (needsReturning) {
        const selectSQL = buildSelectSQL(table, columns, include, exclude);
        sql = `INSERT INTO ${q(table)} (${colList}) VALUES ${valuePlaceholders.join(", ")}${onConflict} RETURNING ${selectSQL}`;
      } else {
        sql = `INSERT INTO ${q(table)} (${colList}) VALUES ${valuePlaceholders.join(", ")}${onConflict}`;
      }

      try {
        const result = await client.query(sql, flatValues);
        totalCount += result.rowCount ?? chunk.length;
        if (needsReturning) allReturnedRows.push(...result.rows);
      } catch (err: any) {
        throwQueryError(err, "create", table);
      }
    } // closes chunk loop
  } // closes group loop

  /* ---- Return ---- */
  const elapsed = Date.now() - start;
  if (debug)
    console.log(
      `\x1b[36m  ⚡ create "${table}" — ${rows.length} rows — ${elapsed}ms\x1b[0m`,
    );

  if (!needsReturning) return { count: totalCount };
  const parsedRows = parseDateColumns(allReturnedRows, columns);
  if (isMany) return parsedRows;
  return parsedRows[0] ?? { count: 0 };
}
