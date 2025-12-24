// morm.ts

import { Pool } from "pg";

import { createModelRuntime } from "./model.js";
import { colors } from "./utils/logColors.js";
import { validateAndSortModels } from "./utils/relationValidator.js";
import { buildJunctionTables } from "./utils/junctionBuilder.js";
import type { ColumnDefinition } from "./model-types.js";
import { EnumRegistry, migrateEnumsGlobal } from "./migrations/enumRegistry.js";
import { resetDatabase } from "./migrations/resetDatabase.js";

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
}

export interface MormOptions {
  allowSSL?: boolean;
  transaction?: TransactionOptions;
}

export class Morm {
  private pool!: InstanceType<typeof Pool>;
  private url!: URL;
  private options?: MormOptions | undefined;
  private models: any[] = [];
  private _migrating: boolean = false;
  private enumRegistry = new EnumRegistry();

  /** --------------------------------------------------
   * Instance cache: ensures one Morm per URL
   * -------------------------------------------------- */
  private static instances: Map<string, Morm> = new Map();
  private constructor() {}

  /** --------------------------------------------------
   * MAIN ENTRY:
   * Initiate Morm instance from database url.
   * Will create the database automatically if missing.
   * -------------------------------------------------- */
  static async init(
    connectionString: string,
    options?: MormOptions,
    callback?: (error: Error | null, message?: string) => void
  ): Promise<Morm | null> {
    // -------- Instance Caching --------
    if (this.instances.has(connectionString)) {
      const inst = this.instances.get(connectionString)!;
      if (callback) callback(null, "Connection successful (from cache).");
      return inst;
    }

    // New instance
    const instance = new Morm();
    instance.url = new URL(connectionString);
    instance.options = options;

    const dbName = instance.url.pathname.slice(1);
    const host = instance.url.hostname;

    const isLocal =
      host === "localhost" || host === "127.0.0.1" || host === "::1";

    const ssl =
      options?.allowSSL ?? (!isLocal && { rejectUnauthorized: false });

    // -------- STEP 1 — Ensure DB exists ---------
    const adminURL = new URL(connectionString);
    adminURL.pathname = "/postgres";

    const adminPool = new Pool({
      connectionString: adminURL.toString(),
      ssl,
    });

    const message = await adminPool
      .query(`CREATE DATABASE "${dbName}"`)
      .then(() => `Database '${dbName}' created successfully.`)
      .catch((err: any) => {
        if (err.code === "42P04") {
          return `Database '${dbName}' already exists.`;
        }
        throw err; // real error → let it bubble
      })
      .finally(() => adminPool.end());

    // -------- STEP 2 — Connect to target DB --------
    return new Pool({ connectionString, ssl })
      .connect()
      .then((client: any) => {
        client.release(); // connection OK

        // Install pool on instance
        instance.pool = new Pool({ connectionString, ssl });

        // Cache it
        this.instances.set(connectionString, instance);

        if (callback) callback(null, message);

        return instance;
      })
      .catch((err: any) => {
        if (callback) {
          callback(err, undefined);
          return null;
        }
        throw err; // no callback -> reject promise
      });
  }

  /** Run a transaction */
  async transaction<T>(
    fn: (client: any) => Promise<T>,
    config: Partial<TransactionOptions> = {}
  ) {
    const client = await this.pool.connect();

    const maxWait =
      config.maxWait ?? this.options?.transaction?.maxWait ?? 2000;
    const timeout =
      config.timeout ?? this.options?.transaction?.timeout ?? 5000;

    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${maxWait}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${timeout}ms'`);

      const result = await fn(client);

      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Close connection */
  private async close() {
    await this.pool.end();
  }

  /* ================================
   * Enums
   * ================================ */
  enums(defs: { name: string; values: string[] }[]) {
    this.enumRegistry.register(defs);
  }

  model(config: {
    table: string;
    columns: ColumnDefinition[];
    indexes?: readonly string[];
    sanitize?: boolean | "strict";
  }) {
    const normalizedColumns = config.columns.map((col) => {
      const out: any = { ...col };

      /* ------------------------------
       * Unwrap functional properties
       * ------------------------------ */
      if (typeof out.name === "function") {
        out.name = out.name();
      }
      if (typeof out.type === "function") {
        out.type = out.type();
      }
      if (typeof out.primary === "function") {
        out.primary = out.primary();
      }
      if (typeof out.unique === "function") {
        out.unique = out.unique();
      }
      if (typeof out.notNull === "function") {
        out.notNull = out.notNull();
      }
      if (typeof out.default === "function") {
        out.default = out.default();
      }
      if (typeof out.check === "function") {
        out.check = out.check();
      }
      if (typeof out.sanitize === "function") {
        out.sanitize = out.sanitize();
      }

      return out;
    });

    const mdl = createModelRuntime(this, {
      ...config,
      columns: normalizedColumns,
    } as any);

    this.models.push(mdl);
    return mdl;
  }

  /* ================================
   * Migration
   * ================================ */
  async migrate(option?: { clean?: boolean; reset?: boolean }) {
    if (this._migrating) return false;
    this._migrating = true;

    const options = { clean: true, reset: false, ...option };

    // DATABASE RESET => reset:true
    if (options.reset) {
      await resetDatabase(this.pool);
    }

    /* ---------- ENUM MIGRATION ---------- */
    // ENUM DEFINITION ERRORS → LOG + ABORT (NO THROW)
    if (this.enumRegistry.hasErrors()) {
      this.enumRegistry.printErrors();

      this.enumRegistry.clearErrors();
      this._migrating = false;
      return false;
    }

    // SAFE: only pass resolved enum data
    await migrateEnumsGlobal(this.pool, this.enumRegistry.all());

    /* ---------- HARD MODEL VALIDATION ---------- */
    for (const model of this.models) {
      if (model.sql.create === "") {
        console.log(
          `${colors.section}${colors.bold}MORM MIGRATION:${colors.reset}`
        );
        console.log(
          `  ${colors.error}Aborted:${colors.reset} ${colors.subject}${model.table}${colors.reset}`
        );
        this._migrating = false;
        return false;
      }
    }

    /* ---------- TABLE RENAME DETECTION ---------- */
    const dbTables = (
      await this.pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `)
    ).rows.map((r: any) => r.table_name);

    const modelTables = this.models.map((m) => m.table);
    const removed = dbTables.filter((t) => !modelTables.includes(t));
    const added = modelTables.filter((t) => !dbTables.includes(t));

    if (removed.length === 1 && added.length === 1) {
      console.log(
        `${colors.section}${colors.bold}MORM MIGRATION:${colors.reset}`
      );
      console.log(
        `  ${colors.processing}Renamed:${colors.reset} ${colors.subject}${removed[0]} → ${added[0]}${colors.reset}`
      );

      await this.pool.query(
        `ALTER TABLE "${removed[0]}" RENAME TO "${added[0]}"`
      );
    }

    /* ---------- RELATION VALIDATION ---------- */
    const relRes = validateAndSortModels(this.models);
    if (relRes.errors?.length) {
      console.log(
        `${colors.section}${colors.bold}RELATION ERROR:${colors.reset}`
      );
      for (const e of relRes.errors) {
        console.log(e);
      }
      console.log();
      this._migrating = false;
      return false;
    }

    if (relRes.sorted) this.models = relRes.sorted;

    /* ---------- APPLY MIGRATIONS ---------- */
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      for (const model of this.models) {
        const ok = await model.migrate(client, options);
        if (!ok) {
          await client.query("ROLLBACK");
          this._migrating = false;
          return false;
        }
      }

      /* ---------- JUNCTION TABLES ---------- */
      const junctions = buildJunctionTables(this.models);
      for (const j of junctions) {
        await client.query(j.createSQL);
        for (const idx of j.indexSQL ?? []) await client.query(idx);

        console.log(
          `${colors.section}${colors.bold}MORM MIGRATION:${colors.reset}`
        );
        console.log(
          `  ${colors.success}Created:${colors.reset} ${colors.subject}${j.table}${colors.reset}`
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console
        .log
        // `${colors.section}${colors.bold}MORM MIGRATION ERROR:${colors.reset}`
        ();
      console.log(
        `  ${colors.error}Failed:${colors.reset} ${colors.subject}${String(
          err
        )}${colors.reset}`
      );
    } finally {
      client.release();
    }

    this._migrating = false;
    return true;
  }

  // async query(){}
}
