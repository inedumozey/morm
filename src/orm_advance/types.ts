// morm/types.ts

export type TransformationRules = {
  trim?: boolean;
  sanitize?: boolean;
  toUpperCase?: boolean;
  toLowerCase?: boolean;
};

export type TransactionConfig = {
  retry?: number;
  timeoutMs?: number;
};

export type ReferenceDef = {
  table: string; // referenced table name
  column: string; // referenced column (usually id)
  type: "one-to-one" | "one-to-many" | "many-to-many";
  through?: string; // join table for many-to-many; optional
  onDelete?: string;
  onUpdate?: string;
};

export type ColumnDef = {
  name: string;
  type: string; // e.g., "UUID", "INT", "TEXT", "TIMESTAMP WITH TIME ZONE", "TEXT[]"
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  default?: any;
  isArray?: boolean;
  transformation?: TransformationRules;
  reference?: ReferenceDef;
};

export type ModelSchema = {
  name: string; // model name (table)
  columns: ColumnDef[];
  transformation?: TransformationRules; // model-level
  transaction?: TransactionConfig;
};

export type MormOptions = {
  url: string;
  NODE_ENV?: string;
  allowSSL?: boolean;
  rejectUnauthorized?: boolean;
  customSSLConfig?: object | null;
  transformation?: TransformationRules; // global defaults
  transaction?: TransactionConfig; // global defaults
  silentLogs?: boolean;
};
