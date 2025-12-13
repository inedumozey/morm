// buildWhere.ts
export type WhereResult = {
  sql: string;
  params: any[];
  nextIndex: number;
};

type BuildWhereOpts = {
  defaultCaseSensitive?: boolean;
  fieldCase?: Record<string, boolean>;
};

// Helper for quoting column names
function colName(name: string) {
  return `"${name}"`;
}

export function buildWhere(
  where: any,
  params: any[] = [],
  paramIndex = 1,
  opts?: BuildWhereOpts
): WhereResult {
  if (!where || Object.keys(where).length === 0) {
    return { sql: "", params, nextIndex: paramIndex };
  }

  const conditions: string[] = [];

  for (const rawKey of Object.keys(where)) {
    const key = rawKey;
    const value = where[key];

    // Logical arrays
    if ((key === "AND" || key === "OR") && Array.isArray(value)) {
      const parts: string[] = [];
      let lastIndex = paramIndex;
      let aggregatedParams: any[] = [];
      for (const sub of value) {
        const r = buildWhere(
          sub,
          params.concat(aggregatedParams),
          lastIndex,
          opts
        );
        if (r.sql) {
          parts.push(r.sql);
          aggregatedParams = aggregatedParams.concat(r.params);
          lastIndex = r.nextIndex;
        }
      }
      if (parts.length) {
        conditions.push(`(${parts.join(` ${key} `)})`);
        params = params.concat(aggregatedParams);
        paramIndex = lastIndex;
      }
      continue;
    }

    // NOT
    if (key === "NOT" && value) {
      const r = buildWhere(value, params, paramIndex, opts);
      if (r.sql) {
        conditions.push(`NOT (${r.sql})`);
        params = params.concat(r.params);
        paramIndex = r.nextIndex;
      }
      continue;
    }

    // Relation filters (some/every/none)
    if (
      typeof value === "object" &&
      value !== null &&
      ("some" in value || "every" in value || "none" in value)
    ) {
      // value is RelationFilter, key is relation table/alias
      // We'll transform: EXISTS (SELECT 1 FROM relTable WHERE rel.foreign = parent.local AND <subSql>)
      if (value.some) {
        const r = buildWhere(value.some, params, paramIndex, opts);
        if (r.sql) {
          conditions.push(`EXISTS (SELECT 1 FROM "${key}" WHERE ${r.sql})`);
          params = params.concat(r.params);
          paramIndex = r.nextIndex;
        }
      }
      if (value.every) {
        const r = buildWhere(value.every, params, paramIndex, opts);
        if (r.sql) {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM "${key}" WHERE NOT (${r.sql}))`
          );
          params = params.concat(r.params);
          paramIndex = r.nextIndex;
        }
      }
      if (value.none) {
        const r = buildWhere(value.none, params, paramIndex, opts);
        if (r.sql) {
          conditions.push(`NOT EXISTS (SELECT 1 FROM "${key}" WHERE ${r.sql})`);
          params = params.concat(r.params);
          paramIndex = r.nextIndex;
        }
      }
      continue;
    }

    // Field operator objects
    if (typeof value === "object" && value !== null) {
      const opMap: Record<string, string> = {
        equals: "=",
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
        in: "IN",
        notIn: "NOT IN",
      };

      for (const op of Object.keys(value)) {
        const v = value[op];
        let sqlPart = "";

        // Determine case sensitivity for this field
        const fieldCase = opts?.fieldCase?.[key];
        const globalCase = opts?.defaultCaseSensitive ?? false;
        const caseSensitive = fieldCase ?? globalCase;

        switch (op) {
          case "contains": {
            if (caseSensitive) {
              sqlPart = `${colName(key)} LIKE $${paramIndex}`;
            } else {
              sqlPart = `${colName(key)} ILIKE $${paramIndex}`;
            }
            params.push(`%${v}%`);
            break;
          }
          case "startsWith": {
            if (caseSensitive) {
              sqlPart = `${colName(key)} LIKE $${paramIndex}`;
            } else {
              sqlPart = `${colName(key)} ILIKE $${paramIndex}`;
            }
            params.push(`${v}%`);
            break;
          }
          case "endsWith": {
            if (caseSensitive) {
              sqlPart = `${colName(key)} LIKE $${paramIndex}`;
            } else {
              sqlPart = `${colName(key)} ILIKE $${paramIndex}`;
            }
            params.push(`%${v}`);
            break;
          }
          case "in":
          case "notIn": {
            if (!Array.isArray(v) || v.length === 0) continue;
            sqlPart = `${colName(key)} ${opMap[op]} (${v
              .map((_: any, i: number) => `$${paramIndex + i}`)
              .join(", ")})`;
            params.push(...v);
            paramIndex += v.length - 1;
            break;
          }
          default: {
            // equals, gt, lt, etc.
            const sqlOp = opMap[op] ?? "=";
            sqlPart = `${colName(key)} ${sqlOp} $${paramIndex}`;
            params.push(v);
            break;
          }
        }

        if (sqlPart) conditions.push(sqlPart);
        paramIndex++;
      }
      continue;
    }

    // Simple equality
    conditions.push(`${colName(key)} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  return { sql: conditions.join(" AND "), params, nextIndex: paramIndex };
}
