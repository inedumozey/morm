// model.ts
import { DB } from "../morm/morm.js";
import { buildWhere, WhereResult } from "./buildWhere.js";

type ColumnDef = {
  name: string;
  type: string; // e.g. TEXT, UUID, INT, TEXT[], etc.
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  default?: any;
  reference?: {
    table: string;
    column: string;
    onDelete?: string;
    onUpdate?: string;
  };
  trim?: boolean;
  toUpperCase?: boolean;
  toLowerCase?: boolean;
  sanitize?: boolean;
  through?: string; // for MANY_TO_MANY shorthand (optional)
};

export type Schema = {
  table: string;
  columns: ColumnDef[];
};

type RelationKind =
  | "one-to-many"
  | "one-to-one"
  | "many-to-many"
  | "belongs-to";

type RelationMeta = {
  name: string; // relation name (derived)
  kind: RelationKind;
  localKey: string; // column on source model (for belongs-to it's fk)
  targetTable: string;
  targetKey: string;
  through?: string; // pivot table for many-to-many
  // pivot naming
  pivotSource?: string;
  pivotTarget?: string;
  // reference to instantiated Model class (set externally after all models created)
  model?: Model;
};

export interface FindOptions {
  where?: any;
  select?: Record<string, boolean>;
  omit?: Record<string, boolean>;
  include?: Record<string, any>;
  orderBy?: Record<string, "asc" | "desc">;
  skip?: number;
  limit?: number;
  caseSensitive?: boolean;
  withDeleted?: boolean; // for soft delete
}

export class Model {
  static db!: DB;
  static transform = {
    trim: true,
    sanitize: true,
    toLowerCase: false,
    toUpperCase: false,
  };
  static logging = false;

  table: string;
  columns: ColumnDef[];
  relations: Record<string, RelationMeta> = {};
  primaryKey: string = "id";
  arrayColumns: Set<string> = new Set();

  constructor(public schema: Schema) {
    this.table = schema.table;
    this.columns = schema.columns.slice();

    // detect primaryKey and arrays
    const pk = this.columns.find((c) => c.primary);
    if (pk) this.primaryKey = pk.name;

    for (const c of this.columns) {
      if (c.type && c.type.endsWith("[]")) this.arrayColumns.add(c.name);
    }

    // ensure created_at/updated_at exist in column definitions if not provided (DB default exists)
    if (!this.columns.find((c) => c.name === "created_at")) {
      this.columns.push({
        name: "created_at",
        type: "TIMESTAMP WITH TIME ZONE",
        notNull: true,
        default: "now()",
      });
    }
    if (!this.columns.find((c) => c.name === "updated_at")) {
      this.columns.push({
        name: "updated_at",
        type: "TIMESTAMP WITH TIME ZONE",
        notNull: true,
        default: "now()",
      });
    }

    // parse reference columns to build relations map (auto)
    this.parseRelations();
  }

  static setDB(db: DB) {
    Model.db = db;
  }

  static enableLogging(on = true) {
    Model.logging = on;
  }

  private parseRelations() {
    // For each column with reference: register belongs-to and reverse relation
    for (const col of this.columns) {
      if (col.reference) {
        const relName = this.inferRelationNameFromColumn(
          col.name,
          col.reference.table
        );
        const targetTable = col.reference.table;
        const targetKey = col.reference.column;
        const localKey = col.name;

        // belongsTo relation (this → target)
        this.relations[relName] = {
          name: relName,
          kind: "belongs-to",
          localKey,
          targetTable,
          targetKey,
          model: undefined,
        };
      }
    }
  }

  // Generate relation name from column: user_id → user, author → author
  private inferRelationNameFromColumn(column: string, targetTable?: string) {
    if (column.endsWith("_id")) {
      return column.replace(/_id$/, "");
    }
    // fallback: if column name equals target table singular/plural heuristics:
    if (targetTable) {
      // if column equals targetTable, return targetTable
      if (column === targetTable) return column;
      // otherwise return column
    }
    return column;
  }

  // Called after all models are created so model references can be resolved
  // registry: Record<tableName, Model>
  resolveRelations(registry: Record<string, Model>) {
    // For each relation meta: set model and compute reverse relations, many-to-many detection
    for (const key of Object.keys(this.relations)) {
      const meta = this.relations[key];
      const target = registry[meta.targetTable];
      if (!target) continue;
      meta.model = target;

      // create a reverse relation on target
      const reverseName = this.table; // e.g., users → posts: reverse 'posts'
      // Determine reverse kind: if this.localKey references target.pk and local col not unique: one-to-many
      const localCol = this.columns.find((c) => c.name === meta.localKey);
      const targetColDef = target.columns.find(
        (c) => c.name === meta.targetKey
      );
      const isUnique = !!(localCol && localCol.unique);
      const reverseKind: RelationKind = isUnique ? "one-to-one" : "one-to-many";

      // add reverse if not exists
      if (!target.relations[reverseName]) {
        target.relations[reverseName] = {
          name: reverseName,
          kind: reverseKind,
          localKey: meta.targetKey, // key on target
          targetTable: this.table,
          targetKey: meta.localKey,
          model: this,
        };
      }
    }

    // Detect many-to-many: a table that is just a pivot (has two FKs and no other meaningful columns)
    // For simplicity: pivot table detection is done lazily when querying or when schema indicates MANY_TO_MANY
    // If a column explicitly has type "MANY_TO_MANY" and reference, we'll treat it as such.
    for (const col of this.columns) {
      if (
        col.type &&
        col.type.toUpperCase() === "MANY_TO_MANY" &&
        col.reference
      ) {
        const relName = col.name;
        const targetTable = col.reference.table;
        const through = col.through; // optional override
        this.relations[relName] = {
          name: relName,
          kind: "many-to-many",
          localKey: this.primaryKey,
          targetTable,
          targetKey: col.reference.column,
          through,
          pivotSource: "source_id",
          pivotTarget: "target_id",
        };
      }
    }
  }

  private log(sql: string, params?: any[]) {
    if ((this.constructor as typeof Model).logging) {
      // eslint-disable-next-line no-console
      console.log("[SQL]", sql, params ?? []);
    }
  }

  // sanitization helper
  private sanitizeString(v: string) {
    let out = v.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
    out = out.replace(/\son\w+=(["'])(.*?)\1/gi, "");
    out = out.replace(/javascript:/gi, "");
    out = out.replace(/<\/?(img|iframe|svg|embed|object)[^>]*>/gi, "");
    out = out.replace(/[<>]/g, "");
    return out;
  }

  // apply transforms: inline override (value could be {data, trim, toLowerCase...}) > column def > Model.transform
  private applyTransforms(column: ColumnDef | undefined, raw: any) {
    if (raw === null || raw === undefined) return raw;

    // inline config
    if (typeof raw === "object" && "data" in raw) {
      let val = raw.data;
      if (typeof val === "string") {
        if (raw.trim) val = val.trim();
        if (raw.sanitize) val = this.sanitizeString(val);
        if (raw.toUpperCase) val = val.toUpperCase();
        if (raw.toLowerCase) val = val.toLowerCase();
      }
      return val;
    }

    // normal path
    let v = raw;
    const G = (this.constructor as typeof Model).transform;
    if (typeof v === "string") {
      if (column?.trim ?? G.trim) v = v.trim();
      if (column?.sanitize ?? G.sanitize) v = this.sanitizeString(v);
      if (column?.toUpperCase ?? G.toUpperCase) v = v.toUpperCase();
      if (column?.toLowerCase ?? G.toLowerCase) v = v.toLowerCase();
    }
    return v;
  }

  // ----------------- CREATE (single) -----------------
  async create(opts: { data?: any; txClient?: any } | any): Promise<any> {
    const input = opts && opts.data !== undefined ? opts.data : opts;
    const txClient = opts && opts.txClient ? opts.txClient : undefined;
    const client = txClient ?? Model.db;

    // split normal fields and relation/array ops
    const normal: Record<string, any> = {};
    const arrayOps: Record<string, any> = {}; // push/pull
    const relationOps: Record<string, any> = {}; // many-to-many or nested creates

    for (const key of Object.keys(input)) {
      const colDef = this.columns.find((c) => c.name === key);
      const relMeta = this.relations[key];

      if (colDef && colDef.type && colDef.type.endsWith("[]")) {
        // array column
        const val = input[key];
        if (
          val &&
          typeof val === "object" &&
          ("push" in val || "pull" in val)
        ) {
          arrayOps[key] = val;
        } else {
          // full set assignment
          normal[key] = this.applyTransforms(colDef, val);
        }
        continue;
      }

      if (relMeta && relMeta.kind === "many-to-many") {
        relationOps[key] = input[key];
        continue;
      }

      // nested create for one-to-many and one-to-one
      if (
        relMeta &&
        (relMeta.kind === "one-to-many" ||
          relMeta.kind === "one-to-one" ||
          relMeta.kind === "belongs-to")
      ) {
        relationOps[key] = input[key];
        continue;
      }

      // normal column
      if (colDef) {
        normal[key] = this.applyTransforms(colDef, input[key]);
      } else {
        // unknown column: allow as-is
        normal[key] = input[key];
      }
    }

    // ensure timestamps: default handled by DB if not provided
    // build SQL
    const keys = Object.keys(normal);
    const values = keys.map((k) => normal[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO "${this.table}" (${keys
      .map((k) => `"${k}"`)
      .join(", ")}) VALUES (${placeholders}) RETURNING *`;

    this.log(sql, values);
    const res = txClient
      ? await txClient.query(sql, values)
      : await (client as DB).query(sql, values);
    const row = res.rows[0];

    // handle arrays push/pull: operate after insert using pk
    if (Object.keys(arrayOps).length) {
      for (const colName of Object.keys(arrayOps)) {
        const op = arrayOps[colName];
        if (op.push)
          await this.arrayPushByPk(
            row[this.primaryKey],
            colName,
            op.push,
            txClient
          );
        if (op.pull)
          await this.arrayPullByPk(
            row[this.primaryKey],
            colName,
            op.pull,
            txClient
          );
      }
    }

    // handle relationOps
    if (Object.keys(relationOps).length) {
      for (const relKey of Object.keys(relationOps)) {
        const relVal = relationOps[relKey];
        const meta = this.relations[relKey];

        // many-to-many: accept array of ids or array of objects {id}
        if (meta && meta.kind === "many-to-many") {
          const ids = Array.isArray(relVal)
            ? relVal
            : relVal && relVal.push
            ? Array.isArray(relVal.push)
              ? relVal.push
              : [relVal.push]
            : [];
          if (ids.length) {
            await this.insertPivotRows(
              row[this.primaryKey],
              meta,
              ids,
              txClient
            );
          }
          continue;
        }

        // one-to-many (nested create array)
        if (meta && meta.kind === "one-to-many" && Array.isArray(relVal)) {
          for (const child of relVal) {
            const childRow = { ...(child as any) };
            childRow[meta.targetKey] = row[meta.localKey]; // set FK on child
            // call child's model create - resolve model reference first
            if (!meta.model) continue;
            await meta.model.create({ data: childRow, txClient });
          }
          continue;
        }

        // one-to-one nested
        if (meta && meta.kind === "one-to-one" && typeof relVal === "object") {
          const childRow = { ...(relVal as any) };
          childRow[meta.targetKey] = row[meta.localKey];
          if (!meta.model) continue;
          await meta.model.create({ data: childRow, txClient });
          continue;
        }

        // belongs-to nested create (creating referenced row)
        if (meta && meta.kind === "belongs-to" && typeof relVal === "object") {
          // create target row first, then update this row fk
          if (!meta.model) continue;
          const created = await meta.model.create({ data: relVal, txClient });
          // update fk on this table
          const updSql = `UPDATE "${this.table}" SET "${meta.localKey}" = $1 WHERE "${this.primaryKey}" = $2 RETURNING *`;
          const ures = txClient
            ? await txClient.query(updSql, [
                created[meta.targetKey],
                row[this.primaryKey],
              ])
            : await (client as DB).query(updSql, [
                created[meta.targetKey],
                row[this.primaryKey],
              ]);
          // update row variable
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          Object.assign(row, ures.rows[0]);
          continue;
        }
      }
    }

    return row;
  }

  // ---------------- createMany (bulk) ----------------
  async createMany(
    opts: { data: any[]; txClient?: any } | any[]
  ): Promise<any[]> {
    const input = Array.isArray(opts) ? opts : opts.data;
    const txClient = Array.isArray(opts)
      ? undefined
      : opts.txClient ?? undefined;
    if (!input || input.length === 0) return [];

    // Approach: insert normal columns in bulk, then process per-row array/pivot ops.
    // All rows must share the same keys for bulk insert. We'll derive keys from first item (normal fields only).
    const normalRows: any[] = [];
    const relationOpsList: any[] = [];

    for (const item of input) {
      const normal: Record<string, any> = {};
      const relOps: Record<string, any> = {};
      for (const key of Object.keys(item)) {
        const colDef = this.columns.find((c) => c.name === key);
        const relMeta = this.relations[key];
        if (colDef && colDef.type && colDef.type.endsWith("[]")) {
          // for createMany, we only support full array assignment, not push/pull
          normal[key] = this.applyTransforms(colDef, item[key]);
          continue;
        }
        if (relMeta && relMeta.kind === "many-to-many") {
          relOps[key] = item[key];
          continue;
        }
        if (
          relMeta &&
          (relMeta.kind === "one-to-many" ||
            relMeta.kind === "one-to-one" ||
            relMeta.kind === "belongs-to")
        ) {
          relOps[key] = item[key];
          continue;
        }
        if (colDef) normal[key] = this.applyTransforms(colDef, item[key]);
        else normal[key] = item[key];
      }
      normalRows.push(normal);
      relationOpsList.push(relOps);
    }

    // Bulk insert
    const keys = Object.keys(normalRows[0] || {});
    const placeholdersRows = normalRows
      .map(
        (_, r) =>
          `(${keys.map((__, c) => `$${r * keys.length + c + 1}`).join(",")})`
      )
      .join(", ");
    const params = normalRows.flatMap((r) => keys.map((k) => r[k]));
    const sql = `INSERT INTO "${this.table}" (${keys
      .map((k) => `"${k}"`)
      .join(", ")}) VALUES ${placeholdersRows} RETURNING *`;
    this.log(sql, params);
    const res = txClient
      ? await txClient.query(sql, params)
      : await Model.db.query(sql, params);
    const createdRows = res.rows;

    // handle per-row relations and arrays
    for (let i = 0; i < createdRows.length; i++) {
      const row = createdRows[i];
      const relOps = relationOpsList[i];
      if (!relOps) continue;
      for (const relKey of Object.keys(relOps)) {
        const val = relOps[relKey];
        const meta = this.relations[relKey];

        if (meta && meta.kind === "many-to-many") {
          const ids = Array.isArray(val)
            ? val
            : val && val.push
            ? Array.isArray(val.push)
              ? val.push
              : [val.push]
            : [];
          if (ids.length)
            await this.insertPivotRows(
              row[this.primaryKey],
              meta,
              ids,
              txClient
            );
          continue;
        }

        if (meta && meta.kind === "one-to-many" && Array.isArray(val)) {
          for (const child of val) {
            const childRow = { ...(child as any) };
            childRow[meta.targetKey] = row[meta.localKey];
            if (!meta.model) continue;
            await meta.model.create({ data: childRow, txClient });
          }
          continue;
        }

        if (meta && meta.kind === "one-to-one" && typeof val === "object") {
          const childRow = { ...(val as any) };
          childRow[meta.targetKey] = row[meta.localKey];
          if (!meta.model) continue;
          await meta.model.create({ data: childRow, txClient });
          continue;
        }
      }
    }

    return createdRows;
  }

  // ----------------- FIND (findMany) -----------------
  async findMany(options: FindOptions = {}): Promise<any[]> {
    const {
      where,
      select,
      omit,
      include,
      orderBy,
      skip,
      limit,
      caseSensitive,
      withDeleted,
    } = options;
    const params: any[] = [];
    let sqlSelect = "";
    if (select && Object.keys(select).length > 0) {
      const cols = Object.entries(select)
        .filter(([, v]) => v)
        .map(([k]) => `"${k}"`)
        .join(", ");
      sqlSelect = cols || "*";
    } else if (omit && Object.keys(omit).length > 0) {
      const cols = this.columns
        .filter((c) => !(omit as any)[c.name])
        .map((c) => `"${c.name}"`);
      sqlSelect = cols.join(", ");
    } else {
      sqlSelect = "*";
    }

    let sql = `SELECT ${sqlSelect} FROM "${this.table}"`;

    // soft delete default: hide deleted rows unless withDeleted = true
    const whereWrapper: any = { ...(where || {}) };
    if (!withDeleted) {
      // if table has deleted_at column use it else ignore
      if (this.columns.find((c) => c.name === "deleted_at")) {
        // ensure we append condition to existing where (AND)
        if (!whereWrapper || Object.keys(whereWrapper).length === 0) {
          // nothing
        }
        // we'll let buildWhere handle composition later by wrapping under AND
      }
    }

    // build where with options for case-sensitivity
    const opts = {
      defaultCaseSensitive: !!caseSensitive,
      fieldCase: undefined as Record<string, boolean> | undefined,
    };

    if (where && Object.keys(where).length) {
      const r = buildWhere(where, params, 1, opts);
      if (r.sql) {
        sql += ` WHERE ${r.sql}`;
        params.push(...r.params);
      }
    }

    if (orderBy && Object.keys(orderBy).length) {
      const parts = Object.entries(orderBy).map(
        ([c, d]) => `"${c}" ${d.toUpperCase()}`
      );
      sql += ` ORDER BY ${parts.join(", ")}`;
    }

    if (limit) sql += ` LIMIT ${limit}`;
    if (skip) sql += ` OFFSET ${skip}`;

    this.log(sql, params);
    const res = await Model.db.query(sql, params);
    let rows = res.rows;

    // handle includes recursively
    if (include && Object.keys(include).length) {
      for (const relKey of Object.keys(include)) {
        const relMeta = this.relations[relKey];
        const relInclude = include[relKey];
        if (!relMeta) continue;

        // two cases: belongs-to is stored on this table (fk present) OR reverse is on other table
        if (relMeta.kind === "belongs-to") {
          // e.g., posts.user → posts has user_id
          for (const r of rows) {
            const fk = r[relMeta.localKey];
            if (fk == null) {
              r[relKey] = null;
              continue;
            }
            // find unique on target
            if (relMeta.model) {
              const sub = await relMeta.model.findUnique({
                where: { [relMeta.targetKey]: fk },
              } as any);
              r[relKey] = sub;
            } else {
              r[relKey] = null;
            }
          }
          continue;
        }

        if (relMeta.kind === "one-to-many") {
          // e.g., user.posts → posts table has foreign key to users
          // use localKey value from this row to query target table
          for (const r of rows) {
            const localVal = r[relMeta.localKey];
            if (localVal == null) {
              r[relKey] = [];
              continue;
            }
            if (!relMeta.model) {
              r[relKey] = [];
              continue;
            }
            const subRows = await relMeta.model.findMany({
              where: { [relMeta.targetKey]: localVal },
              ...(typeof relInclude === "object" ? relInclude : {}),
            } as any);
            r[relKey] = subRows;
          }
          continue;
        }

        if (relMeta.kind === "one-to-one") {
          for (const r of rows) {
            const localVal = r[relMeta.localKey];
            if (localVal == null) {
              r[relKey] = null;
              continue;
            }
            if (!relMeta.model) {
              r[relKey] = null;
              continue;
            }
            const sub = await relMeta.model.findUnique({
              where: { [relMeta.targetKey]: localVal },
            } as any);
            r[relKey] = sub;
          }
          continue;
        }

        if (relMeta.kind === "many-to-many") {
          // Query pivot table then fetch targets
          for (const r of rows) {
            const id = r[this.primaryKey];
            if (id == null) {
              r[relKey] = [];
              continue;
            }
            const pivot =
              relMeta.through ||
              this.generatePivotName(this.table, relMeta.targetTable);
            const sourceCol = relMeta.pivotSource || "source_id";
            const targetCol = relMeta.pivotTarget || "target_id";
            const q = `SELECT "${targetCol}" as tid FROM "${pivot}" WHERE "${sourceCol}" = $1`;
            const pv = await Model.db.query(q, [id]);
            const ids = pv.rows.map((x: any) => x.tid);
            if (!ids.length) {
              r[relKey] = [];
              continue;
            }
            // fetch targets in bulk
            if (!relMeta.model) {
              r[relKey] = [];
              continue;
            }
            const targets = await relMeta.model.findMany({
              where: { [relMeta.targetKey]: { in: ids } },
              ...(typeof relInclude === "object" ? relInclude : {}),
            } as any);
            r[relKey] = targets;
          }
          continue;
        }
      }
    }

    return rows;
  }

  async find(options: FindOptions = {}) {
    return this.findMany(options);
  }

  // -------------- findUnique (only unique keys allowed)
  async findUnique(options: { where: any; select?: any; include?: any }) {
    // We intentionally accept only keys that are unique in schema
    const where = options.where;
    if (!where || Object.keys(where).length === 0)
      throw new Error("findUnique requires a where with unique properties");
    // naive check: if provided key matches any column marked unique or primary
    for (const k of Object.keys(where)) {
      const col = this.columns.find((c) => c.name === k);
      if (!col || (!col.unique && !col.primary)) {
        throw new Error(
          `findUnique only accepts unique/primary key fields. "${k}" is not unique`
        );
      }
    }
    const rows = await this.findMany({
      where,
      limit: 1,
      select: options.select,
      include: options.include,
    } as any);
    return rows[0] ?? null;
  }

  // ----------------- UPDATE (updateMany) -----------------
  // opts: { where?, data, relationMode?: 'replace'|'append', txClient }
  async update(opts: {
    where?: any;
    data: any;
    relationMode?: "replace" | "append";
    txClient?: any;
  }) {
    const where = opts.where ?? {};
    const data = opts.data ?? {};
    const relationMode = opts.relationMode ?? "replace";
    const txClient = opts.txClient;
    const client = txClient ?? Model.db;

    // build WHERE
    const whereRes = buildWhere(where, [], 1, {});
    const whereSql = whereRes.sql || "TRUE";
    const whereParams = whereRes.params;

    // split data into scalar updates and array/relation ops
    const scalar: Record<string, any> = {};
    const arrayOps: Record<string, any> = {};
    const relationOps: Record<string, any> = {};

    for (const key of Object.keys(data)) {
      const colDef = this.columns.find((c) => c.name === key);
      const relMeta = this.relations[key];
      const val = data[key];

      if (colDef && colDef.type && colDef.type.endsWith("[]")) {
        if (
          val &&
          typeof val === "object" &&
          ("push" in val || "pull" in val)
        ) {
          arrayOps[key] = val;
        } else {
          scalar[key] = this.applyTransforms(colDef, val);
        }
        continue;
      }

      if (relMeta && relMeta.kind === "many-to-many") {
        relationOps[key] = val;
        continue;
      }

      // nested create/update for one-to-many etc - treat as relationOps
      if (
        relMeta &&
        (relMeta.kind === "one-to-many" ||
          relMeta.kind === "one-to-one" ||
          relMeta.kind === "belongs-to")
      ) {
        relationOps[key] = val;
        continue;
      }

      // normal scalar
      const cdef = this.columns.find((c) => c.name === key);
      scalar[key] = this.applyTransforms(cdef, val);
    }

    // If there are scalar keys, perform update RETURNING *
    let updatedRows: any[] = [];
    if (Object.keys(scalar).length > 0) {
      const setKeys = Object.keys(scalar);
      const setParams = Object.values(scalar);
      const setSql = setKeys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
      const sql = `UPDATE "${this.table}" SET ${setSql} WHERE ${whereSql} RETURNING *`;
      const params = [...setParams, ...whereParams];
      this.log(sql, params);
      const res = txClient
        ? await txClient.query(sql, params)
        : await Model.db.query(sql, params);
      updatedRows = res.rows;
    } else {
      // fetch rows matching where to apply non-scalar ops
      const selSql = `SELECT * FROM "${this.table}" WHERE ${whereSql}`;
      this.log(selSql, whereParams);
      const sel = txClient
        ? await txClient.query(selSql, whereParams)
        : await Model.db.query(selSql, whereParams);
      updatedRows = sel.rows;
    }

    // Now apply arrayOps and relationOps row by row
    const finalRows: any[] = [];
    for (const row of updatedRows) {
      // arrays
      for (const ak of Object.keys(arrayOps)) {
        const op = arrayOps[ak];
        if (op.push)
          await this.arrayPushByPk(row[this.primaryKey], ak, op.push, txClient);
        if (op.pull)
          await this.arrayPullByPk(row[this.primaryKey], ak, op.pull, txClient);
      }

      // relations
      for (const rk of Object.keys(relationOps)) {
        const val = relationOps[rk];
        const meta = this.relations[rk];
        if (!meta) continue;

        if (meta.kind === "many-to-many") {
          const ids = Array.isArray(val)
            ? val
            : val && val.push
            ? Array.isArray(val.push)
              ? val.push
              : [val.push]
            : [];
          const pivot =
            meta.through ||
            this.generatePivotName(this.table, meta.targetTable);
          // delete existing if replace
          if (relationMode !== "append") {
            const delSql = `DELETE FROM "${pivot}" WHERE "${
              meta.pivotSource || "source_id"
            }" = $1`;
            this.log(delSql, [row[this.primaryKey]]);
            if (txClient) await txClient.query(delSql, [row[this.primaryKey]]);
            else await Model.db.query(delSql, [row[this.primaryKey]]);
          }
          if (ids.length)
            await this.insertPivotRows(
              row[this.primaryKey],
              meta,
              ids,
              txClient
            );
        }

        // TODO: nested create/update for one-to-many, one-to-one when necessary
      }

      // re-fetch row to reflect modifications
      const fetchSql = `SELECT * FROM "${this.table}" WHERE "${this.primaryKey}" = $1`;
      const f = txClient
        ? await txClient.query(fetchSql, [row[this.primaryKey]])
        : await Model.db.query(fetchSql, [row[this.primaryKey]]);
      finalRows.push(f.rows[0]);
    }

    return finalRows;
  }

  // updateUnique: requires unique properties in where
  async updateUnique(opts: { where: any; data: any; txClient?: any }) {
    const where = opts.where;
    if (!where || Object.keys(where).length === 0)
      throw new Error("updateUnique requires a where with unique property");
    // validate unique columns
    for (const k of Object.keys(where)) {
      const col = this.columns.find((c) => c.name === k);
      if (!col || (!col.unique && !col.primary)) {
        throw new Error(
          `updateUnique only accepts unique/primary keys. "${k}" is not unique`
        );
      }
    }
    const rows = await this.update({
      where,
      data: opts.data,
      txClient: opts.txClient,
    });
    return rows[0] ?? null;
  }

  // ----------------- DELETE -----------------
  async delete(opts: { where?: any; txClient?: any } | any) {
    const where = opts && opts.where ? opts.where : opts ?? {};
    const txClient = opts && (opts.txClient ?? undefined);
    const whereRes = buildWhere(where, [], 1, {});
    const sql = `DELETE FROM "${this.table}" WHERE ${whereRes.sql}`;
    this.log(sql, whereRes.params);
    const res = txClient
      ? await txClient.query(sql, whereRes.params)
      : await Model.db.query(sql, whereRes.params);
    return res.rowCount;
  }

  // deleteUnique: return count
  async deleteUnique(opts: { where: any; txClient?: any }) {
    const where = opts.where;
    if (!where || Object.keys(where).length === 0)
      throw new Error("deleteUnique requires where with unique property");
    for (const k of Object.keys(where)) {
      const col = this.columns.find((c) => c.name === k);
      if (!col || (!col.unique && !col.primary))
        throw new Error(
          `deleteUnique only accepts unique/primary keys. "${k}" is not unique`
        );
    }
    const n = await this.delete({ where, txClient: opts.txClient });
    return n;
  }

  // ---------------- Array helpers by PK ----------------
  private async arrayPushByPk(
    pk: any,
    column: string,
    toPush: any | any[],
    txClient?: any
  ) {
    const vals = Array.isArray(toPush) ? toPush : [toPush];
    const sql = `UPDATE "${this.table}" SET "${column}" = COALESCE("${column}", '{}') || $1::text[] WHERE "${this.primaryKey}" = $2 RETURNING *`;
    this.log(sql, [vals, pk]);
    const res = txClient
      ? await txClient.query(sql, [vals, pk])
      : await Model.db.query(sql, [vals, pk]);
    return res.rows;
  }

  private async arrayPullByPk(
    pk: any,
    column: string,
    toPull: any | any[],
    txClient?: any
  ) {
    const vals = Array.isArray(toPull) ? toPull : [toPull];
    const sql = `UPDATE "${this.table}" SET "${column}" = (SELECT COALESCE(ARRAY(SELECT unnest("${column}") EXCEPT SELECT unnest($1::text[])), '{}')) WHERE "${this.primaryKey}" = $2 RETURNING *`;
    this.log(sql, [vals, pk]);
    const res = txClient
      ? await txClient.query(sql, [vals, pk])
      : await Model.db.query(sql, [vals, pk]);
    return res.rows;
  }

  // ---------------- pivot helpers ----------------
  private generatePivotName(a: string, b: string) {
    // alphabetical order for stable pivot names
    const parts = [a, b].sort();
    return `${parts[0]}_${parts[1]}`;
  }

  private async insertPivotRows(
    sourcePk: any,
    meta: RelationMeta,
    ids: any[],
    txClient?: any
  ) {
    if (!ids || ids.length === 0) return;
    const pivot =
      meta.through || this.generatePivotName(this.table, meta.targetTable);
    const sourceCol = meta.pivotSource || "source_id";
    const targetCol = meta.pivotTarget || "target_id";

    // build param list for multi insert
    const rowsSql = ids
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      .join(", ");
    const params: any[] = [];
    for (const id of ids) {
      params.push(sourcePk, id);
    }

    const sql = `INSERT INTO "${pivot}" ("${sourceCol}", "${targetCol}") VALUES ${rowsSql} ON CONFLICT DO NOTHING`;
    this.log(sql, params);
    if (txClient) return txClient.query(sql, params);
    return Model.db.query(sql, params);
  }
}
