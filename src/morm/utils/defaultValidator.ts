// utils/defaultValidator.ts

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

function isValidScalarDefault(
  value: any,
  type: string,
  enumValuesLower?: Set<string>,
  inArray = false
): boolean {
  switch (type) {
    case "TEXT":
      return typeof value === "string";

    case "INT":
      return Number.isInteger(value) || (!inArray && value === "int()");

    case "SMALLINT":
      return Number.isInteger(value) || (!inArray && value === "smallint()");

    case "BIGINT":
      return Number.isInteger(value) || (!inArray && value === "bigint()");

    case "DECIMAL":
      return typeof value === "number";

    case "BOOLEAN":
      return typeof value === "boolean";

    case "UUID":
      return (
        typeof value === "string" &&
        (value === "uuid()" || isUuidLiteral(value))
      );

    case "DATE":
    case "TIME":
    case "TIMESTAMP":
    case "TIMESTAMPTZ":
      return (
        typeof value === "string" &&
        (value === "now()" || isISODateString(value))
      );

    default:
      // ENUM
      if (enumValuesLower) {
        return enumValuesLower.has(String(value).toLowerCase());
      }
      return false;
  }
}

export function validateDefaultValue({
  col,
  base,
  isArray,
  enumValuesLower,
}: {
  col: any;
  base: string;
  isArray: boolean;
  enumValuesLower?: Set<string> | undefined;
}): string[] {
  const errors: string[] = [];
  const def = col.default;

  /* ===============================
   * ARRAY DEFAULTS
   * =============================== */
  if (isArray) {
    if (!Array.isArray(def)) {
      return [`DEFAULT ERROR: ${col.name} default must be an array`];
    }

    // empty array is always valid
    if (def.length === 0) return errors;

    for (const el of def) {
      if (!isValidScalarDefault(el, base, enumValuesLower, true)) {
        return [
          `DEFAULT ERROR: ${col.name} contains invalid ${base}[] elements`,
        ];
      }
    }

    return errors;
  }

  /* ===============================
   * SCALAR DEFAULTS
   * =============================== */
  if (!isValidScalarDefault(def, base, enumValuesLower, false)) {
    errors.push(
      `DEFAULT ERROR: ${col.name} has invalid default value for type:${base}`
    );
  }
  return errors;
}
