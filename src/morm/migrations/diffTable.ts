// migrations/diffTable.ts

import { colors } from "../utils/logColors.js";
import { alterColumnCheck } from "./alterColumnCheck.js";
import { alterColumn } from "./alterColumn.js";
import { alterColumnTypes } from "./alterColumnTypes.js";
import { alterColumnNullity } from "./alterColumnNullity.js";
import { alterColumnUnique } from "./alterColumnUnique.js";
import { alterColumnDefault } from "./alterColumnDefault.js";
import { alterPrimaryKey } from "./alterPrimaryKey.js";
import { alterColumnReferences } from "./alterColumnReferences.js";

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

type Row = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
};

/* ===================================================== */
/* HELPERS                                               */
/* ===================================================== */

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

function groupMessages(messages: string[]) {
  const groups = new Map<string, string[]>();
  const others: string[] = [];

  function add(key: string, value: string) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(value);
  }

  for (const m of messages) {
    let match: any;

    // RENAME COLUMN
    if ((match = m.match(/Renamed column\s+"?([\w_]+)"?\s*->\s*"?(.*?)"?$/i))) {
      add("rename", `${match[1]} → ${match[2]}`);
    }

    // ADD / DROP COLUMN
    else if ((match = m.match(/Added column\s+"?([\w_]+)"?/i))) {
      add("add_column", match[1]);
    } else if ((match = m.match(/Dropped column\s+"?([\w_]+)"?/i))) {
      add("drop_column", match[1]);
    }

    // TYPE
    else if ((match = m.match(/Changed type\s+"?([\w_]+)"?/i))) {
      add("change_type", match[1]);
    }

    // NOT NULL
    else if ((match = m.match(/Set NOT NULL\s+"?([\w_]+)"?/i))) {
      add("set_not_null", match[1]);
    } else if ((match = m.match(/Dropped NOT NULL\s+"?([\w_]+)"?/i))) {
      add("drop_not_null", match[1]);
    }

    // DEFAULT
    else if ((match = m.match(/Set DEFAULT\s+"?([\w_]+)"?/i))) {
      add("set_default", match[1]);
    } else if ((match = m.match(/Dropped DEFAULT\s+"?([\w_]+)"?/i))) {
      add("drop_default", match[1]);
    }

    // UNIQUE
    else if ((match = m.match(/Set UNIQUE\s+"?([\w_]+)"?/i))) {
      add("set_unique", match[1]);
    } else if ((match = m.match(/Dropped UNIQUE\s+"?([\w_]+)"?/i))) {
      add("drop_unique", match[1]);
    }

    // CHECK
    else if ((match = m.match(/Added CHECK\s+(.+)/i))) {
      add("check_add", match[1]);
    } else if ((match = m.match(/Dropped CHECK\s+(.+)/i))) {
      add("check_drop", match[1]);
    } else if ((match = m.match(/Updated CHECK\s+(.+)/i))) {
      add("check_update", match[1]);
    }

    // PRIMARY KEY
    else if ((match = m.match(/Added PRIMARY KEY\s+"?([\w_]+)"?/i))) {
      add("pk_add", match[1]);
    } else if ((match = m.match(/Dropped PRIMARY KEY\s+"?([\w_]+)"?/i))) {
      add("pk_drop", match[1]);
    }

    // FALLBACK
    else {
      others.push(m);
    }
  }

  return { groups, others };
}

function renderGroupedMessages(messages: string[]) {
  const { groups, others } = groupMessages(messages);
  const out: string[] = [];

  function line(label: string, values: string[]) {
    out.push(
      `${colors.success}${label}:${colors.reset} ` +
        `${colors.subject}${values.join(", ")}${colors.reset}`
    );
  }

  if (groups.has("rename")) line("Renamed COLUMNS", groups.get("rename")!);

  if (groups.has("add_column"))
    line("Added COLUMNS", groups.get("add_column")!);

  if (groups.has("drop_column"))
    line("Dropped COLUMNS", groups.get("drop_column")!);

  if (groups.has("change_type"))
    line("Changed TYPES", groups.get("change_type")!);

  if (groups.has("set_not_null"))
    line("Set NOT NULL", groups.get("set_not_null")!);

  if (groups.has("drop_not_null"))
    line("Dropped NOT NULL", groups.get("drop_not_null")!);

  if (groups.has("set_default"))
    line("Set DEFAULTS", groups.get("set_default")!);

  if (groups.has("drop_default"))
    line("Dropped DEFAULTS", groups.get("drop_default")!);

  if (groups.has("set_unique")) line("Set UNIQUE", groups.get("set_unique")!);

  if (groups.has("drop_unique"))
    line("Dropped UNIQUE", groups.get("drop_unique")!);

  if (groups.has("check_add")) line("Added CHECKS", groups.get("check_add")!);

  if (groups.has("check_drop"))
    line("Dropped CHECKS", groups.get("check_drop")!);

  if (groups.has("check_update"))
    line("Updated CHECKS", groups.get("check_update")!);

  if (groups.has("pk_add")) line("Added PRIMARY KEYS", groups.get("pk_add")!);

  if (groups.has("pk_drop"))
    line("Dropped PRIMARY KEYS", groups.get("pk_drop")!);

  // Preserve anything unmatched
  out.push(...others);

  return out;
}

/* ===================================================== */
/* DB READERS                                            */
/* ===================================================== */

async function batchCounts(client: any, table: string, cols: string[]) {
  try {
    const parts = cols.map((c) => `count(${q(c)}) as ${q(c)}`).join(", ");
    const r = await client.query(
      `SELECT count(*) as total, ${parts} FROM ${q(table)}`
    );
    const row = r.rows[0];
    const total = Number(row.total || 0);
    const nonNull: Record<string, number> = {};
    cols.forEach((c) => (nonNull[c] = Number(row[c] || 0)));
    return { total, nonNull };
  } catch {
    return null;
  }
}

export async function diffTable(
  client: any,
  config: { table: string },
  processed: any[]
) {
  processed = processed.filter((c) => !c.__identity);
  const alters: string[] = [];
  const messages: string[] = [];

  const res = await client.query(
    `
    SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND LOWER(table_name) = LOWER($1)
    `,
    [config.table]
  );

  const existing = new Map<string, Row>(
    res.rows.map((r: Row) => [r.column_name, r])
  );

  const existingNames = Array.from(existing.keys());
  const counts = await batchCounts(client, config.table, existingNames);

  /* 1. ---------- CREATE OR ALTER COLUMN NAMES ------------ */
  {
    const rename = await alterColumn({
      client,
      table: config.table,
      existing,
      processed,
      messages,
      counts,
    });
    if (!rename.ok) {
      return false;
    }
  }

  /* 2. ---------- ALTER PRIMARY KEY -------------------------------- */
  {
    const pk = await alterPrimaryKey({
      client,
      table: config.table,
      processed,
      counts,
      messages,
    });
    if (!pk.ok) return false;
  }

  /* 3. ---------- CREATE OR ALTER COLUMN TYPES ------------- */
  {
    const typeRes = await alterColumnTypes({
      client,
      table: config.table,
      existing,
      processed,
      counts,
      messages,
    });
    if (!typeRes.ok) {
      return false;
    }
  }

  /* 4. ---------- CREATE OR ALTER NULL CONSTRAINT ----------- */
  {
    const typeNull = await alterColumnNullity({
      client,
      table: config.table,
      existing,
      processed,
      counts,
      messages,
    });
    if (!typeNull.ok) {
      return false;
    }
  }

  /* 5. ---------- CREATE OR ALTER UNIQUE CONSTRAINT ----------- */
  {
    const typeUnique = await alterColumnUnique({
      client,
      table: config.table,
      processed,
      counts,
      messages,
    });
    if (!typeUnique.ok) {
      return false;
    }
  }

  /* 6. ---------- CREATE OR ALTER REFERENCES ----------- */
  {
    const fkRes = await alterColumnReferences({
      client,
      table: config.table,
      processed,
      messages,
    });
    if (!fkRes.ok) return false;
  }

  /* 7. ---------- CREATE OR ALTER CHECK CONSTRAINT ----------- */
  {
    const typeCheck = await alterColumnCheck({
      client,
      table: config.table,
      processed,
      messages,
    });
    if (!typeCheck.ok) {
      return false;
    }
  }

  /* 8. ---------- CREATE / UPDATE / DROP DEFAULT ------------- */
  {
    const typeDefault = await alterColumnDefault({
      client,
      table: config.table,
      existing,
      processed,
      messages,
    });
    if (!typeDefault.ok) {
      return false;
    }
  }

  /* ---------- PRINT LOGS (ONCE) ---------- */
  if (messages.length > 0) {
    console.log(
      `${colors.section}${colors.bold}COLUMN MIGRATION:${colors.reset}`
    );
    console.log(`  ${colors.subject}${config.table}${colors.reset}`);
    const grouped = renderGroupedMessages(messages);
    for (const m of grouped) {
      console.log(`    ${m}`);
    }
  }

  /* ===================================================== */
  /* APPLY                                                 */
  /* ===================================================== */

  if (alters.length > 0) {
    await client.query(`ALTER TABLE ${q(config.table)} ${alters.join(", ")}`);
    return messages;
  }

  return [];
}
