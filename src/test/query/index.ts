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
  eq?: MaybeFunction<string | number | boolean | Date | null>;
  not?: MaybeFunction<string | number | boolean | Date | null>;
  gt?: MaybeFunction<string | number | Date>;
  gte?: MaybeFunction<string | number | Date>;
  lt?: MaybeFunction<string | number | Date>;
  lte?: MaybeFunction<string | number | Date>;
  contains?: MaybeFunction<string>;
  startsWith?: MaybeFunction<string>;
  endsWith?: MaybeFunction<string>;
  notContains?: MaybeFunction<string>;
  notStartsWith?: MaybeFunction<string>;
  notEndsWith?: MaybeFunction<string>;
  mode?: MaybeFunction<Mode>;
}

export interface ArrayOperators {
  hasAny?: MaybeFunction<MaybeFunction<string | number | boolean>[]>;
  hasEvery?: MaybeFunction<MaybeFunction<string | number | boolean>[]>;
}

export type SortDirection = "asc" | "desc" | "ASC" | "DESC";
export type Mode = "sensitive" | "insensitive";

export type TextOperators = {
  eq?: MaybeFunction<string | null>;
  not?: MaybeFunction<string | null>;
  contains?: MaybeFunction<string>;
  startsWith?: MaybeFunction<string>;
  endsWith?: MaybeFunction<string>;
  notContains?: MaybeFunction<string>;
  notStartsWith?: MaybeFunction<string>;
  notEndsWith?: MaybeFunction<string>;
  mode?: MaybeFunction<Mode>;
};

export type NumberOperators = {
  eq?: MaybeFunction<number | null>;
  not?: MaybeFunction<number | null>;
  gt?: MaybeFunction<number>;
  gte?: MaybeFunction<number>;
  lt?: MaybeFunction<number>;
  lte?: MaybeFunction<number>;
};

export type BooleanOperators = {
  eq?: MaybeFunction<boolean | null>;
  not?: MaybeFunction<boolean | null>;
};

export type DateOperators = {
  eq?: MaybeFunction<Date | string | null>;
  not?: MaybeFunction<Date | string | null>;
  gt?: MaybeFunction<Date | string>;
  gte?: MaybeFunction<Date | string>;
  lt?: MaybeFunction<Date | string>;
  lte?: MaybeFunction<Date | string>;
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
  and?: MaybeFunction<WhereClause<T>>[];
  or?: MaybeFunction<WhereClause<T>>[];
} & {
  [K in keyof T]?: NonNullable<T[K]> extends any[]
    ? MaybeFunction<ArrayOperators | null>
    : NonNullable<T[K]> extends boolean
      ? MaybeFunction<BooleanOperators | boolean | null>
      : NonNullable<T[K]> extends Date
        ? MaybeFunction<DateOperators | Date | string | null>
        : NonNullable<T[K]> extends number
          ? MaybeFunction<NumberOperators | number | string | null>
          : NonNullable<T[K]> extends string
            ? string extends NonNullable<T[K]>
              ? MaybeFunction<TextOperators | string | null>
              : MaybeFunction<
                  | NonNullable<T[K]>
                  | {
                      eq?: MaybeFunction<NonNullable<T[K]> | null>;
                      not?: MaybeFunction<NonNullable<T[K]> | null>;
                    }
                  | null
                >
            : MaybeFunction<ColumnCondition | null>;
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
  [K in keyof T]?: MaybeFunction<true | RelationInclude<T>>;
};

export type ExcludeClause<T = Record<string, any>> = {
  [K in keyof T]?: MaybeFunction<true>;
};

export type OrderByClause<T = Record<string, any>> = {
  [K in keyof T]?: SortDirection;
};

export type DistinctClause<T = Record<string, any>> = {
  [K in keyof T]?: true;
};

export type PickInclude<T, I> =
  I extends Record<string, any> ? Pick<T, Extract<keyof T, keyof I>> : T;

export type OmitExclude<T, E> =
  E extends Record<string, any> ? Omit<T, Extract<keyof T, keyof E>> : T;

export type ProjectResult<T, C> = C extends { include: infer I }
  ? [keyof I] extends [never]
    ? T
    : PickInclude<T, I>
  : C extends { exclude: infer E }
    ? [keyof E] extends [never]
      ? T
      : OmitExclude<T, E>
    : { count: number };

/* ===================================================== */
/* FIND                                                  */
/* ===================================================== */

export interface FindClause<T = Record<string, any>> {
  where?: MaybeFunction<WhereClause<T>>;
  include?: MaybeFunction<IncludeClause<T>>;
  exclude?: MaybeFunction<ExcludeClause<T>>;
  orderBy?: MaybeFunction<OrderByClause<T>>;
  take?: MaybeFunction<number>;
  page?: MaybeFunction<number>;
  after?: MaybeFunction<{
    [K in keyof T]?: MaybeFunction<string | number | null>;
  }>;
  distinct?: MaybeFunction<DistinctClause<T>>;
  count?: MaybeFunction<boolean>;
  sum?: MaybeFunction<NumberKeys<T>>;
  avg?: MaybeFunction<NumberKeys<T>>;
  min?: MaybeFunction<ComparableKeys<T>>;
  max?: MaybeFunction<ComparableKeys<T>>;
  mode?: MaybeFunction<Mode>;
}

/* ===================================================== */
/* FIND ONE                                              */
/* ===================================================== */

export interface FindOneClause<T = Record<string, any>> {
  where?: MaybeFunction<WhereClause<T>>;
  include?: MaybeFunction<IncludeClause<T>>;
  exclude?: MaybeFunction<ExcludeClause<T>>;
  mode?: MaybeFunction<Mode>;
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

export type FindResult<T, C> = C extends { count: true }
  ? AggregationResult
  : C extends { sum: any }
    ? AggregationResult
    : C extends { avg: any }
      ? AggregationResult
      : C extends { min: any }
        ? AggregationResult
        : C extends { max: any }
          ? AggregationResult
          : C extends { include: infer I }
            ? [keyof I] extends [never]
              ? T[]
              : PickInclude<T, I>[]
            : C extends { exclude: infer E }
              ? [keyof E] extends [never]
                ? T[]
                : OmitExclude<T, E>[]
              : T[];
/* ===================================================== */
/* CREATE                                                */
/* ===================================================== */

export type MaybeFunctionPartial<T> = {
  [K in keyof T]?: MaybeFunction<T[K]>;
};

export interface CreateClause<
  T extends Record<string, any> = Record<string, any>,
> {
  data: MaybeFunctionPartial<T> | MaybeFunctionPartial<T>[];
  include?: MaybeFunction<IncludeClause<T>>;
  exclude?: MaybeFunction<ExcludeClause<T>>;
  skipDuplicates?: MaybeFunction<boolean>;
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
