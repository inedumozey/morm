import type { ColumnDefinition } from "../model-types.js";
import { parseCheck } from "../utils/checkParser.js";
import { colors } from "../utils/logColors.js";

function isNumericString(v: any): boolean {
  return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim());
}

const BUILTIN_SCALARS = new Set([
  "TEXT", // string except function literals e.g uuid(), now(), int()
  "INT", // whole numbers
  "INTEGER", // whole numbers
  "BIGINT", // whole numbers
  "SMALLINT", // whole numbers
  "UUID", // uuid() or uuid string
  "BOOLEAN", // false or true
  "JSONB", // ...
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DATE", // current_date, now() or valid date string (YYYY-MM-DD)
  "TIME",
  "TIMEZ",
  "NUMERIC",
  "DECIMAL",
]);

function isArrayType(typeUpper: string) {
  return typeUpper.endsWith("[]");
}

function normalizeType(type: string): string {
  const raw = String(type).trim();
  const upper = raw.toUpperCase();

  if (isArrayType(upper)) {
    const base = upper.slice(0, -2);
    if (BUILTIN_SCALARS.has(base)) return `${base}[]`;
    return raw;
  }

  if (BUILTIN_SCALARS.has(upper)) return upper;

  return raw; // custom/enum
}

function escapeLiteral(s: string) {
  return String(s).replace(/'/g, "''");
}

function formatPgArrayLiteral(elems: any[], elementTypeUpper: string) {
  const out: string[] = [];

  for (const el of elems) {
    if (el === null || el === undefined) {
      out.push("NULL");
      continue;
    }

    if (elementTypeUpper === "BOOLEAN") {
      out.push(el ? "t" : "f");
      continue;
    }

    if (elementTypeUpper === "JSONB") {
      out.push(`"${escapeLiteral(JSON.stringify(el))}"`);
      continue;
    }

    if (
      elementTypeUpper === "INT" ||
      elementTypeUpper === "INTEGER" ||
      elementTypeUpper === "BIGINT" ||
      elementTypeUpper === "SMALLINT" ||
      elementTypeUpper === "NUMERIC" ||
      elementTypeUpper === "DECIMAL"
    ) {
      out.push(String(el));
      continue;
    }

    out.push(`"${escapeLiteral(String(el))}"`);
  }

  return `{${out.join(",")}}`;
}

function looksLikeFunction(raw: string) {
  return /\w+\s*\(.*\)/.test(raw);
}

export function buildColumnSQL(
  col: ColumnDefinition & {
    name: string;
    __primary?: boolean;
    __identity?: boolean;
    __isEnumType?: boolean;
    __virtual?: boolean;
  }
): string {
  const parts: string[] = [];
  // column name
  parts.push(`"${col.name}"`);

  if (col.__virtual) {
    return "";
  }

  const typRaw = String(col.type);
  const typNormalized = normalizeType(typRaw);
  const typUpper = typNormalized.toUpperCase();

  // IDENTITY logic (int())
  if (col.__identity && (typUpper === "INT" || typUpper === "INTEGER")) {
    parts.push("INTEGER GENERATED ALWAYS AS IDENTITY");
  }

  // ARRAY TYPE
  else if (isArrayType(typUpper)) {
    const base = typUpper.slice(0, -2);
    if (BUILTIN_SCALARS.has(base)) {
      parts.push(`${base}[]`);
    } else {
      parts.push(`"${typRaw.replace(/\[\]$/, "").toLowerCase()}"[]`);
    }
  }

  // NORMAL TYPE
  else {
    if (BUILTIN_SCALARS.has(typUpper)) {
      parts.push(typUpper);
    } else {
      parts.push(`"${typRaw}"`);
    }
  }

  // ------------------------------------------------------
  // RELATION-BASED CONSTRAINTS (CREATE TABLE ONLY)
  // ------------------------------------------------------
  if (col.references) {
    const rel = col.references.relation;

    // NOT NULL by default for ALL relations
    if (col.notNull !== false) {
      parts.push("NOT NULL");
    }

    // ONE-TO-ONE → ALWAYS UNIQUE
    if (rel === "ONE-TO-ONE") {
      parts.push("UNIQUE");
    }
  }

  // PRIMARY KEY
  if (col.__primary) parts.push("PRIMARY KEY");

  // UNIQUE
  if (col.unique) parts.push("UNIQUE");

  // NOT NULL
  if (col.notNull) parts.push("NOT NULL");

  // ------------------------------------------------------
  // DEFAULT
  // ------------------------------------------------------
  if (col.default !== undefined) {
    const def = col.default;
    const rawTrim = typeof def === "string" ? def.trim() : def;

    // --- TEXT: always literal ---
    if (typUpper === "TEXT") {
      parts.push(`DEFAULT '${escapeLiteral(String(def))}'`);
    }

    // --- UUID ---
    else if (typUpper === "UUID") {
      if (def === null) {
        parts.push("DEFAULT NULL");
      } else if (typeof rawTrim === "string") {
        const lower = rawTrim.toLowerCase();

        if (lower === "uuid()") parts.push("DEFAULT gen_random_uuid()");
        else if (/^[0-9a-fA-F-]{36}$/.test(rawTrim))
          parts.push(`DEFAULT '${escapeLiteral(rawTrim)}'`);
        else if (looksLikeFunction(rawTrim)) parts.push(`DEFAULT ${rawTrim}`);
        else parts.push(`DEFAULT '${escapeLiteral(rawTrim)}'`);
      } else {
        parts.push(`DEFAULT '${escapeLiteral(String(def))}'`);
      }
    }

    // --- numeric strings become numeric literals ---
    else if (
      isNumericString(def) &&
      (typUpper === "INT" ||
        typUpper === "INTEGER" ||
        typUpper === "SMALLINT" ||
        typUpper === "BIGINT" ||
        typUpper === "NUMERIC" ||
        typUpper === "DECIMAL")
    ) {
      parts.push(`DEFAULT ${def.trim()}`);
    }

    // --- int() identity ---
    else if (typeof def === "string" && rawTrim.toLowerCase() === "int()") {
      // identity is handled earlier
    }

    // --- arrays ---
    else if (Array.isArray(def)) {
      const elType = typUpper.endsWith("[]") ? typUpper.slice(0, -2) : typUpper;
      const arrLit = formatPgArrayLiteral(def, elType);
      parts.push(`DEFAULT '${arrLit}'`);
    }

    // --- string defaults (for non-TEXT scalar types) ---
    else if (typeof def === "string") {
      if (looksLikeFunction(rawTrim)) parts.push(`DEFAULT ${rawTrim}`);
      else parts.push(`DEFAULT '${escapeLiteral(rawTrim)}'`);
    }

    // --- number / boolean ---
    else if (typeof def === "number" || typeof def === "boolean") {
      parts.push(`DEFAULT ${String(def)}`);
    }

    // --- null ---
    else if (def === null) {
      parts.push("DEFAULT NULL");
    }

    // --- JSON or object ---
    else {
      parts.push(`DEFAULT '${escapeLiteral(JSON.stringify(def))}'`);
    }
  }

  // CHECK constraint
  if (col.check && !col.references) {
    try {
      const sqlCheck = parseCheck(String(col.check));
      parts.push(`CHECK (${sqlCheck})`);
    } catch (err: any) {
      console.error(
        colors.red +
          colors.bold +
          `MORM CHECK SYNTAX ERROR in column "${col.name}":` +
          colors.reset
      );
      console.error(colors.red + `  CHECK: ${col.check}` + colors.reset);
      console.error(colors.red + `  ERROR: ${err.message}` + colors.reset);

      // STOP processing this column, return partial SQL
      return parts.join(" ");
    }
  }

  // ------------------------------------------------------
  // FOREIGN KEY (inline)
  // ------------------------------------------------------
  // NOT NULL
  if (col.notNull) parts.push("NOT NULL");

  // UNIQUE
  if (col.unique) parts.push("UNIQUE");

  // FOREIGN KEY
  if (col.references) {
    const ref = col.references;

    const onDelete = ref.onDelete ?? "CASCADE";
    const onUpdate = ref.onUpdate ?? "CASCADE";

    parts.push(
      `REFERENCES "${ref.table}"("${ref.column}")` +
        `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
    );
  }
  return parts.join(" ");
}
