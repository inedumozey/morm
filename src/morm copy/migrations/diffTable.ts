import { buildColumnSQL } from "../sql/buildColumnSQL.js";
import { colors } from "../utils/logColors.js";

//=============== MIGRATIONS LOGIC ===============
function canonicalType(t: string | null | undefined): string {
  if (!t) return "";
  const raw = t.trim();
  const upper = raw.toUpperCase();

  const typeMap: Record<string, string> = {
    INT: "INTEGER",
    INTEGER: "INTEGER",
    TEXT: "TEXT",
    UUID: "UUID",
    BOOLEAN: "BOOLEAN",
    JSON: "JSON",
    JSONB: "JSONB",
    TIMESTAMP: "TIMESTAMP",
    DATE: "DATE",
  };

  return typeMap[upper] ?? raw;
}

async function tableRowCount(client: any, table: string): Promise<number> {
  const r = await client.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
  return Number(r.rows[0].cnt);
}

async function nonNullCount(client: any, table: string, name: string) {
  try {
    const r = await client.query(
      `SELECT count(*) FROM "${table}" WHERE "${name}" IS NOT NULL`
    );
    return Number(r.rows[0].count);
  } catch (err: any) {
    console.error(
      `${colors.red}${colors.bold}MORM ERROR counting nonNull:${colors.reset}`
    );
    console.error(`${colors.red}${err.message}${colors.reset}`);
    return 0;
  }
}

async function nullCount(client: any, table: string, name: string) {
  try {
    const r = await client.query(
      `SELECT count(*) FROM "${table}" WHERE "${name}" IS NULL`
    );
    return Number(r.rows[0].count);
  } catch (err: any) {
    console.error(
      `${colors.red}${colors.bold}MORM ERROR counting NULL:${colors.reset}`
    );
    console.error(`${colors.red}${err.message}${colors.reset}`);
    return 0;
  }
}

export async function diffTable(
  client: any,
  config: { table: string },
  processed: readonly any[],
  options?: { clean?: boolean; reset?: boolean }
) {
  type ColumnInfoRow = {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  };

  let res;
  try {
    res = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
       AND table_name = LOWER($1)`,
      [config.table]
    );
  } catch (err: any) {
    console.error(
      `${colors.red}${colors.bold}MORM MIGRATION ERROR reading column info:${colors.reset}`
    );
    console.error(`${colors.red}${err.message}${colors.reset}`);
    return [];
  }

  const rows = res.rows as ColumnInfoRow[];
  const existing = new Map<string, ColumnInfoRow>(
    rows.map((r) => [r.column_name, r])
  );

  const alters: string[] = [];
  const messages: string[] = [];

  const modelNames = processed.map((c) => c.name);
  const existingNames = Array.from(existing.keys());

  const existingMissing = existingNames.filter(
    (name) => !modelNames.includes(name)
  );
  const modelMissing = modelNames.filter((name) => !existing.has(name));

  const modelByName = new Map<string, any>(
    processed.map((c) => [c.name, c as any])
  );

  for (const oldName of existingMissing) {
    const oldInfo = existing.get(oldName);
    if (!oldInfo) continue;

    const candidates = modelMissing.filter((newName) => {
      const col = modelByName.get(newName);
      if (!col) return false;
      return canonicalType(col.type) === canonicalType(oldInfo.data_type);
    });

    if (candidates.length === 1) {
      const newName: any = candidates[0];

      alters.push(`RENAME COLUMN "${oldName}" TO "${newName}"`);
      messages.push(
        `${colors.cyan}Renamed column "${oldName}" → "${newName}"${colors.reset}`
      );

      existing.delete(oldName);
      existing.set(newName, oldInfo);

      const col = modelByName.get(newName);
      if (col) {
        col.__renamed = true;
      }

      const idx = modelMissing.indexOf(newName);
      if (idx >= 0) modelMissing.splice(idx, 1);
    }
  }

  for (const col of processed as any[]) {
    const name = String(col.name);
    const exists = existing.get(name);

    if (col.__primary) {
      existing.delete(name);
      continue;
    }

    if (!exists) {
      if (col.__renamed === true) {
        messages.push(
          `${colors.yellow}Skipped add "${name}" (satisfied by rename)${colors.reset}`
        );
        continue;
      }

      alters.push(`ADD COLUMN ${buildColumnSQL(col)}`);
      messages.push(`${colors.green}Added column "${name}"${colors.reset}`);
      continue;
    }

    const desiredType = canonicalType(col.type);
    const existingType = canonicalType(exists.data_type);

    if (desiredType !== existingType) {
      let total = 0;
      try {
        total = await tableRowCount(client, config.table);
      } catch (err: any) {
        console.error(
          `${colors.red}${colors.bold}MORM MIGRATION ERROR counting rows:${colors.reset}`
        );
        console.error(`${colors.red}${err.message}${colors.reset}`);
      }

      if (total === 0) {
        alters.push(
          `ALTER COLUMN "${name}" TYPE ${desiredType} USING "${name}"::${desiredType}`
        );
        messages.push(
          `${colors.cyan}Changed type "${name}" → ${desiredType} (table empty)${colors.reset}`
        );
      } else {
        messages.push(
          `${colors.yellow}Skipped type change on "${name}" (table has data)${colors.reset}`
        );
      }
    }

    const modelNN = !!col.notNull;
    const dbNN = exists.is_nullable === "NO";

    if (modelNN !== dbNN) {
      let nullVal = 0;
      try {
        nullVal = await nullCount(client, config.table, String(name));
      } catch (err: any) {
        console.error(
          `${colors.red}${colors.bold}MORM MIGRATION ERROR counting NULLs:${colors.reset}`
        );
        console.error(`${colors.red}${err.message}${colors.reset}`);
      }

      if (modelNN && nullVal === 0) {
        alters.push(`ALTER COLUMN "${name}" SET NOT NULL`);
        messages.push(
          `${colors.magenta}Set NOT NULL on "${name}"${colors.reset}`
        );
      } else if (!modelNN) {
        alters.push(`ALTER COLUMN "${name}" DROP NOT NULL`);
        messages.push(
          `${colors.magenta}Dropped NOT NULL on "${name}"${colors.reset}`
        );
      } else {
        messages.push(
          `${colors.yellow}Skipped NOT NULL change on "${name}" (contains NULLs)${colors.reset}`
        );
      }
    }

    const modelDefault = col.default ?? null;
    const dbDefault = exists.column_default ?? null;

    if (String(modelDefault) !== String(dbDefault)) {
      let cnt = 0;
      try {
        cnt = await nonNullCount(client, config.table, String(name));
      } catch (err: any) {
        console.error(
          `${colors.red}${colors.bold}MORM MIGRATION ERROR counting defaults:${colors.reset}`
        );
        console.error(`${colors.red}${err.message}${colors.reset}`);
      }

      if (cnt === 0) {
        if (modelDefault === null) {
          alters.push(`ALTER COLUMN "${name}" DROP DEFAULT`);
          messages.push(
            `${colors.green}Dropped DEFAULT on "${name}"${colors.reset}`
          );
        } else {
          alters.push(`ALTER COLUMN "${name}" SET DEFAULT ${modelDefault}`);
          messages.push(
            `${colors.green}Set DEFAULT on "${name}"${colors.reset}`
          );
        }
      } else {
        messages.push(
          `${colors.yellow}Skipped DEFAULT change on "${name}" (column has data)${colors.reset}`
        );
      }
    }

    existing.delete(name);
  }

  for (const name of existing.keys()) {
    if (!options?.clean) {
      messages.push(
        `${colors.yellow}Skipped drop "${name}" (clean:false)${colors.reset}`
      );
      continue;
    }

    let count = 0;
    try {
      count = await nonNullCount(client, config.table, String(name));
    } catch (err: any) {
      console.error(
        `${colors.red}${colors.bold}MORM MIGRATION ERROR counting column data:${colors.reset}`
      );
      console.error(`${colors.red}${err.message}${colors.reset}`);
    }

    if (count === 0) {
      alters.push(`DROP COLUMN "${name}"`);
      messages.push(
        `${colors.green}Dropped column "${name}" (empty)${colors.reset}`
      );
    } else if (options?.reset === true) {
      alters.push(`DROP COLUMN "${name}"`);
      messages.push(
        `${colors.red}Force dropped column "${name}" — DATA LOST (${count} rows)${colors.reset}`
      );
    } else {
      messages.push(
        `${colors.yellow}Skipped drop "${name}" (data exists)${colors.reset}`
      );
    }
  }

  if (alters.length > 0) {
    const cleanAlters = alters
      .map((a) => (a ? a.trim() : ""))
      .filter((a) => a.length > 0 && a !== ",");

    if (cleanAlters.length > 0) {
      const sql = `ALTER TABLE "${config.table}"\n  ${cleanAlters.join(
        ",\n  "
      )};`;

      try {
        await client.query(sql);
      } catch (err: any) {
        console.error(
          `${colors.red}${colors.bold}MORM MIGRATION ERROR applying alterations on "${config.table}":${colors.reset}`
        );
        console.error(`${colors.red}${err.message}${colors.reset}`);
        return null;
      }
    }
  }

  return messages;
}
