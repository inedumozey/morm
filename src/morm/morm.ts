// morm.ts

import { Pool } from "pg";

import { createModelRuntime } from "./model.js";
import { validateAndSortModels } from "./utils/relationValidator.js";
import type { ColumnDefinition } from "./model-types.js";
import type { IndexDefinition } from "./migrations/indexMigrations.js";
import { EnumRegistry, migrateEnumsGlobal } from "./migrations/enumRegistry.js";
import { resetDatabase } from "./migrations/resetDatabase.js";
import { tableMigrations } from "./migrations/tableMigrations.js";
import { renderJunctionBuilder } from "./utils/junctionBuilder.js";
import { reporter } from "./utils/migrationReporter.js";

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
  private modelMap = new Map<string, any>(); // fix #7 — lookup by table name
  private _migrating: boolean = false;
  private enumRegistry = new EnumRegistry();

  /* --------------------------------------------------
   * Instance cache — keyed by host+port+dbname only,
   * never by full connection string (fix #5 — no passwords in keys)
   * -------------------------------------------------- */
  private static instances: Map<string, Morm> = new Map();
  private constructor() {}

  private static cacheKey(url: URL): string {
    const port = url.port || "5432";
    return `${url.hostname}:${port}${url.pathname}`;
  }

  /* --------------------------------------------------
   * MAIN ENTRY
   * -------------------------------------------------- */
  static async init(
    connectionString: string,
    options?: MormOptions,
  ): Promise<Morm> {
    const parsedUrl = new URL(connectionString);
    const key = Morm.cacheKey(parsedUrl);

    if (this.instances.has(key)) {
      return this.instances.get(key)!;
    }

    const instance = new Morm();
    instance.url = parsedUrl;
    instance.options = options;

    const dbName = parsedUrl.pathname.slice(1);
    const host = parsedUrl.hostname;
    const isLocal =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    const ssl =
      options?.allowSSL ?? (!isLocal && { rejectUnauthorized: false });

    /* --- Ensure DB exists --- */
    const adminURL = new URL(connectionString);
    adminURL.pathname = "/postgres";

    const adminPool = new Pool({ connectionString: adminURL.toString(), ssl });

    await adminPool
      .query(`CREATE DATABASE "${dbName}"`)
      .catch((err: any) => {
        if (err.code === "42P04") {
          return;
        }
        throw err;
      })
      .finally(() => adminPool.end());

    /* --- Connect to target DB --- */
    const client = await new Pool({ connectionString, ssl }).connect();
    client.release();

    instance.pool = new Pool({ connectionString, ssl });
    this.instances.set(key, instance);

    return instance;
  }
  /* --------------------------------------------------
   * TRANSACTION
   * -------------------------------------------------- */
  async transaction<T>(
    fn: (client: any) => Promise<T>,
    config: Partial<TransactionOptions> = {},
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

  /* --------------------------------------------------
   * POOL ACCESS — for query layer
   * -------------------------------------------------- */
  async connect() {
    return this.pool.connect();
  }

  private async close() {
    await this.pool.end();
  }

  /* --------------------------------------------------
   * ENUM ACCESSORS — used by model.ts (fix #1)
   * -------------------------------------------------- */
  hasEnum(name: string): boolean {
    return this.enumRegistry.has(name);
  }

  getEnum(name: string) {
    return this.enumRegistry.get(name);
  }

  /* --------------------------------------------------
   * ENUMS
   * -------------------------------------------------- */
  enums(defs: { name: string; values: string[] }[]) {
    this.enumRegistry.register(defs);
  }

  /* --------------------------------------------------
   * MODEL — fix #3 (indexes type) + fix #7 (modelMap)
   * -------------------------------------------------- */
  model(config: {
    table: string;
    columns: ColumnDefinition[];
    indexes?: readonly IndexDefinition[];
    sanitize?: boolean | "strict";
    primaryKey?: string[]; // composite key
  }) {
    const normalizedColumns = config.columns.map((col) => {
      const out: any = { ...col };
      if (typeof out.name === "function") out.name = out.name();
      if (typeof out.type === "function") out.type = out.type();
      if (typeof out.primary === "function") out.primary = out.primary();
      if (typeof out.unique === "function") out.unique = out.unique();
      if (typeof out.notNull === "function") out.notNull = out.notNull();
      if (typeof out.default === "function") out.default = out.default();
      if (typeof out.check === "function") out.check = out.check();
      if (typeof out.sanitize === "function") out.sanitize = out.sanitize();
      return out;
    });

    const normalizedConfig = {
      ...config,
      table: config.table.toLowerCase(),
      primaryKey: config.primaryKey?.map((k) => k.toLowerCase()),
    };

    const mdl = createModelRuntime(this, {
      ...normalizedConfig,
      columns: normalizedColumns,
    } as any);

    this.models.push(mdl);
    this.modelMap.set(mdl.table, mdl); // register for lookup
    return mdl;
  }

  /* --------------------------------------------------
   * MODEL LOOKUP — for query layer (fix #7)
   * -------------------------------------------------- */
  getModel(table: string) {
    return this.modelMap.get(table);
  }

  /* --------------------------------------------------
   * MIGRATE
   * -------------------------------------------------- */
  async migrate(option?: { reset?: boolean }) {
    if (this._migrating) return false;
    this._migrating = true;

    const options = { reset: false, ...option };

    /* ---- PHASE 1 — Pre-flight ---- */

    /* Production reset guard (fix #9) */
    if (options.reset && process.env.NODE_ENV === "production") {
      reporter.addError({
        section: "MIGRATION",
        message: "migrate({ reset: true }) is not allowed in production",
      });
      reporter.render();
      this._migrating = false;
      return false;
    }

    if (this.enumRegistry.hasErrors()) {
      this.enumRegistry.printErrors();
      this.enumRegistry.clearErrors();
      reporter.render();
      this._migrating = false;
      return false;
    }

    for (const model of this.models) {
      if (model.sql.create === "") {
        reporter.render();
        this._migrating = false;
        return false;
      }
    }

    const relRes = validateAndSortModels(this.models);
    if (relRes.errors?.length) {
      for (const e of relRes.errors) {
        reporter.addError({
          section: "RELATION",
          message: e.message,
          ...(e.table !== undefined && { table: e.table }),
        });
      }
      reporter.render();
      this._migrating = false;
      return false;
    }

    if (relRes.sorted) this.models = relRes.sorted;

    /* ---- PHASE 2 — Out-of-transaction (enums + reset) ---- */
    const enumClient = await this.pool.connect();
    try {
      if (options.reset) {
        await resetDatabase(enumClient);
        // Add a single clean notice instead of noisy drop lists
        reporter.addWarning({
          section: "RESET",
          message:
            "Database was reset — all tables, enums and indexes were dropped and will be recreated",
        });
      }
      await migrateEnumsGlobal(enumClient, this.enumRegistry.all());
    } catch (err: any) {
      reporter.addError({ section: "ENUM", message: String(err) });
      reporter.render();
      this._migrating = false;
      return false;
    } finally {
      enumClient.release();
    }

    /* ---- PHASE 3 — Transactional DDL ---- */
    const client = await this.pool.connect();
    try {
      /* Advisory lock — prevents concurrent migrations across processes (fix #10) */
      await client.query("SELECT pg_advisory_lock(7781135263)");
      await client.query("BEGIN");
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

      /* Shared updated_at trigger function — created once per DB (fix for race) */
      await client.query(`
        CREATE OR REPLACE FUNCTION morm_set_updated_at()
        RETURNS trigger AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      /* Table migrations — returns set of newly created tables */
      const createdTables = await tableMigrations(client, this.models);

      /* Junction tables */
      await renderJunctionBuilder(client, this.models);

      /* Column migrations — skip diffing on brand new tables (fix #2) */
      for (const model of this.models) {
        await model.migrate(client, createdTables);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      reporter.addError({ section: "MIGRATION", message: String(err) });
    } finally {
      /* Always release advisory lock, even on error */
      try {
        await client.query("SELECT pg_advisory_unlock(7781135263)");
      } catch {}
      client.release();
    }

    reporter.render();
    reporter.reset();
    this._migrating = false;
    return true;
  }
}
