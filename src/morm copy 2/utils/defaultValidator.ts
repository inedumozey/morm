// utils/defaultValidator.ts

import { colors } from "../utils/logColors.js";
// Helper validators used by defaultValidator.ts

export function isWholeNumber(v: any): boolean {
  return typeof v === "number" && Number.isInteger(v);
}

export function isUuidLiteral(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

export function isISODateString(str: string): boolean {
  return !isNaN(Date.parse(str));
}

/**
 * validateDefault()
 * ------------------
 * Validates a DEFAULT value for a column.
 * Does NOT mutate the column — only validates.
 *
 * @param c ColumnDefinition
 * @param canonicalBase Canonical type (e.g. "UUID", "INTEGER", "TIMESTAMPTZ")
 * @param isArray Is this column an array?
 * @param enumName If column is enum
 * @param enumValuesLower Set<string> of allowed enum values
 * @returns array of validation error messages (possibly empty)
 */
export function validateDefaultValue({
  col: c,
  canonicalBase,
  isArray,
  enumName,
  enumValuesLower,
}: {
  col: any;
  canonicalBase: string;
  isArray: boolean;
  enumName?: string | undefined;
  enumValuesLower?: Set<string> | undefined;
}): string[] {
  const errors: string[] = [];
  const defRaw = c.default;

  if (defRaw === undefined || defRaw === null) return errors;

  const defLower =
    typeof defRaw === "string" ? defRaw.trim().toLowerCase() : defRaw;

  // ===============================
  // ARRAY DEFAULT VALIDATION
  // ===============================
  if (isArray) {
    if (!Array.isArray(defRaw)) {
      errors.push(
        `${colors.red}${colors.bold}MORM ERROR: default for array column "${c.name}" must be an array.${colors.reset}`
      );
      return errors;
    }

    // ENUM[]
    if (enumName) {
      for (const el of defRaw) {
        if (!enumValuesLower?.has(String(el).toLowerCase())) {
          errors.push(
            `${colors.red}${colors.bold}MORM ERROR: "${el}" is not valid for enum-array "${c.name}".${colors.reset}`
          );
        }
      }
      return errors;
    }

    // BASE TYPE ARRAY — Mirror scalar rules
    for (const el of defRaw) {
      switch (canonicalBase) {
        case "TEXT":
          if (typeof el !== "string") {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: TEXT[] element invalid in "${c.name}". Must be string.${colors.reset}`
            );
          } else if (/^\w+\s*\(.*\)$/i.test(el.trim())) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: TEXT[] element cannot be function-like "${el}" in "${c.name}".${colors.reset}`
            );
          }
          break;

        case "INT":
        case "INTEGER":
        case "SMALLINT":
        case "BIGINT":
          if (
            !(
              (typeof el === "number" && Number.isInteger(el)) ||
              (typeof el === "string" && /^-?\d+$/.test(el))
            )
          ) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: INT[] element "${el}" invalid in "${c.name}". Must be whole number or whole-number string.${colors.reset}`
            );
          }
          break;

        case "UUID":
          if (typeof el !== "string" || !isUuidLiteral(el)) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: UUID[] element "${el}" invalid in "${c.name}".${colors.reset}`
            );
          }
          break;

        case "BOOLEAN":
          if (typeof el !== "boolean") {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: BOOLEAN[] element "${el}" invalid in "${c.name}". Must be true/false.${colors.reset}`
            );
          }
          break;

        case "JSON":
        case "JSONB":
          if (!(typeof el === "object" || typeof el === "string")) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: JSON/JSONB[] element "${el}" invalid in "${c.name}". Must be object or JSON string.${colors.reset}`
            );
          }
          break;

        case "TIMESTAMP":
        case "TIME":
          if (typeof el !== "string" || !isISODateString(el)) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: ${canonicalBase}[] element "${el}" invalid in "${c.name}". Must be ISO time/date without timezone.${colors.reset}`
            );
          }
          break;

        case "TIMESTAMPTZ":
        case "TIMEZ":
          if (typeof el !== "string" || !isISODateString(el)) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: ${canonicalBase}[] element "${el}" invalid in "${c.name}". Must include timezone.${colors.reset}`
            );
          }
          break;

        case "DATE":
          if (
            typeof el !== "string" ||
            (!/^\d{4}-\d{2}-\d{2}$/.test(el) && !isISODateString(el))
          ) {
            errors.push(
              `${colors.red}${colors.bold}MORM ERROR: DATE[] element "${el}" invalid in "${c.name}". Must be YYYY-MM-DD.${colors.reset}`
            );
          }
          break;
      }
    }

    return errors;
  }

  // ────────────────────────────────────────────────
  // SPECIAL FUNCTION DEFAULTS
  // ────────────────────────────────────────────────
  const isUuidFunc = typeof defLower === "string" && defLower === "uuid()";
  const isIntFunc = typeof defLower === "string" && defLower === "int()";
  const isNow =
    typeof defLower === "string" &&
    (defLower === "now()" || defLower === "current_timestamp");
  const isCurrentDate =
    typeof defLower === "string" && defLower === "current_date";

  // ────────────────────────────────────────────────
  // ENUM (scalar)
  // ────────────────────────────────────────────────
  if (enumName) {
    if (!enumValuesLower?.has(String(defRaw).toLowerCase())) {
      errors.push(
        `${colors.red}${colors.bold}MORM ERROR: default "${defRaw}" invalid for enum "${enumName}".${colors.reset}`
      );
    }
    return errors;
  }

  // ────────────────────────────────────────────────
  // PER-TYPE VALIDATION
  // ────────────────────────────────────────────────
  switch (canonicalBase) {
    // UUID
    case "UUID":
      if (isUuidFunc) return errors;
      if (!(typeof defRaw === "string" && isUuidLiteral(defRaw))) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for UUID "${c.name}" must be uuid() or valid UUID.${colors.reset}`
        );
      }
      break;

    // INTEGER & WHOLE NUMBER TYPES
    case "INT":
    case "INTEGER":
    case "SMALLINT":
    case "BIGINT":
      if (isIntFunc) return errors;

      // number literal
      if (typeof defRaw === "number") {
        if (!Number.isInteger(defRaw))
          errors.push(
            `${colors.red}${colors.bold}MORM ERROR: default for "${c.name}" must be whole number or int().${colors.reset}`
          );
        break;
      }

      // numeric string → allow
      if (typeof defRaw === "string") {
        if (!/^-?\d+$/.test(defRaw.trim())) {
          errors.push(
            `${colors.red}${colors.bold}MORM ERROR: default for "${c.name}" must be whole number string or int().${colors.reset}`
          );
        }
        break;
      }

      // invalid type
      errors.push(
        `${colors.red}${colors.bold}MORM ERROR: default for "${c.name}" must be number, numeric string, or int().${colors.reset}`
      );
      break;

    // DECIMAL / NUMERIC
    case "NUMERIC":
    case "DECIMAL":
      if (
        typeof defRaw === "number" ||
        (typeof defRaw === "string" && /^-?\d+(\.\d+)?$/.test(defRaw.trim()))
      ) {
        break;
      }
      errors.push(
        `${colors.red}${colors.bold}MORM ERROR: default for DECIMAL/NUMERIC "${c.name}" must be a number or numeric string.${colors.reset}`
      );
      break;

    // BOOLEAN
    case "BOOLEAN":
      if (typeof defRaw !== "boolean") {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for BOOLEAN "${c.name}" must be true/false.${colors.reset}`
        );
      }
      break;

    // TEXT
    case "TEXT":
      if (typeof defRaw !== "string") {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for TEXT "${c.name}" must be a string.${colors.reset}`
        );
      } else {
        const lower = defRaw.trim().toLowerCase();
        if (/^\w+\s*\(.*\)$/.test(lower)) {
          errors.push(
            `${colors.red}${colors.bold}MORM ERROR: TEXT column "${c.name}" cannot use function defaults like ${defRaw}.${colors.reset}`
          );
        }
      }
      break;

    // JSON & JSONB
    case "JSON":
    case "JSONB":
      if (typeof defRaw !== "string" && typeof defRaw !== "object") {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for JSON/JSONB "${c.name}" must be object or JSON string.${colors.reset}`
        );
      }
      break;

    // TIME / TIMESTAMP (no timezone)
    case "TIME":
    case "TIMESTAMP":
      if (isNow) break;
      if (typeof defRaw !== "string" || !isISODateString(defRaw)) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for ${canonicalBase} "${c.name}" must be ISO date/time or now().${colors.reset}`
        );
      }
      break;

    // TIMEZ / TIMESTAMPTZ
    case "TIMEZ":
    case "TIMESTAMPTZ":
      if (isNow) break;
      if (typeof defRaw !== "string" || !isISODateString(defRaw)) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for ${canonicalBase} "${c.name}" must include timezone or use now().${colors.reset}`
        );
      }
      break;

    // DATE
    case "DATE":
      if (isCurrentDate) break;
      if (
        typeof defRaw !== "string" ||
        (!/^\d{4}-\d{2}-\d{2}$/.test(defRaw) && !isISODateString(defRaw))
      ) {
        errors.push(
          `${colors.red}${colors.bold}MORM ERROR: default for DATE "${c.name}" must be YYYY-MM-DD, current_date, or now().${colors.reset}`
        );
      }
      break;
  }

  return errors;
}
