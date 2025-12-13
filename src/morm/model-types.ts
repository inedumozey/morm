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

/** Column definitions used by models at runtime */
export interface ColumnReference {
  table: string;
  column: string;
  relation?: string; // ONE-TO-ONE | ONE-TO-MANY | MANY-TO-MANY
  onDelete?: string;
  onUpdate?: string;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  default?: any;
  check?: string;
  references?: ColumnReference | null;
}
