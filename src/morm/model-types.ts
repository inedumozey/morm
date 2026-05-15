// model-types.ts

export type { IndexDefinition } from "./migrations/indexMigrations.js";
import type { SanitizeConfig } from "./utils/sanitize.js";
export type { SanitizeOptions, SanitizeConfig } from "./utils/sanitize.js";

/** Most commonly used scalar types first */
export type AllowedTypeScalar =
  | "UUID"
  | "TEXT"
  | "INT"
  | "BOOLEAN"
  | "TIMESTAMPTZ"
  | "JSONB"
  | "INTEGER"
  | "BIGINT"
  | "SMALLINT"
  | "JSON"
  | "TIMESTAMP"
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
  | (string & {}); // allows VARCHAR(255), NUMERIC(10,2), CHAR(1), enums

export type AllowedTypeArray =
  | "UUID[]"
  | "TEXT[]"
  | "INT[]"
  | "BOOLEAN[]"
  | "TIMESTAMPTZ[]"
  | "JSONB[]"
  | "INTEGER[]"
  | "BIGINT[]"
  | "SMALLINT[]"
  | "JSON[]"
  | "TIMESTAMP[]"
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

/** Relation types — most common first, strict values only */
export type RelationType =
  | "nm" // ONE-TO-MANY
  | "nn" // ONE-TO-ONE
  | "mm" // MANY-TO-MANY
  | "1-m"
  | "1-1"
  | "m-m"
  | "n-m"
  | "n-n"
  | "one-to-many"
  | "one-to-one"
  | "many-to-many"
  | "1:m"
  | "1:1"
  | "m:m"
  | "n:m"
  | "n:n"
  | "ntm"
  | "ntn"
  | "mtm"
  | "n-t-m"
  | "n-t-n"
  | "m-t-m"
  | "one-many"
  | "one-one"
  | "many-many"
  | "one-t-many"
  | "one-t-one"
  | "many-t-many"
  | "one_to_one";

/** FK actions — strict values, red line on unsupported */
export type FKAction =
  | "CASCADE"
  | "RESTRICT"
  | "SET NULL"
  | "SET DEFAULT"
  | "NO ACTION";

/** Column reference definition */
export interface ColumnReference {
  table: string;
  column: string;
  relation: RelationType;
  onDelete?: FKAction;
  onUpdate?: FKAction;
}

/** Default value helpers — most common first */
export type DefaultValue =
  | "uuid()"
  | "now()"
  | "int()"
  | "smallint()"
  | "bigint()"
  | boolean
  | number
  | null
  | string
  | any[]
  | Record<string, any>;

/** Column definition */
export interface ColumnDefinition {
  name: string | (() => string);
  type: AllowedType | (() => AllowedType);
  primary?: boolean | (() => boolean);
  unique?: boolean | (() => boolean);
  notNull?: boolean | (() => boolean);
  default?: DefaultValue | (() => DefaultValue);
  check?: string | (() => string);
  references?: ColumnReference | null;
  sanitize?: SanitizeConfig | (() => SanitizeConfig);
}
