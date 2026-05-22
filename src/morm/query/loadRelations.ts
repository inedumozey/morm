// query/loadRelations.ts

import { MormError } from "../utils/queryError.js";
import {
  buildSelectColumns,
  buildWhere,
  q,
  resolveObject,
} from "./validation/queryUtility.js";
import { runFind } from "./runFind.js";

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
  const parentIds = [
    ...new Set(rows.map((r) => r[model.primaryKey]).filter(Boolean)),
  ];
  if (parentIds.length === 0) return;

  const fkCol = relation.column;
  const relationType = relation.relation;

  const hasExclude = !!(
    nestedClause.exclude &&
    Object.keys(nestedClause.exclude)
      .map((k) => k.toLowerCase())
      .includes(fkCol)
  );
  const hasColumnProjection = nestedClause.include
    ? Object.entries(nestedClause.include).some(
        ([k, v]) =>
          v === true &&
          relatedModel.columns.some(
            (c: any) => c.name === k.toLowerCase() && !c.__virtual,
          ),
      )
    : false;

  try {
    let relatedRows: Record<string, any>[];

    // Per-parent aggregation using GROUP BY
    const isAgg = !!(
      nestedClause.count ||
      nestedClause.sum ||
      nestedClause.avg ||
      nestedClause.min ||
      nestedClause.max
    );
    if (isAgg) {
      const aggParts: string[] = [`${q(relatedModel.table)}.${q(fkCol)}`];
      if (nestedClause.count) aggParts.push(`COUNT(*) AS "count"`);
      if (nestedClause.sum)
        aggParts.push(
          `SUM(${q(relatedModel.table)}.${q(nestedClause.sum)}) AS "sum_${nestedClause.sum}"`,
        );
      if (nestedClause.avg)
        aggParts.push(
          `AVG(${q(relatedModel.table)}.${q(nestedClause.avg)}) AS "avg_${nestedClause.avg}"`,
        );
      if (nestedClause.min)
        aggParts.push(
          `MIN(${q(relatedModel.table)}.${q(nestedClause.min)}) AS "min_${nestedClause.min}"`,
        );
      if (nestedClause.max)
        aggParts.push(
          `MAX(${q(relatedModel.table)}.${q(nestedClause.max)}) AS "max_${nestedClause.max}"`,
        );

      const params: any[] = [parentIds];
      let sql = `SELECT ${aggParts.join(", ")} FROM ${q(relatedModel.table)} WHERE ${q(fkCol)} = ANY($1)`;

      if (nestedClause.where) {
        const where = await resolveObject(nestedClause.where);
        const whereSQL = buildWhere(
          where,
          params,
          relatedModel.table,
          relatedModel.columns,
          relatedModel.table,
          nestedClause.mode,
        );
        if (whereSQL !== "TRUE") sql += ` AND ${whereSQL}`;
      }

      sql += ` GROUP BY ${q(relatedModel.table)}.${q(fkCol)}`;

      const result = await client.query(sql, params);

      // Build result per parent
      const aggMap = new Map<string, any>();
      for (const row of result.rows) {
        const parentId = String(row[fkCol]);
        const aggResult: Record<string, any> = {};
        if (nestedClause.count) aggResult.count = parseInt(row.count ?? "0");
        if (nestedClause.sum)
          aggResult.sum = {
            [nestedClause.sum]: parseFloat(
              row[`sum_${nestedClause.sum}`] ?? "0",
            ),
          };
        if (nestedClause.avg)
          aggResult.avg = {
            [nestedClause.avg]: parseFloat(
              row[`avg_${nestedClause.avg}`] ?? "0",
            ),
          };
        if (nestedClause.min)
          aggResult.min = {
            [nestedClause.min]: row[`min_${nestedClause.min}`],
          };
        if (nestedClause.max)
          aggResult.max = {
            [nestedClause.max]: row[`max_${nestedClause.max}`],
          };
        aggMap.set(parentId, aggResult);
      }

      for (const row of rows) {
        const parentId = String(row[model.primaryKey]);
        row[relatedModel.table] =
          aggMap.get(parentId) ?? (nestedClause.count ? { count: 0 } : {});
      }
      return;
    }

    if (nestedClause.take !== undefined) {
      const takeNum = parseInt(String(nestedClause.take));
      const colProjection = buildSelectColumns(
        relatedModel.columns,
        nestedClause.include,
        nestedClause.exclude,
        relatedModel.table,
      );
      const fkIncluded =
        colProjection.includes(`"${fkCol}"`) ||
        colProjection === `"${relatedModel.table}".*`;
      const selectSQL = fkIncluded
        ? colProjection
        : `${colProjection}, ${q(relatedModel.table)}.${q(fkCol)}`;

      const params: any[] = [parentIds];
      let whereClause = "";

      if (nestedClause.where) {
        const where = await resolveObject(nestedClause.where);
        const whereSQL = buildWhere(
          where,
          params,
          relatedModel.table,
          relatedModel.columns,
          relatedModel.table,
          nestedClause.mode,
        );
        if (whereSQL !== "TRUE") whereClause = ` AND ${whereSQL}`;
      }

      let orderBySQL = `${q(relatedModel.table)}.${q(relatedModel.primaryKey)} ASC`;
      if (nestedClause.orderby || nestedClause.orderBy) {
        const orderBy = nestedClause.orderby ?? nestedClause.orderBy;
        const orderParts = Object.entries(orderBy).map(
          ([col, dir]) =>
            `${q(relatedModel.table)}.${q(col.toLowerCase())} ${String(dir).toUpperCase() === "DESC" ? "DESC" : "ASC"}`,
        );
        if (orderParts.length > 0) orderBySQL = orderParts.join(", ");
      }

      const page = nestedClause.page ? parseInt(String(nestedClause.page)) : 1;
      const offset = (page - 1) * takeNum;
      const minRn = offset + 1;
      const maxRn = offset + takeNum;

      const sql = `
        SELECT * FROM (
          SELECT ${selectSQL},
            ROW_NUMBER() OVER (
              PARTITION BY ${q(relatedModel.table)}.${q(fkCol)}
              ORDER BY ${orderBySQL}
            ) as __rn
          FROM ${q(relatedModel.table)}
          WHERE ${q(fkCol)} = ANY($1)${whereClause}
        ) __t WHERE __rn >= ${minRn} AND __rn <= ${maxRn}
      `;

      const result = await client.query(sql, params);
      relatedRows = result.rows.map((r: any) => {
        const { __rn, ...rest } = r;
        return rest;
      });

      if (nestedClause.include && relatedRows.length > 0) {
        await loadRelations(
          client,
          relatedModel,
          relatedRows,
          nestedClause.include,
          modelMap,
          debug,
        );
      }
    } else {
      const clauseWithFk = hasColumnProjection
        ? {
            ...nestedClause,
            include: { ...(nestedClause.include ?? {}), [fkCol]: true },
          }
        : hasExclude
          ? {
              ...nestedClause,
              exclude: Object.fromEntries(
                Object.entries(nestedClause.exclude).filter(
                  ([k]) => k.toLowerCase() !== fkCol,
                ),
              ),
            }
          : nestedClause;

      const findResult = await runFind(
        client,
        relatedModel,
        clauseWithFk,
        debug,
        modelMap,
        { column: fkCol, values: parentIds },
      );

      // If aggregation result — attach directly to all parent rows
      if (!Array.isArray(findResult)) {
        for (const row of rows) {
          row[relatedModel.table] = findResult;
        }
        return;
      }

      relatedRows = findResult as Record<string, any>[];
    }

    // Group related rows by FK value
    const grouped = new Map<string, any[]>();
    for (const row of relatedRows) {
      const fkVal = String(row[fkCol]);
      if (!grouped.has(fkVal)) grouped.set(fkVal, []);
      grouped.get(fkVal)!.push(row);
    }

    // Strip FK if not requested
    const shouldStripFk =
      (hasColumnProjection &&
        !Object.keys(nestedClause.include ?? {})
          .map((k) => k.toLowerCase())
          .includes(fkCol)) ||
      hasExclude;

    // Attach to parent rows
    for (const row of rows) {
      const parentId = String(row[model.primaryKey]);
      const related = grouped.get(parentId) ?? [];
      const cleaned = shouldStripFk
        ? related.map((r) => {
            const c = { ...r };
            delete c[fkCol];
            return c;
          })
        : related;
      if (relationType === "ONE-TO-ONE") {
        row[relatedModel.table] = cleaned[0] ?? null;
      } else {
        row[relatedModel.table] = cleaned;
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
  const fkIds = [...new Set(rows.map((r) => r[fkCol]).filter(Boolean))];
  if (fkIds.length === 0) return;

  const relatedPk = relatedModel.primaryKey;

  try {
    const isAgg = !!(
      nestedClause.count ||
      nestedClause.sum ||
      nestedClause.avg ||
      nestedClause.min ||
      nestedClause.max
    );
    if (isAgg) {
      const aggParts: string[] = [`${q(relatedModel.table)}.${q(relatedPk)}`];
      if (nestedClause.count) aggParts.push(`COUNT(*) AS "count"`);
      if (nestedClause.sum)
        aggParts.push(
          `SUM(${q(relatedModel.table)}.${q(nestedClause.sum)}) AS "sum_${nestedClause.sum}"`,
        );
      if (nestedClause.avg)
        aggParts.push(
          `AVG(${q(relatedModel.table)}.${q(nestedClause.avg)}) AS "avg_${nestedClause.avg}"`,
        );
      if (nestedClause.min)
        aggParts.push(
          `MIN(${q(relatedModel.table)}.${q(nestedClause.min)}) AS "min_${nestedClause.min}"`,
        );
      if (nestedClause.max)
        aggParts.push(
          `MAX(${q(relatedModel.table)}.${q(nestedClause.max)}) AS "max_${nestedClause.max}"`,
        );

      const params: any[] = [fkIds];
      let sql = `SELECT ${aggParts.join(", ")} FROM ${q(relatedModel.table)} WHERE ${q(relatedPk)} = ANY($1)`;

      if (nestedClause.where) {
        const where = await resolveObject(nestedClause.where);
        const whereSQL = buildWhere(
          where,
          params,
          relatedModel.table,
          relatedModel.columns,
          relatedModel.table,
          nestedClause.mode,
        );
        if (whereSQL !== "TRUE") sql += ` AND ${whereSQL}`;
      }

      sql += ` GROUP BY ${q(relatedModel.table)}.${q(relatedPk)}`;

      const result = await client.query(sql, params);

      const aggMap = new Map<string, any>();
      for (const row of result.rows) {
        const pkVal = String(row[relatedPk]);
        const aggResult: Record<string, any> = {};
        if (nestedClause.count) aggResult.count = parseInt(row.count ?? "0");
        if (nestedClause.sum)
          aggResult.sum = {
            [nestedClause.sum]: parseFloat(
              row[`sum_${nestedClause.sum}`] ?? "0",
            ),
          };
        if (nestedClause.avg)
          aggResult.avg = {
            [nestedClause.avg]: parseFloat(
              row[`avg_${nestedClause.avg}`] ?? "0",
            ),
          };
        if (nestedClause.min)
          aggResult.min = {
            [nestedClause.min]: row[`min_${nestedClause.min}`],
          };
        if (nestedClause.max)
          aggResult.max = {
            [nestedClause.max]: row[`max_${nestedClause.max}`],
          };
        aggMap.set(pkVal, aggResult);
      }

      for (const row of rows) {
        const fkVal = row[fkCol];
        row[relatedModel.table] = fkVal
          ? (aggMap.get(String(fkVal)) ?? {})
          : {};
      }
      return;
    }

    const findResult = await runFind(
      client,
      relatedModel,
      nestedClause,
      debug,
      modelMap,
      { column: relatedPk, values: fkIds },
    );

    // If aggregation result — attach directly to all parent rows
    if (!Array.isArray(findResult)) {
      for (const row of rows) {
        row[relatedModel.table] = findResult;
      }
      return;
    }

    const relatedRows = findResult as Record<string, any>[];
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
  const parentIds = [
    ...new Set(rows.map((r) => r[model.primaryKey]).filter(Boolean)),
  ];
  if (parentIds.length === 0) return;

  const tables = [model.table, relatedModel.table].sort();
  const junctionTable = `${tables[0]}_${tables[1]}_junction`;
  const parentFk = `${model.table}_id`;
  const relatedFk = `${relatedModel.table}_id`;
  const relatedPk = relatedModel.primaryKey;

  try {
    const colProjection = buildSelectColumns(
      relatedModel.columns,
      nestedClause.include,
      nestedClause.exclude,
      relatedModel.table,
    );
    const isAllCols = colProjection === `"${relatedModel.table}".*`;
    // Always include PK for join
    const pkIncluded = isAllCols || colProjection.includes(`"${relatedPk}"`);
    const selectCols = pkIncluded
      ? colProjection
      : `${colProjection}, ${q(relatedModel.table)}.${q(relatedPk)}`;
    const sql = `
  SELECT ${selectCols}, ${q(junctionTable)}.${q(parentFk)}
  FROM ${q(relatedModel.table)}
  JOIN ${q(junctionTable)} ON ${q(relatedModel.table)}.${q(relatedPk)} = ${q(junctionTable)}.${q(relatedFk)}
  WHERE ${q(junctionTable)}.${q(parentFk)} = ANY($1)
`;

    const result = await client.query(sql, [parentIds]);
    const relatedRows = result.rows;

    const includedKeys = nestedClause.include
      ? Object.keys(nestedClause.include).map((k) => k.toLowerCase())
      : null;
    const shouldStripPk = includedKeys && !includedKeys.includes(relatedPk);

    const grouped = new Map<string, any[]>();
    for (const row of relatedRows) {
      const parentId = String(row[parentFk]);
      if (!grouped.has(parentId)) grouped.set(parentId, []);
      const clean = { ...row };
      delete clean[parentFk];
      if (shouldStripPk) delete clean[relatedPk];
      grouped.get(parentId)!.push(clean);
    }

    // Load nested relations first
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

    const excludedKeys = nestedClause.exclude
      ? Object.keys(nestedClause.exclude).map((k) => k.toLowerCase())
      : [];

    for (const row of rows) {
      const parentId = String(row[model.primaryKey]);
      let related = grouped.get(parentId) ?? [];
      if (excludedKeys.length > 0) {
        related = related.map((r) => {
          const c = { ...r };
          for (const key of excludedKeys) delete c[key];
          return c;
        });
      }
      row[relatedModel.table] = related;
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
  const results = rows;

  // Validate all include keys first before loading
  const validatedEntries: Array<{
    key: string;
    value: any;
    relation: any;
    relatedModel: any;
    relationType: string;
    isIncoming: boolean;
    nestedClause: any;
  }> = [];

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

    if (!relation) {
      throw new MormError(
        {
          code: "MORM_INVALID_COLUMN",
          message: `"include.${key}" is not a column or relation on table "${model.table}"`,
          column: key,
        },
        "find",
        model.table,
      );
    }

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

    validatedEntries.push({
      key,
      value,
      relation,
      relatedModel,
      relationType,
      isIncoming,
      nestedClause,
    });
  }

  // Load all relations at this level IN PARALLEL
  await Promise.all(
    validatedEntries.map(
      ({ relationType, isIncoming, relation, relatedModel, nestedClause }) => {
        if (relationType === "MANY-TO-MANY") {
          return loadManyToMany(
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
          return loadIncoming(
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
          return loadOutgoing(
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
      },
    ),
  );

  return results;
}
