// utils/generateTypes.ts
//
// Generates morm.generated.d.ts during migrate() in development.
// It is a pure declaration file — no runtime code, never imported.
// VSCode reads it automatically for type inference.
// Add morm.generated.d.ts to .gitignore
//
// Output example:
//
//   declare module "./db.js" {
//
//     type UserType = {
//       id?: string | null;
//       name?: string | null;
//       account_number: number;
//       created_at?: Date | null;
//       updated_at?: Date | null;
//     }
//
//     interface Morm {
//       user: {
//         create: (clause: CreateClause<UserType>) => Promise<any>;
//         ...
//       }
//     }
//   }

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { canonicalType, stripTypeModifier } from "./canonicalType.js";

/* ===================================================== */
/* SQL TYPE → TYPESCRIPT TYPE                            */
/* ===================================================== */

function sqlToTs(rawType: string, enumRegistry: Map<string, string[]>): string {
  const upper = String(rawType).trim().toUpperCase();
  const isArray = upper.endsWith("[]");
  const base = isArray
    ? canonicalType(stripTypeModifier(upper.slice(0, -2)))
    : canonicalType(stripTypeModifier(upper));

  // Enum type
  if (enumRegistry.has(base)) {
    const values = enumRegistry.get(base)!;
    const union = values.map((v) => `"${v}"`).join(" | ");
    return isArray ? `(${union})[]` : union;
  }

  let tsType: string;

  switch (base) {
    case "UUID":
    case "TEXT":
    case "VARCHAR":
    case "CHAR":
    case "DATE":
    case "TIME":
    case "TIMETZ":
    case "BYTEA":
      tsType = "string";
      break;

    case "INT":
    case "INTEGER":
    case "SMALLINT":
    case "BIGINT":
    case "NUMERIC":
    case "DECIMAL":
    case "REAL":
    case "FLOAT8":
      tsType = "number | string";
      break;

    case "BOOLEAN":
      tsType = "boolean";
      break;

    case "TIMESTAMP":
    case "TIMESTAMPTZ":
      tsType = "Date";
      break;

    case "JSON":
    case "JSONB":
      tsType = "Record<string, any>";
      break;

    default:
      tsType = "any";
  }

  return isArray ? `${tsType}[]` : tsType;
}

/* ===================================================== */
/* IS COLUMN REQUIRED ON INSERT                          */
/* ===================================================== */

function isRequired(col: any): boolean {
  if (col.__virtual) return false;
  if (col.__identity) return false;
  if (col.__primary && col.default !== undefined) return false;
  if (col.notNull === true && col.default === undefined) return true;
  return false;
}

/* ===================================================== */
/* TABLE NAME → PascalCase                               */
/* ===================================================== */

function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
}

/* ===================================================== */
/* GENERATE TYPE BLOCK FOR ONE MODEL                     */
/* ===================================================== */

function generateModelType(
  model: any,
  enumRegistry: Map<string, string[]>,
): {
  typeName: string;
  typeBlock: string;
  inputTypeName: string;
  inputTypeBlock: string;
} {
  const typeName = `${toPascalCase(model.table)}Type`;
  const lines: string[] = [];

  for (const col of model.columns) {
    if (col.__virtual) continue;

    const tsType = sqlToTs(String(col.type), enumRegistry);
    const required = isRequired(col);
    const nullable = !required && col.notNull !== true;

    lines.push(
      `    ${col.name}${required ? "" : "?"}: ${tsType}${nullable ? " | null" : ""};`,
    );
  }

  // Build input type — same but enums also accept string
  const enumLines = lines.map((line) => {
    return line.replace(
      /: (("[^"]*"(\s*\|\s*"[^"]*")*))(\s*\| null)?;/,
      (_, union, __, ___, nullPart) => {
        return `: ${union} | (string & {})${nullPart ?? ""};`;
      },
    );
  });

  const inputLines = enumLines.map((line) => {
    return line.replace(/: number(\s*\| null)?;/, (_, nullPart) => {
      return `: number | string${nullPart ?? ""};`;
    });
  });

  const inputTypeName = `${toPascalCase(model.table)}InputType`;
  const typeBlock = `  type ${typeName} = {\n${lines.join("\n")}\n  }`;
  const inputTypeBlock = `  type ${inputTypeName} = {\n${inputLines.join("\n")}\n  }`;
  return { typeName, typeBlock, inputTypeName, inputTypeBlock };
}

/* ===================================================== */
/* MAIN GENERATOR                                        */
/* ===================================================== */

export function generateTypes(
  models: any[],
  enumRegistry: Map<string, string[]>,
  modulePath: string = "./morm/morm.js",
  outputPath: string = process.cwd(),
): void {
  const lines: string[] = [];

  // Header
  lines.push(`// morm.generated.d.ts`);
  lines.push(
    `// ⚠️ ⚠️ ⚠️ Auto-generated by MORM; do not edit manually ⚠️ ⚠️ ⚠️`,
  );
  lines.push(`// Generated: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`export {};`);
  lines.push(``);
  lines.push(`declare global {`);
  lines.push(``);

  // Generate a type per model
  const modelTypes: {
    table: string;
    typeName: string;
    inputTypeName: string;
  }[] = [];

  for (const model of models) {
    const { typeName, typeBlock, inputTypeName, inputTypeBlock } =
      generateModelType(model, enumRegistry);
    lines.push(typeBlock);
    lines.push(``);
    lines.push(inputTypeBlock);
    lines.push(``);
    modelTypes.push({ table: model.table, typeName, inputTypeName });
  }

  // MormDB type — used inside transaction
  lines.push(`  type MormDB = {`);
  for (const { table, typeName, inputTypeName } of modelTypes) {
    lines.push(`    ${table}: {`);
    lines.push(
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>[]; include: any }): Promise<${typeName}[]>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>[]; exclude: any }): Promise<${typeName}[]>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>; include: any }): Promise<${typeName}>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>; exclude: any }): Promise<${typeName}>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}>): Promise<{ count: number }>;`,
    );
    lines.push(
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { count: true }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { sum: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { avg: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { min: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { max: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause?: import("./morm/query/index.js").FindClause<${typeName}>): Promise<${typeName}[]>;`,
    );
    lines.push(
      `      findOne: (clause?: import("./morm/query/index.js").FindOneClause<${typeName}>) => Promise<${typeName} | null>;`,
    );
    lines.push(
      `      update: (clause: import("./morm/query/index.js").UpdateClause<${typeName}>) => Promise<{ count: number }>;`,
    );
    lines.push(
      `      delete: (clause: { where?: any }) => Promise<{ count: number }>;`,
    );
    lines.push(`    };`);
  }
  lines.push(`  }`);
  lines.push(``);

  lines.push(`  namespace Express {`);
  lines.push(`    interface Request {`);
  lines.push(`      db: import("./morm/morm.js").Morm;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`}`); // closes declare global

  lines.push(``);
  lines.push(`declare module "${modulePath}" {`);
  lines.push(`  interface Morm {`);
  for (const { table, typeName, inputTypeName } of modelTypes) {
    lines.push(`    ${table}: {`);
    lines.push(
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>[]; include: any }): Promise<${typeName}[]>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>[]; exclude: any }): Promise<${typeName}[]>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>; include: any }): Promise<${typeName}>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}> & { data: Partial<${inputTypeName}>; exclude: any }): Promise<${typeName}>;`,
      `      create(clause: import("./morm/query/index.js").CreateClause<${inputTypeName}>): Promise<{ count: number }>;`,
    );
    lines.push(
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { count: true }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { sum: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { avg: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { min: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause: import("./morm/query/index.js").FindClause<${typeName}> & { max: string }): Promise<import("./morm/query/index.js").AggregationResult>;`,
      `      find(clause?: import("./morm/query/index.js").FindClause<${typeName}>): Promise<${typeName}[]>;`,
    );
    lines.push(
      `      findOne: (clause?: import("./morm/query/index.js").FindOneClause<${typeName}>) => Promise<${typeName} | null>;`,
    );
    lines.push(
      `      update: (clause: import("./morm/query/index.js").UpdateClause<${typeName}>) => Promise<{ count: number }>;`,
    );
    lines.push(
      `      delete: (clause: { where?: any }) => Promise<{ count: number }>;`,
    );
    lines.push(`    };`);
  }
  lines.push(
    `    transaction: <T, TDb extends object = MormDB>(fn: (db: TDb) => Promise<T>) => Promise<T>;`,
  );
  lines.push(`  }`);
  lines.push(`}`);

  // Write file
  const filePath = join(outputPath, "morm.generated.d.ts");
  const newContent = lines.join("\n");

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    const normalize = (s: string) => s.replace(/\/\/ Generated:.*/, "");
    if (normalize(existing) === normalize(newContent)) return;
  }

  writeFileSync(filePath, newContent, "utf-8");
  console.log(
    `\x1b[32m✓ morm.generated.d.ts\x1b[0m → \x1b[36m${filePath}\x1b[0m\n`,
  );
}
