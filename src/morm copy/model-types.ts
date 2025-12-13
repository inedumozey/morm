// model-types.ts

/** Allowed SQL types (case-insensitive via runtime, TS uses uppercase) */
export type AllowedTypeScalar =
  | "TEXT"
  | "INT"
  | "INTEGER"
  | "BIGINT"
  | "SMALLINT"
  | "UUID"
  | "BOOLEAN"
  | "JSONB"
  | "TIMESTAMP"
  | "DATE"
  | "TIME"
  | "NUMERIC"
  | "DECIMAL";

export type AllowedTypeArray =
  | "TEXT[]"
  | "INT[]"
  | "INTEGER[]"
  | "BIGINT[]"
  | "SMALLINT[]"
  | "UUID[]"
  | "BOOLEAN[]"
  | "JSONB[]"
  | "TIMESTAMP[]"
  | "DATE[]"
  | "TIME[]"
  | "NUMERIC[]"
  | "DECIMAL[]";

export type AllowedType = AllowedTypeScalar | AllowedTypeArray;

/** Column definition used by models at runtime */
export type ColumnDefinition = {
  name: string;
  type: string;
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  default?: any; // relaxed here — runtime enforces strict typing
  check?: string;
};
