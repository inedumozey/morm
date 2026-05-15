// utils/sanitize.ts

export type CleanMode = false | "basic" | "strict" | "full";
export type CaseMode = false | "lower" | "upper" | "title";

export interface SanitizeOptions {
  trim?: boolean;
  case?: CaseMode;
  clean?: CleanMode;
}

export type SanitizeConfig = false | SanitizeOptions;

/** Apply case conversion */
function applyCase(v: string, mode: CaseMode): string {
  switch (mode) {
    case "lower":
      return v.toLowerCase();
    case "upper":
      return v.toUpperCase();
    case "title":
      return v.replace(
        /\w\S*/g,
        (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      );
    default:
      return v;
  }
}

/** Apply clean mode */
function applyClean(v: string, mode: CleanMode): string {
  if (!mode) return v;

  // basic — remove null bytes and control characters only
  if (mode === "basic") {
    v = v.replace(/\0/g, "");
    v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  // strict — strip HTML tags only
  if (mode === "strict") {
    v = v.replace(/<[^>]*>/g, "");
  }

  // full — combines basic + strict + extra deep cleaning
  if (mode === "full") {
    // basic
    v = v.replace(/\0/g, "");
    v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    // strict
    v = v.replace(/<[^>]*>/g, "");
    // extra deep cleaning
    v = v.replace(/[^\w\s.,!?@#$%&*()\-+=:;'"]/g, "");
    v = v.replace(/\s+/g, " ");
  }

  return v;
}

/** Sanitize a single text value */
export function sanitizeText(
  value: unknown,
  options: SanitizeOptions,
): unknown {
  if (typeof value !== "string") return value;

  let v = value;

  if (options.trim) v = v.trim();
  if (options.clean) v = applyClean(v, options.clean);
  if (options.case) v = applyCase(v, options.case);

  return v;
}

/** Merge sanitize configs — higher level overrides lower level.
 *
 * Config-level false  → wipes all accumulated options; column fully opts out.
 * Option-level false  → removes that specific option from the merged result.
 *                       e.g. { case: false } at query level removes case
 *                       even if it was set at global/table level.
 */
export function mergeSanitize(
  ...configs: (SanitizeConfig | undefined)[]
): SanitizeOptions | false {
  let result: SanitizeOptions = {};
  let hasConfig = false;

  for (const config of configs) {
    if (config === undefined) continue;

    // config-level false — wipe everything, column opts out entirely
    if (config === false) {
      result = {};
      hasConfig = false;
      continue;
    }

    const merged = { ...result, ...config };

    // option-level false — remove that key from the merged result
    for (const key of Object.keys(config) as (keyof SanitizeOptions)[]) {
      if (config[key] === false) delete merged[key];
    }

    result = merged;
    hasConfig = Object.keys(result).length > 0;
  }

  return hasConfig ? result : false;
}

/** Resolve final sanitize config for a column considering all levels */
export function resolveSanitize(
  globalSanitize: SanitizeConfig | undefined,
  tableSanitize: SanitizeConfig | undefined,
  columnSanitize: SanitizeConfig | undefined,
  querySanitize: SanitizeConfig | undefined,
): SanitizeOptions | false {
  return mergeSanitize(
    globalSanitize,
    tableSanitize,
    columnSanitize,
    querySanitize,
  );
}
