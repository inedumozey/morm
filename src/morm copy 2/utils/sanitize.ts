// utils/sanitize.ts

export type SanitizeMode = false | true | "strict";

/** Basic safe text sanitizer */
export function sanitizeText(
  value: unknown,
  mode: SanitizeMode = true
): unknown {
  if (typeof value !== "string") return value;

  let v = value;

  // remove null bytes
  v = v.replace(/\0/g, "");

  // trim whitespace
  v = v.trim();

  // remove control characters
  v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  if (mode === "strict") {
    // strip HTML tags aggressively
    v = v.replace(/<[^>]*>/g, "");
  }

  return v;
}

/** Decide if a column should be sanitized */
export function shouldSanitize(
  modelSanitize: SanitizeMode | undefined,
  columnSanitize: SanitizeMode | undefined
): SanitizeMode {
  if (columnSanitize !== undefined) return columnSanitize;
  return modelSanitize ?? false;
}
