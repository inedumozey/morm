// query/loadRelations.ts

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

export async function loadRelations(
  client: any,
  model: any,
  rows: Record<string, any>[],
  include: Record<string, any>,
  modelMap: Map<string, any>,
  debug = false,
): Promise<Record<string, any>[]> {
  if (!rows.length || !include) return rows;

  const results = rows.map((r) => ({ ...r }));

  for (const [key, value] of Object.entries(include)) {
    const keyLower = key.toLowerCase();

    if (!value) continue;

    // Skip column projections — already handled
    const isColumn = model.columns.some(
      (c: any) => c.name === keyLower && !c.__virtual,
    );
    if (isColumn) continue;

    // Find relation
    const allRelations = [
      ...(model._relations?.outgoing ?? []),
      ...(model._relations?.incoming ?? []),
    ];

    const relation = allRelations.find(
      (r: any) =>
        String(r.toTable).toLowerCase() === keyLower ||
        String(r.fromTable).toLowerCase() === keyLower,
    );

    if (!relation) continue;

    const relatedModel = modelMap.get(keyLower);
    if (!relatedModel) continue;

    const relationType = relation.relation;
    const isOutgoing = model._relations.outgoing.some(
      (r: any) => String(r.toTable).toLowerCase() === keyLower,
    );

    const nestedClause =
      typeof value === "object" && value !== true ? value : {};

    if (relationType === "MANY-TO-MANY") {
      await loadManyToMany(
        client,
        model,
        relatedModel,
        results,
        nestedClause,
        modelMap,
        debug,
      );
    } else if (isOutgoing) {
      await loadOutgoing(
        client,
        model,
        relatedModel,
        results,
        nestedClause,
        relationType,
        relation,
        modelMap,
        debug,
      );
    } else {
      await loadIncoming(
        client,
        model,
        relatedModel,
        results,
        nestedClause,
        relationType,
        relation,
        modelMap,
        debug,
      );
    }
  }

  return results;
}
