// utils/junctionBuilder.ts

import { colors } from "./logColors.js";

type JunctionPlan = {
  table: string;
  createSQL: string;
  indexSQL: string[];
};

function snake(name: string) {
  return name.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()).replace(/^_/, "");
}

function sortedPair(a: string, b: string): [string, string] {
  return [a, b].sort((x, y) => x.localeCompare(y)) as [string, string];
}

/**
 * Build SQL for MANY-TO-MANY junction tables.
 * Pure function — NO execution.
 */
export function buildJunctionTables(models: any[]): JunctionPlan[] {
  const plans: JunctionPlan[] = [];
  const seen = new Set<string>();

  function getPrimaryKeyType(model: any): string {
    const pk = model.primaryKey ?? "id";
    const col = model.columns?.find((c: any) => c.name === pk);

    if (!col || !col.type) {
      throw new Error(
        `Cannot resolve primary key type for table "${model.table}"`
      );
    }

    return String(col.type).toUpperCase();
  }

  for (const model of models) {
    if (!model?.table) continue;

    const tableA = String(model.table);

    for (const rel of model._relations?.outgoing ?? []) {
      if (rel.relation !== "MANY-TO-MANY") continue;
      const tableB = rel.toTable;
      const isSelf = rel.isSelf;
      if (!tableB) continue;

      // deterministic naming order
      const [t1Raw, t2Raw] = sortedPair(tableA, tableB);

      const junction = isSelf
        ? `${snake(t1Raw)}_${snake(t2Raw)}_junction`
        : `${snake(t1Raw)}_${snake(t2Raw)}_junction`;

      if (seen.has(junction)) continue;
      seen.add(junction);

      const colA = isSelf
        ? `${snake(rel.column)}_source_id`
        : `${snake(t1Raw)}_id`;

      const colB = isSelf
        ? `${snake(rel.column)}_target_id`
        : `${snake(t2Raw)}_id`;

      const modelA = models.find((m) => m.table === t1Raw);
      const modelB = models.find((m) => m.table === t2Raw);

      const pkA = modelA?.primaryKey ?? "id";
      const pkB = modelB?.primaryKey ?? "id";

      const pkTypeA = getPrimaryKeyType(modelA);
      const pkTypeB = getPrimaryKeyType(modelB);

      plans.push({
        table: junction,
        createSQL: `
        CREATE TABLE IF NOT EXISTS "${junction}" (
          "${colA}" ${pkTypeA} NOT NULL,
          "${colB}" ${pkTypeB} NOT NULL,
          PRIMARY KEY ("${colA}", "${colB}"),
          FOREIGN KEY ("${colA}") REFERENCES "${t1Raw}"("${pkA}")
            ON DELETE CASCADE ON UPDATE CASCADE,
          FOREIGN KEY ("${colB}") REFERENCES "${t2Raw}"("${pkB}")
            ON DELETE CASCADE ON UPDATE CASCADE
        );
        `.trim(),

        indexSQL: [
          `CREATE INDEX IF NOT EXISTS "${junction}_${colA}_idx" ON "${junction}"("${colA}")`,
          `CREATE INDEX IF NOT EXISTS "${junction}_${colB}_idx" ON "${junction}"("${colB}")`,
        ],
      });
    }
  }

  return plans;
}

async function tableExists(client: any, table: string): Promise<boolean> {
  const res = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [table]
  );
  return res.rowCount > 0;
}

export async function renderJunctionBuilder(client: any, models: any) {
  const junctions = buildJunctionTables(models);
  const createdJunctions: string[] = [];

  for (const j of junctions) {
    const exists = await tableExists(client, j.table);
    if (exists) continue;

    await client.query(j.createSQL);
    for (const idx of j.indexSQL ?? []) {
      await client.query(idx);
    }
    createdJunctions.push(j.table);
  }

  if (createdJunctions.length > 0) {
    console.log(
      `${colors.section}${colors.bold}JUNCTION TABLE MIGRATION:${colors.reset}`
    );
    console.log(
      `  ${colors.success}Created:${colors.reset} ${
        colors.subject
      }${createdJunctions.join(", ")}${colors.reset}`
    );
    console.log("");
  }
}
