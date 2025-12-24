// sql/buildColumnSQL.ts

import type { ColumnDefinition } from "../model-types.js";
import { canonicalType } from "../utils/canonicalType.js";
import { parseCheck } from "../utils/checkParser.js";
import { colors } from "../utils/logColors.js";
import { normalizeRelation } from "../utils/relationValidator.js";

function isNumber(v: any): boolean {
  return /^-?\d+(\.\d+)?$/.test(v);
}

const BUILTIN_SCALARS = new Set([
  "TEXT",
  "INT",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "UUID",
  "BOOLEAN",
  "JSONB",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "DATE",
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
  return raw;
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
  parts.push(`"${col.name}"`);

  if (col.__virtual) {
    return "";
  }

  const typRaw = String(col.type);
  const typNormalized = normalizeType(typRaw);
  const typUpper = typNormalized.toUpperCase();

  if (col.__identity) {
    let type = "INTEGER";
    if (typUpper == "SMALLINT") type = "SMALLINT";
    if (typUpper == "BIGINT") type = "BIGINT";
    parts.push(`${type} GENERATED ALWAYS AS IDENTITY`);
  } else if (isArrayType(typUpper)) {
    const base = typUpper.slice(0, -2);
    if (BUILTIN_SCALARS.has(base)) {
      parts.push(`${base}[]`);
    } else {
      parts.push(`"${base}"[]`);
    }
  } else {
    if (BUILTIN_SCALARS.has(typUpper)) {
      parts.push(typUpper);
    } else {
      // ENUM — always uppercase, quoted
      parts.push(`"${canonicalType(typRaw)}"`);
    }
  }
  // if col is primary key, ignore notNull and unique settings otherwise, allow both to be set
  if (col.__primary) {
    parts.push("PRIMARY KEY");
  } else {
    if (col.notNull) parts.push("NOT NULL");
    if (col.unique) parts.push("UNIQUE");
  }

  if (col.check && !col.references) {
    try {
      const sqlCheck = parseCheck(String(col.check));
      parts.push(`CHECK (${sqlCheck})`);
    } catch (err: any) {
      console.error(
        `${colors.section}${colors.bold}CHECK VALIDATION:${colors.reset}`
      );
      console.error(`  ${colors.subject}${col.name}${colors.reset}`);
      console.error(`    ${colors.error}Error:${colors.reset} ${err.message}`);

      return parts.join(" ");
    }
  }

  buildDefault(col, parts, typUpper);

  if (col.references) {
    const ref = col.references;
    const onDelete = ref.onDelete ?? "CASCADE";
    const onUpdate = ref.onUpdate ?? "CASCADE";

    if (normalizeRelation(ref.relation) === "ONE-TO-ONE") {
      // if relation is ONE-TO-ONE, it should be not null and unique by default
      if (col.notNull !== false) {
        parts.push("NOT NULL");
      }
      // if relation is ONE-TO-ONE, it must always be uniquw
      parts.push("UNIQUE");
    }

    parts.push(
      `REFERENCES "${ref.table}"("${ref.column}")` +
        `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
    );
  }

  return parts.join(" ");
}

function buildDefault(col: any, parts: string[], typUpper: any) {
  if (col.default !== undefined && !col.__identity) {
    const def = col.default;
    const raw = typeof def === "string" ? def.trim() : def;
    const typeUpper = typUpper;

    // uuid()
    if (raw === "uuid()") {
      parts.push("DEFAULT gen_random_uuid()");
    }

    // now() — type-aware
    else if (raw === "now()") {
      switch (typeUpper) {
        case "TIME":
          parts.push("DEFAULT CURRENT_TIME::time");
          break;

        case "TIMETZ":
          parts.push("DEFAULT CURRENT_TIME");
          break;

        case "DATE":
          parts.push("DEFAULT CURRENT_DATE");
          break;

        case "TIMESTAMP":
          parts.push("DEFAULT CURRENT_TIMESTAMP::timestamp");
          break;

        case "TIMESTAMPTZ":
          parts.push("DEFAULT CURRENT_TIMESTAMP");
          break;

        default:
          throw new Error(`now() is not valid for column type ${typeUpper}`);
      }
    }

    // arrays
    else if (Array.isArray(def)) {
      const elType = typeUpper.endsWith("[]")
        ? typeUpper.slice(0, -2)
        : typeUpper;
      const arrLit = formatPgArrayLiteral(def, elType);
      parts.push(`DEFAULT '${arrLit}'`);
    }

    // numeric
    else if (
      isNumber(def) &&
      ["INT", "SMALLINT", "BIGINT", "DECIMAL"].includes(typeUpper)
    ) {
      parts.push(`DEFAULT ${raw}`);
    }

    // boolean
    else if (typeof def === "boolean") {
      parts.push(`DEFAULT ${def ? "TRUE" : "FALSE"}`);
    }

    // string literal or function
    else if (typeof def === "string") {
      if (looksLikeFunction(raw)) {
        parts.push(`DEFAULT ${raw}`);
      } else {
        parts.push(`DEFAULT '${escapeLiteral(raw)}'`);
      }
    }

    // null
    else if (def === null) {
      parts.push("DEFAULT NULL");
    }

    // json / object
    else if (typeof def === "object") {
      parts.push(`DEFAULT '${escapeLiteral(JSON.stringify(def))}'`);
    }
  }
}
