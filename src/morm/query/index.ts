// query/types.ts

import type { SanitizeConfig } from "../utils/sanitize.js";

/* ===================================================== */
/* WHERE CONDITIONS                                       */
/* ===================================================== */

export interface ScalarOperators {
  eq?: string | number | boolean;
  not?: string | number | boolean | null;
  gt?: string | number;
  gte?: string | number;
  lt?: string | number;
  lte?: string | number;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
}

export interface ArrayOperators {
  hasAny?: (string | number | boolean)[];
  hasAll?: (string | number | boolean)[];
}

export type ColumnCondition =
  | string
  | number
  | boolean
  | null
  | ScalarOperators
  | ArrayOperators;

export type WhereClause = {
  and?: WhereClause[];
  or?: WhereClause[];
  [column: string]: ColumnCondition | WhereClause[] | undefined;
};

/* ===================================================== */
/* INCLUDE / PROJECTION                                   */
/* ===================================================== */

export interface RelationInclude {
  where?: WhereClause;
  include?: IncludeClause;
  exclude?: ExcludeClause;
  orderBy?: OrderByClause;
  take?: number;
  page?: number;
  after?: string;
  distinct?: DistinctClause;
  count?: boolean;
  sum?: string;
  avg?: string;
  min?: string;
  max?: string;
}

export type IncludeClause = {
  [column: string]: true | RelationInclude;
};

export type ExcludeClause = {
  [column: string]: true;
};

/* ===================================================== */
/* SORTING / DISTINCT                                    */
/* ===================================================== */

export type SortDirection = "asc" | "desc" | "ASC" | "DESC";

export type OrderByClause = {
  [column: string]: SortDirection;
};

export type DistinctClause = {
  [column: string]: true;
};

/* ===================================================== */
/* FIND                                                  */
/* ===================================================== */

export interface FindClause {
  where?: WhereClause;
  include?: IncludeClause;
  exclude?: ExcludeClause;
  orderBy?: OrderByClause;
  take?: number;
  page?: number;
  after?: Record<string, string | number>;
  distinct?: DistinctClause;
  count?: boolean;
  sum?: string;
  avg?: string;
  min?: string;
  max?: string;
}

/* ===================================================== */
/* FIND ONE                                              */
/* ===================================================== */

export interface FindOneClause {
  where?: WhereClause;
  include?: IncludeClause;
  exclude?: ExcludeClause;
}

/* ===================================================== */
/* AGGREGATION RESULT                                    */
/* ===================================================== */

export interface AggregationResult {
  count?: number;
  sum?: Record<string, number>;
  avg?: Record<string, number>;
  min?: Record<string, number | string>;
  max?: Record<string, number | string>;
}

/* ===================================================== */
/* CREATE                                                */
/* ===================================================== */

export interface CreateClause<
  T extends Record<string, any> = Record<string, any>,
> {
  data: Partial<T> | Partial<T>[];
  include?: IncludeClause;
  exclude?: ExcludeClause;
  skipDuplicates?: boolean;
  sanitize?: SanitizeConfig;
}
export interface CreateResult {
  count: number;
}

/* ===================================================== */
/* UPDATE                                                */
/* ===================================================== */

export interface UpdateClause {
  where?: WhereClause;
  data: Record<string, any>;
  include?: IncludeClause;
  exclude?: ExcludeClause;
  sanitize?: SanitizeConfig;
}

export interface UpdateResult {
  count: number;
}

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

const FIND_OPTION_KEYS = new Set([
  "include",
  "exclude",
  "orderby",
  "take",
  "page",
  "after",
  "distinct",
  "count",
  "sum",
  "avg",
  "min",
  "max",
]);

export function normalizeKeys<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[key.toLowerCase()] = obj[key];
  }
  return result as T;
}

export function isOptionsObject(obj: Record<string, any>): boolean {
  const normalized = normalizeKeys(obj);
  return Object.keys(normalized).some((k) => FIND_OPTION_KEYS.has(k));
}

export function hasAggregation(clause: FindClause): boolean {
  return !!(
    clause.count ||
    clause.sum ||
    clause.avg ||
    clause.min ||
    clause.max
  );
}

export function resolveProjection(
  include?: IncludeClause,
  exclude?: ExcludeClause,
): { mode: "include" | "exclude" | "all"; keys: string[] } {
  if (include && Object.keys(include).length > 0) {
    return { mode: "include", keys: Object.keys(include) };
  }
  if (exclude && Object.keys(exclude).length > 0) {
    return { mode: "exclude", keys: Object.keys(exclude) };
  }
  return { mode: "all", keys: [] };
}
