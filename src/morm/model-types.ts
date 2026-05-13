// model-types.ts

export type { IndexDefinition } from "./migrations/indexMigrations.js";

/**
 * Allowed SQL scalar types.
 * Parameterized types like VARCHAR(255), CHAR(10), NUMERIC(10,2)
 * are accepted as plain strings at runtime — TypeScript cannot
 * enforce the numeric parameter, so users pass them as `string`.
 */
export type AllowedTypeScalar =
  | "TEXT"
  | "INT"
  | "INTEGER"
  | "BIGINT"
  | "SMALLINT"
  | "UUID"
  | "BOOLEAN"
  | "JSON"
  | "JSONB"
  | "TIMESTAMP"
  | "TIMESTAMPTZ"
  | "DATE"
  | "TIME"
  | "TIMETZ"
  | "NUMERIC"
  | "DECIMAL"
  | "REAL"
  | "FLOAT8"
  | "VARCHAR"
  | "CHAR"
  | "BYTEA"
  | (string & {}); // allows VARCHAR(255), NUMERIC(10,2), CHAR(1), enums etc.

export type AllowedTypeArray =
  | "TEXT[]"
  | "INT[]"
  | "INTEGER[]"
  | "BIGINT[]"
  | "SMALLINT[]"
  | "UUID[]"
  | "BOOLEAN[]"
  | "JSON[]"
  | "JSONB[]"
  | "TIMESTAMP[]"
  | "TIMESTAMPTZ[]"
  | "DATE[]"
  | "TIME[]"
  | "TIMETZ[]"
  | "NUMERIC[]"
  | "DECIMAL[]"
  | "REAL[]"
  | "FLOAT8[]"
  | "VARCHAR[]"
  | "CHAR[]"
  | "BYTEA[]"
  | (string & {}); // allows enum arrays

export type AllowedType = AllowedTypeScalar | AllowedTypeArray;

/** Column reference definition */
export interface ColumnReference {
  table: string;
  column: string;
  relation: string; // ONE-TO-ONE | ONE-TO-MANY | MANY-TO-MANY
  onDelete?: string;
  onUpdate?: string;
}

/** Column definition */
export interface ColumnDefinition {
  name: string | (() => string);
  type: string | (() => string);
  primary?: boolean | (() => boolean);
  unique?: boolean | (() => boolean);
  notNull?: boolean | (() => boolean);
  default?: any | (() => any);
  check?: string | (() => string);
  references?: ColumnReference | null;
  sanitize?: boolean | "strict" | (() => boolean | "strict");
}
