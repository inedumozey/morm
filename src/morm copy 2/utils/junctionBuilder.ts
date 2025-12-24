// utils/junctionBuilder.ts

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

  for (const model of models) {
    if (!model?.table) continue;

    const tableA = String(model.table);

    for (const rel of model._relations?.outgoing ?? []) {
      if (rel.relation !== "MANY-TO-MANY") continue;

      const tableB = rel.toTable;
      if (!tableB) continue;

      // deterministic ordering
      const [t1Raw, t2Raw] = sortedPair(tableA, tableB);
      const t1 = snake(t1Raw);
      const t2 = snake(t2Raw);

      const junction = `${t1}_${t2}_junction`;
      if (seen.has(junction)) continue;
      seen.add(junction);

      const colA = `${t1}_id`;
      const colB = `${t2}_id`;

      const modelA = models.find((m) => m.table === t1Raw);
      const modelB = models.find((m) => m.table === t2Raw);

      const pkA = modelA?.primaryKey ?? "id";
      const pkB = modelB?.primaryKey ?? "id";

      plans.push({
        table: junction,
        createSQL: `
CREATE TABLE IF NOT EXISTS "${junction}" (
  "${colA}" UUID NOT NULL,
  "${colB}" UUID NOT NULL,
  PRIMARY KEY ("${colA}", "${colB}"),
 FOREIGN KEY ("${colA}") REFERENCES "${t1Raw}"("${pkA}") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY ("${colB}") REFERENCES "${t2Raw}"("${pkB}") ON DELETE CASCADE ON UPDATE CASCADE
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
