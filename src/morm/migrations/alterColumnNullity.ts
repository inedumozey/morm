// migrations/alterColumnNullity.ts

import { colors } from "../utils/logColors.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type DbColumn = {
  column_name: string;
  is_nullable: string; // "YES" | "NO"
};

type Counts = {
  total: number;
  nonNull: Record<string, number>;
};

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

/* ===================================================== */
/* MAIN                                                  */
/* ===================================================== */

export async function alterColumnNullity(opts: {
  client: any;
  table: string;
  existing: Map<string, DbColumn>;
  processed: any[];
  counts: Counts | null;
  messages: string[];
}): Promise<{ ok: boolean }> {
  const { client, table, existing, processed, counts, messages } = opts;

  const tableHasData = (counts?.total ?? 0) > 0;

  for (const col of processed) {
    if (col.__virtual) continue;

    /* ========================================== */
    /* SKIP PRIMARY KEYS (IMPLICITLY NOT NULL)    */
    /* ========================================== */
    if (col.__primary) continue;

    const row = existing.get(col.name);
    if (!row) continue;

    const modelNN = col.notNull === true;
    const dbNN = row.is_nullable === "NO";

    if (modelNN === dbNN) continue;

    /* ---------- DROP NOT NULL ---------- */
    if (!modelNN && dbNN) {
      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} DROP NOT NULL`
      );

      messages.push(
        `${colors.success}Dropped NOT NULL:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );
      /* ---------- PRINT LOGS (ONCE) ---------- */
      //   if (messages.length > 0) {
      //     console.log(
      //       `${colors.section}${colors.bold}MODEL MIGRATION:${colors.reset}`
      //     );
      //     console.log(`  ${colors.subject}${table}${colors.reset}`);
      //     for (const m of messages) {
      //       console.log(`    ${m}`);
      //     }
      //     console.log("");
      //   }

      continue;
    }

    /* ---------- SET NOT NULL ---------- */
    if (modelNN && !dbNN) {
      if (tableHasData && col.default === undefined) {
        console.log(
          `${colors.section}${colors.bold}MODEL MIGRATION ERROR:${colors.reset}`
        );
        console.log(`  ${colors.subject}${table}${colors.reset}`);
        console.log(
          `    ${colors.error}Cannot SET NOT NULL:${colors.reset} ` +
            `${colors.subject}${col.name}${colors.reset}. Table contains data and the column has no default, add a default value or reset database`
        );
        console.log("");
        return { ok: false };
      }

      await client.query(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(col.name)} SET NOT NULL`
      );
      messages.push(
        `${colors.success}Set NOT NULL:${colors.reset} ${colors.subject}${col.name}${colors.reset}`
      );
    }
  }

  return { ok: true };
}
