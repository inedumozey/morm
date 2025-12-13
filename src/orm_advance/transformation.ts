// morm/transformation.ts
import { TransformationRules, ColumnDef } from "./types.js";

/**
 * applyTransforms(value, col, modelRules, globalRules)
 * - raw value may be primitive or { value, ...flags }
 * - apply in order: global <- model <- column <- rowFlags
 */
export function applyTransforms(
  rawValue: any,
  col?: ColumnDef,
  modelRules?: TransformationRules,
  globalRules?: TransformationRules
) {
  // extract row-level object pattern
  let value = rawValue;
  let rowFlags: TransformationRules | undefined;

  if (
    rawValue !== null &&
    typeof rawValue === "object" &&
    Object.prototype.hasOwnProperty.call(rawValue, "value")
  ) {
    const { value: v, ...rest } = rawValue;
    value = v;
    rowFlags = Object.keys(rest).length
      ? (rest as TransformationRules)
      : undefined;
  }

  const rules: TransformationRules = {
    ...(globalRules || {}),
    ...(modelRules || {}),
    ...(col?.transformation || {}),
    ...(rowFlags || {}),
  };

  // apply to strings
  if (typeof value === "string") {
    if (rules.trim) value = value.trim();
    if (rules.toUpperCase) value = value.toUpperCase();
    if (rules.toLowerCase) value = value.toLowerCase();
    if (rules.sanitize) {
      // simple sanitizer: remove <script> and dangerous chars
      value = value.replace(/<script.*?>.*?<\/script>/gi, "");
      value = value.replace(/[^\w\s@.\-_,:;()[\]{}!?#$%&*+=\/\\'"]/g, "");
    }
  }

  // arrays of strings: apply transforms per element
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    value = value.map((s) => {
      let t = s;
      if (rules.trim) t = t.trim();
      if (rules.toUpperCase) t = t.toUpperCase();
      if (rules.toLowerCase) t = t.toLowerCase();
      if (rules.sanitize) {
        t = t.replace(/<script.*?>.*?<\/script>/gi, "");
        t = t.replace(/[^\w\s@.\-_,:;()[\]{}!?#$%&*+=\/\\'"]/g, "");
      }
      return t;
    });
  }

  return value;
}
