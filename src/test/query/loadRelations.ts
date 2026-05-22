// query/loadRelations.ts

import { MormError } from "../utils/queryError.js";
import { runFind } from "./find.js";

function q(n: string) {
  return `"${n.replace(/"/g, '""')}"`;
}

async function loadIncoming(
  client: any,
  model: any,
  relatedModel: any,
  rows: Record<string, any>[],
  relation: any,
  nestedClause: any,
  modelMap: Map<string, any>,
  debug: boolean,
): Promise<void> {
  const parentIds = rows.map((r) => r[model.primaryKey]).filter(Boolean);
  if (parentIds.length === 0) return;

  const fkCol = relation.column;
  const relationType = relation.relation;

  try {
    const sql = `SELECT * FROM ${q(relatedModel.table)} WHERE ${q(fkCol)} = ANY($1)`;
    const result = await client.query(sql, [parentIds]);
    const relatedRows = result.rows;

    // Group related rows by FK value
    const grouped = new Map<string, any[]>();
    for (const row of relatedRows) {
      const fkVal = String(row[fkCol]);
      if (!grouped.has(fkVal)) grouped.set(fkVal, []);
      grouped.get(fkVal)!.push(row);
    }

    // Attach to parent rows
    for (const row of rows) {
      const parentId = String(row[model.primaryKey]);
      const related = grouped.get(parentId) ?? [];
      if (relationType === "ONE-TO-ONE") {
        row[relatedModel.table] = related[0] ?? null;
      } else {
        row[relatedModel.table] = related;
      }
    }

    // Load nested relations if nestedClause has include
    if (nestedClause.include) {
      const allRelated = [...grouped.values()].flat();
      if (allRelated.length > 0) {
        await loadRelations(
          client,
          relatedModel,
          allRelated,
          nestedClause.include,
          modelMap,
          debug,
        );
      }
    }
  } catch (err: any) {
    if (err instanceof MormError) throw err;
    throw new MormError(
      {
        code: "MORM_RELATION_ERROR",
        message: `Failed to load relation "${relatedModel.table}" on table "${model.table}": ${err.message}`,
      },
      "find",
      model.table,
    );
  }
}

async function loadOutgoing(
  client: any,
  model: any,
  relatedModel: any,
  rows: Record<string, any>[],
  relation: any,
  nestedClause: any,
  modelMap: Map<string, any>,
  debug: boolean,
): Promise<void> {
  const fkCol = relation.column;
  const fkIds = rows.map((r) => r[fkCol]).filter(Boolean);
  if (fkIds.length === 0) return;

  const relatedPk = relatedModel.primaryKey;

  try {
    const sql = `SELECT * FROM ${q(relatedModel.table)} WHERE ${q(relatedPk)} = ANY($1)`;
    const result = await client.query(sql, [fkIds]);
    const relatedRows = result.rows;

    const relatedMap = new Map<string, any>();
    for (const row of relatedRows) {
      relatedMap.set(String(row[relatedPk]), row);
    }

    for (const row of rows) {
      const fkVal = row[fkCol];
      row[relatedModel.table] = fkVal
        ? (relatedMap.get(String(fkVal)) ?? null)
        : null;
    }

    // Load nested relations if nestedClause has include
    if (nestedClause.include) {
      const allRelated = [...relatedMap.values()];
      if (allRelated.length > 0) {
        await loadRelations(
          client,
          relatedModel,
          allRelated,
          nestedClause.include,
          modelMap,
          debug,
        );
      }
    }
  } catch (err: any) {
    if (err instanceof MormError) throw err;
    throw new MormError(
      {
        code: "MORM_RELATION_ERROR",
        message: `Failed to load relation "${relatedModel.table}" on table "${model.table}": ${err.message}`,
      },
      "find",
      model.table,
    );
  }
}

async function loadManyToMany(
  client: any,
  model: any,
  relatedModel: any,
  rows: Record<string, any>[],
  relation: any,
  nestedClause: any,
  modelMap: Map<string, any>,
  debug: boolean,
): Promise<void> {
  const parentIds = rows.map((r) => r[model.primaryKey]).filter(Boolean);
  if (parentIds.length === 0) return;

  const tables = [model.table, relatedModel.table].sort();
  const junctionTable = `${tables[0]}_${tables[1]}_junction`;
  const parentFk = `${model.table}_id`;
  const relatedFk = `${relatedModel.table}_id`;
  const relatedPk = relatedModel.primaryKey;

  try {
    const sql = `
      SELECT ${q(relatedModel.table)}.*, ${q(junctionTable)}.${q(parentFk)}
      FROM ${q(relatedModel.table)}
      JOIN ${q(junctionTable)} ON ${q(relatedModel.table)}.${q(relatedPk)} = ${q(junctionTable)}.${q(relatedFk)}
      WHERE ${q(junctionTable)}.${q(parentFk)} = ANY($1)
    `;

    const result = await client.query(sql, [parentIds]);
    const relatedRows = result.rows;

    const grouped = new Map<string, any[]>();
    for (const row of relatedRows) {
      const parentId = String(row[parentFk]);
      if (!grouped.has(parentId)) grouped.set(parentId, []);
      const clean = { ...row };
      delete clean[parentFk];
      grouped.get(parentId)!.push(clean);
    }

    for (const row of rows) {
      const parentId = String(row[model.primaryKey]);
      row[relatedModel.table] = grouped.get(parentId) ?? [];
    }

    // Load nested relations if nestedClause has include
    if (nestedClause.include) {
      const allRelated = [...grouped.values()].flat();
      if (allRelated.length > 0) {
        await loadRelations(
          client,
          relatedModel,
          allRelated,
          nestedClause.include,
          modelMap,
          debug,
        );
      }
    }
  } catch (err: any) {
    if (err instanceof MormError) throw err;
    throw new MormError(
      {
        code: "MORM_RELATION_ERROR",
        message: `Failed to load relation "${relatedModel.table}" on table "${model.table}": ${err.message}`,
      },
      "find",
      model.table,
    );
  }
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

    // Skip column projections
    const isColumn = model.columns.some(
      (c: any) => c.name === keyLower && !c.__virtual,
    );
    if (isColumn) continue;

    // Find relation
    const allRelations = [
      ...(model._relations?.incoming ?? []),
      ...(model._relations?.outgoing ?? []),
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
    const isIncoming = (model._relations?.incoming ?? []).some(
      (r: any) =>
        String(r.toTable).toLowerCase() === keyLower ||
        String(r.fromTable).toLowerCase() === keyLower,
    );

    const nestedClause =
      typeof value === "object" && value !== true ? value : {};

    if (relationType === "MANY-TO-MANY") {
      await loadManyToMany(
        client,
        model,
        relatedModel,
        results,
        relation,
        nestedClause,
        modelMap,
        debug,
      );
    } else if (isIncoming) {
      await loadIncoming(
        client,
        model,
        relatedModel,
        results,
        relation,
        nestedClause,
        modelMap,
        debug,
      );
    } else {
      await loadOutgoing(
        client,
        model,
        relatedModel,
        results,
        relation,
        nestedClause,
        modelMap,
        debug,
      );
    }
  }

  return results;
}
