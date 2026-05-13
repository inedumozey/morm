// sql/buildColumnSQL.ts

import type { ColumnDefinition } from "../model-types.js";
import {
  canonicalType,
  canonicalTypeWithModifier,
  extractTypeModifier,
} from "../utils/canonicalType.js";
import { parseCheck } from "../utils/checkParser.js";
import { reporter } from "../utils/migrationReporter.js";
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
  "JSON",
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

function isArrayType(typeUpper: string) {
  return typeUpper.toUpperCase().endsWith("[]");
}

/**
 * Normalize a type string to its canonical form, preserving modifiers.
 * "varchar(255)" → "VARCHAR(255)"
 * "numeric(10,2)" → "NUMERIC(10,2)"
 * "text" → "TEXT"
 * "uuid[]" → "UUID[]"
 */
function normalizeType(type: string): string {
  const raw = String(type).trim();
  const upper = raw.toUpperCase();

  if (isArrayType(upper)) {
    const base = upper.slice(0, -2);
    const canonical = canonicalType(base);
    if (BUILTIN_SCALARS.has(canonical)) return `${canonical}[]`;
    return raw;
  }

  // Preserve modifier if present
  const modifier = extractTypeModifier(raw);
  const canonical = canonicalType(raw);

  if (BUILTIN_SCALARS.has(canonical)) {
    return modifier ? `${canonical}${modifier}` : canonical;
  }

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
  // Match word(args) but NOT known parameterized type patterns
  // e.g. "uuid()" is a function, "VARCHAR(255)" is a type not a function
  return (
    /\w+\s*\(.*\)/.test(raw) &&
    !/^(VARCHAR|CHAR|NUMERIC|DECIMAL|CHARACTER\s+VARYING|CHARACTER)\s*\(/i.test(
      raw.trim(),
    )
  );
}

export function buildColumnSQL(
  col: ColumnDefinition & {
    name: string;
    __primary?: boolean;
    __identity?: boolean;
    __isEnumType?: boolean;
    __virtual?: boolean;
  },
): string {
  const parts: string[] = [];
  parts.push(`"${col.name}"`);

  if (col.__virtual) {
    return "";
  }

  const typRaw = String(col.type);
  const typNormalized = normalizeType(typRaw); // e.g. "VARCHAR(255)"
  const typUpper = typNormalized.toUpperCase(); // e.g. "VARCHAR(255)"
  const typBase = canonicalType(typRaw); // e.g. "VARCHAR" (no modifier)
  const typModifier = extractTypeModifier(typRaw); // e.g. "(255)"

  if (col.__identity) {
    let type = "INTEGER";
    if (typBase === "SMALLINT") type = "SMALLINT";
    if (typBase === "BIGINT") type = "BIGINT";
    parts.push(`${type} GENERATED ALWAYS AS IDENTITY`);
  } else if (isArrayType(typUpper)) {
    const base = typUpper.slice(0, -2).replace(/\s*\(.*\)$/, "");
    const baseCanonical = canonicalType(base);
    if (BUILTIN_SCALARS.has(baseCanonical)) {
      parts.push(`${baseCanonical}[]`);
    } else {
      parts.push(`"${baseCanonical}"[]`);
    }
  } else {
    if (BUILTIN_SCALARS.has(typBase)) {
      // Output base type + modifier if present (e.g. VARCHAR(255), NUMERIC(10,2))
      parts.push(typModifier ? `${typBase}${typModifier}` : typBase);
    } else {
      // ENUM — always uppercase, quoted, no modifier
      parts.push(`"${typBase}"`);
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
    } catch {
      return parts.join(" ");
    }
  }

  buildDefault(col, parts, typBase);

  if (col.references) {
    const ref = col.references;
    const onDelete = ref.onDelete ?? "CASCADE";
    const onUpdate = ref.onUpdate ?? "CASCADE";

    parts.push(
      `REFERENCES "${ref.table}"("${ref.column}") ` +
        `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`,
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
          reporter.addError({
            section: "MODEL",
            table: col.name,
            message: `now() is not valid for column type ${typeUpper}`,
          });
          break;
      }
    }

    // arrays
    else if (Array.isArray(def)) {
      if (typeUpper === "JSON" || typeUpper === "JSONB") {
        parts.push(`DEFAULT '${escapeLiteral(JSON.stringify(def))}'`);
      } else if (typeUpper === "JSON[]" || typeUpper === "JSONB[]") {
        if (def.length === 0) {
          parts.push(`DEFAULT '{}'`);
        } else {
          reporter.addError({
            section: "MODEL",
            table: col.name,
            message: `Non-empty default for ${typeUpper} is not supported — use [] or remove the default`,
          });
        }
      } else {
        const elType = typeUpper.endsWith("[]")
          ? typeUpper.slice(0, -2)
          : typeUpper;
        const arrLit = formatPgArrayLiteral(def, elType);
        parts.push(`DEFAULT '${arrLit}'`);
      }
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
