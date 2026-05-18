// utils/queryError.ts

export type QueryOperation =
  | "create"
  | "find"
  | "findOne"
  | "update"
  | "delete";

/* ===================================================== */
/* PG ERROR CODE MAP                                     */
/* ===================================================== */

const PG_ERROR_MAP: Record<string, string> = {
  // Constraint violations
  "23502": "Null constraint violation",
  "23503": "Foreign key constraint violation",
  "23505": "Unique constraint violation",
  "23514": "Check constraint violation",

  // Data errors
  "22001": "Value too long for column type",
  "22003": "Numeric value out of range",
  "22007": "Invalid date/time format",
  "22008": "Date/time field value out of range",
  "22012": "Division by zero",
  "22P02": "Invalid input syntax",

  // Transaction errors
  "40001": "Transaction deadlock detected",
  "40P01": "Deadlock detected",
  "55P03": "Lock timeout exceeded",
  "57014": "Statement timeout exceeded",

  // Connection errors
  "08000": "Connection error",
  "08006": "Connection failure",

  // Permission errors
  "42501": "Insufficient privileges",

  // Not found
  "42P01": "Table does not exist",
  "42703": "Column does not exist",
};

/* ===================================================== */
/* MORM ERROR CLASS                                      */
/* ===================================================== */

export class MormError extends Error {
  /** PostgreSQL error code e.g. "23502" */
  code: string;
  /** Table involved e.g. "user" */
  table: string | undefined;
  /** Column involved e.g. "account_number" */
  column: string | undefined;
  /** Query operation e.g. "create" */
  operation: QueryOperation;
  /** Raw PostgreSQL error detail */
  detail: string | undefined;

  constructor(pgError: any, operation: QueryOperation, table?: string) {
    const code = pgError.code ?? "UNKNOWN";
    let column = pgError.column ?? undefined;
    const detail = pgError.detail ?? undefined;

    // Extract column from detail for unique constraint violations
    if (!column && code === "23505" && detail) {
      const match = detail.match(/Key \((.+?)\)=/);
      if (match) column = match[1];
    }

    let baseMessage = PG_ERROR_MAP[code] ?? pgError.message ?? "Query failed";
    if (code === "42P01" && table)
      baseMessage = `Table "${table}" does not exist`;
    const skipColumnPart = [
      "MORM_INVALID_OPERATOR",
      "MORM_INVALID_CURSOR",
      "MORM_INVALID_COLUMN",
      "MORM_INVALID_VALUE",
      "MORM_NON_UNIQUE_WHERE",
      "MORM_INVALID_DATA",
    ].includes(code);
    const columnPart =
      column && !skipColumnPart ? ` on column "${column}"` : "";
    const tablePart =
      table && !columnPart && code !== "42P01" ? ` on table "${table}"` : "";

    super(`${baseMessage}${columnPart}${tablePart}`);

    this.name = "MormError";
    this.code = code;
    this.table = table;
    this.column = column;
    this.operation = operation;
    this.detail = detail;
  }
}

/* ===================================================== */
/* HELPER                                                */
/* ===================================================== */

export function throwQueryError(
  err: any,
  operation: QueryOperation,
  table?: string,
): never {
  throw new MormError(err, operation, table);
}
