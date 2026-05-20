// query/types.ts

import type { SanitizeConfig } from "../utils/sanitize.js";
export type MaybeFunction<T> = T | (() => T) | (() => Promise<T>);

/* ===================================================== */
/* WHERE CONDITIONS                                       */
/* ===================================================== */

type NumberKeys<T> = {
  [K in keyof T]: number extends NonNullable<T[K]> ? K : never;
}[keyof T] &
  string;

type ComparableKeys<T> = {
  [K in keyof T]: NonNullable<T[K]> extends boolean | any[]
    ? never
    : number extends NonNullable<T[K]>
      ? K
      : NonNullable<T[K]> extends Date
        ? K
        : never;
}[keyof T] &
  string;

export interface ScalarOperators {
  eq?: string | number | boolean | Date;
  not?: string | number | boolean | Date | null;
  gt?: string | number | Date;
  gte?: string | number | Date;
  lt?: string | number | Date;
  lte?: string | number | Date;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  notContains?: string;
  notStartsWith?: string;
  notEndsWith?: string;
  mode?: Mode;
}

export interface ArrayOperators {
  hasAny?: (string | number | boolean)[];
  hasEvery?: (string | number | boolean)[];
}

export type SortDirection = "asc" | "desc" | "ASC" | "DESC";
export type Mode = "sensitive" | "insensitive";

export type TextOperators = {
  eq?: string | null;
  not?: string | null;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  notContains?: string;
  notStartsWith?: string;
  notEndsWith?: string;
  mode?: Mode;
};

export type NumberOperators = {
  eq?: number | null;
  not?: number | null;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
};

export type BooleanOperators = {
  eq?: boolean | null;
  not?: boolean | null;
};

export type DateOperators = {
  eq?: Date | string | null;
  not?: Date | string | null;
  gt?: Date | string;
  gte?: Date | string;
  lt?: Date | string;
  lte?: Date | string;
};

export type ColumnCondition =
  | string
  | number
  | boolean
  | Date
  | null
  | ScalarOperators
  | ArrayOperators;

export type WhereClause<T = Record<string, any>> = {
  and?: WhereClause<T>[];
  or?: WhereClause<T>[];
} & {
  [K in keyof T]?: NonNullable<T[K]> extends any[]
    ? ArrayOperators | null
    : NonNullable<T[K]> extends boolean
      ? BooleanOperators | boolean | null
      : NonNullable<T[K]> extends Date
        ? DateOperators | Date | string | null
        : NonNullable<T[K]> extends number
          ? NumberOperators | number | null
          : NonNullable<T[K]> extends string
            ? string extends NonNullable<T[K]>
              ? TextOperators | string | null
              :
                  | NonNullable<T[K]>
                  | {
                      eq?: NonNullable<T[K]> | null;
                      not?: NonNullable<T[K]> | null;
                    }
                  | null
            : ColumnCondition | null;
};

/* ===================================================== */
/* INCLUDE / PROJECTION                                   */
/* ===================================================== */

export interface RelationInclude<T = Record<string, any>> {
  where?: WhereClause<T>;
  include?: IncludeClause<T>;
  exclude?: ExcludeClause<T>;
  orderBy?: OrderByClause<T>;
  take?: number;
  page?: MaybeFunction<number>;
  // take?: MaybeFunction<number>;
  // page?: MaybeFunction<number>;
  after?: { [K in keyof T]?: string | number | null };
  distinct?: DistinctClause<T>;
  count?: boolean;
  sum?: NumberKeys<T>;
  avg?: NumberKeys<T>;
  min?: ComparableKeys<T>;
  max?: ComparableKeys<T>;
  mode?: Mode;
}

export type IncludeClause<T = Record<string, any>> = {
  [K in keyof T]?: true | RelationInclude<T>;
};

export type ExcludeClause<T = Record<string, any>> = {
  [K in keyof T]?: true;
};

export type OrderByClause<T = Record<string, any>> = {
  [K in keyof T]?: SortDirection;
};

export type DistinctClause<T = Record<string, any>> = {
  [K in keyof T]?: true;
};

/* ===================================================== */
/* FIND                                                  */
/* ===================================================== */

export interface FindClause<T = Record<string, any>> {
  where?: WhereClause<T>;
  include?: IncludeClause<T>;
  exclude?: ExcludeClause<T>;
  orderBy?: OrderByClause<T>;
  take?: number;
  page?: number;
  after?: { [K in keyof T]?: string | number | null };
  distinct?: DistinctClause<T>;
  count?: boolean;
  sum?: NumberKeys<T>;
  avg?: NumberKeys<T>;
  min?: ComparableKeys<T>;
  max?: ComparableKeys<T>;
  mode?: Mode;
}

/* ===================================================== */
/* FIND ONE                                              */
/* ===================================================== */

export interface FindOneClause<T = Record<string, any>> {
  where?: WhereClause<T>;
  include?: IncludeClause<T>;
  exclude?: ExcludeClause<T>;
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
  include?: IncludeClause<T>;
  exclude?: ExcludeClause<T>;
  skipDuplicates?: boolean;
  sanitize?: SanitizeConfig;
}

export interface CreateResult {
  count: number;
}

/* ===================================================== */
/* UPDATE                                                */
/* ===================================================== */

export interface UpdateClause<T = Record<string, any>> {
  where?: WhereClause<T>;
  data: Partial<T>;
  include?: IncludeClause<T>;
  exclude?: ExcludeClause<T>;
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

export function hasAggregation(clause: FindClause<any>): boolean {
  return !!(
    clause.count ||
    clause.sum ||
    clause.avg ||
    clause.min ||
    clause.max
  );
}

export function resolveProjection(
  include?: IncludeClause<any>,
  exclude?: ExcludeClause<any>,
): { mode: "include" | "exclude" | "all"; keys: string[] } {
  if (include && Object.keys(include).length > 0) {
    return { mode: "include", keys: Object.keys(include) };
  }
  if (exclude && Object.keys(exclude).length > 0) {
    return { mode: "exclude", keys: Object.keys(exclude) };
  }
  return { mode: "all", keys: [] };
}
