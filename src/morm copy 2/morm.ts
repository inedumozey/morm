// morm.ts

import { Pool } from "pg";

import { createModelRuntime } from "./model.js";
import { colors } from "./utils/logColors.js";
import { validateAndSortModels } from "./utils/relationValidator.js";
import { buildJunctionTables } from "./utils/junctionBuilder.js";
import type { ColumnDefinition } from "./model-types.js";
import { EnumRegistry, migrateEnumsGlobal } from "./migrations/enumRegistry.js";

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

  enums(defs: { name: string; values: string[] }[]) {
    this.enumRegistry.register(defs);
  }

  model(config: {
    table: string;
    columns: ColumnDefinition[];
    indexes?: readonly string[];
    sanitize?: boolean | "strict";
    enums?: any[]; // enums validated at runtime only
  }) {
    const mdl = createModelRuntime(this, config as any);
    this.models.push(mdl);
    return mdl;
  }

  async migrate(option?: { clean?: boolean; reset?: boolean }) {
    if (this._migrating) return false;
    this._migrating = true;

    const options = {
      clean: true,
      reset: false,
      ...option,
    };

    // ================================
    // ENUM VALIDATION (models → registry)
    // ================================
    for (const model of this.models) {
      for (const col of model.columns ?? []) {
        const type = String(col.type);
        if (
          /^(INT|INTEGER|SMALLINT|BIGINT|TEXT|UUID|BOOLEAN|JSON|JSONB|TIMESTAMP|TIMESTAMPTZ|DATE|TIME|TIMEZ|NUMERIC|DECIMAL)(\[\])?$/i.test(
            type
          )
        ) {
          continue;
        }

        if (!this.enumRegistry.get(type)) {
          throw new Error(
            `MORM MODEL ERROR: ${model.table}.${col.name} uses enum "${type}" but it was not registered`
          );
        }
      }
    }

    // ================================
    // ENUM MIGRATION (GLOBAL)
    // ================================
    await migrateEnumsGlobal(this.pool, this.enumRegistry.all());

    // ======================================================
    // STARTS --- HARD VALIDATION — NO DATABASE CHANGES IF ANY MODEL FAILS
    // ======================================================
    for (const model of this.models) {
      if (model.sql.create === "") {
        console.log(
          colors.red +
            colors.bold +
            `MORM MIGRATION ABORTED — model "${model.table}" validation failed.` +
            colors.reset
        );

        // reset migrate state
        this._migrating = false;

        return false;
      }
    }
    // ======================================================
    // ENDS --- HARD VALIDATION — NO DATABASE CHANGES IF ANY MODEL FAILS
    // ======================================================

    // ======================================================
    // START --- AUTOMATIC TABLE RENAME DETECTION
    // ======================================================
    const dbTables = (
      await this.pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `)
    ).rows.map((r: any) => r.table_name);

    const modelTables = this.models.map((m) => m.table);

    const removed = dbTables.filter((t: any) => !modelTables.includes(t));
    const added = modelTables.filter((t) => !dbTables.includes(t));

    if (removed.length === 1 && added.length === 1) {
      const oldTable = removed[0];
      const newTable = added[0];

      console.log(
        `${colors.cyan}MORM: Renaming table "${oldTable}" → "${newTable}"${colors.reset}`
      );

      try {
        await this.pool.query(
          `ALTER TABLE "${oldTable}" RENAME TO "${newTable}"`
        );
      } catch (err) {
        console.error(
          `${colors.red}MORM TABLE RENAME ERROR ${oldTable} → ${newTable}${colors.reset}`
        );
        console.error(err);
      }
    }

    // ======================================================
    // START --- DROP TABLES NOT IN MODELS WHEN reset:true
    // ======================================================
    const remainingDbTables = (
      await this.pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `)
    ).rows.map((r: any) => r.table_name);

    const modelTableNames = this.models.map((m) => m.table);

    for (const table of remainingDbTables) {
      // skip special Postgres tables
      if (table.startsWith("pg_") || table.startsWith("sql_")) continue;

      // skip model tables
      if (modelTableNames.includes(table)) continue;

      // this is a table that exists in DB but not in models:
      // => potentially drop
      if (!options?.clean && !options?.reset) {
        console.log(
          `${colors.yellow}Skipped drop table "${table}" (clean:false)${colors.reset}`
        );
        continue;
      }

      console.log(
        `${colors.red}${colors.bold}Dropping table "${table}"${colors.reset}`
      );

      try {
        await this.pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      } catch (err) {
        console.error(
          `${colors.red}MORM DROP TABLE ERROR: ${table}${colors.reset}`
        );
        console.error(err);
      }
    }
    if (options?.reset) {
      console.log(
        colors.red +
          colors.bold +
          "MORM RESET: DROPPING ALL TABLES, ENUMS, AND TRIGGERS" +
          colors.reset
      );

      // 1. DROP ALL TRIGGERS
      await this.pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
      ) LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS "' || r.trigger_name || '" ON "' || r.event_object_table || '" CASCADE';
      END LOOP;
    END $$;
  `);

      // 2. DROP ALL TABLES
      await this.pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
      ) LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);

      // 3. DROP ALL ENUM TYPES
      await this.pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT typname FROM pg_type
        WHERE typtype = 'e'
      ) LOOP
        EXECUTE 'DROP TYPE IF EXISTS "' || r.typname || '" CASCADE';
      END LOOP;
    END $$;
  `);

      console.log(
        colors.cyan +
          "MORM RESET COMPLETE — database schema wiped" +
          colors.reset
      );
      console.log(
        colors.magenta + "Rebuilding tables from models…" + colors.reset
      );
    }

    // ======================================================
    // START--- RELATION VALIDATION & AUTOSORT
    // ======================================================
    const relRes = validateAndSortModels(this.models);
    if (relRes.infos && relRes.infos.length > 0) {
      for (const info of relRes.infos) console.log(info);
    }
    if (relRes.errors && relRes.errors.length > 0) {
      // Print errors and abort migration early (before any destructive reset)
      console.log(
        `${colors.bold}${colors.red}MORM MODEL ERROR — relation validation failed${colors.reset}`
      );
      for (const e of relRes.errors) console.error("  " + e);
      this._migrating = false;
      return false;
    }
    if (relRes.sorted) {
      // reorder this.models to the dependency-safe order
      this.models = relRes.sorted;
    }
    // ======================================================
    // END--- RELATION VALIDATION & AUTOSORT
    // ======================================================

    // TESTING REVERSE RELATION
    // for (const m of this.models) {
    //   console.log(colors.cyan + `RELATIONS for ${m.table}:` + colors.reset);
    //   console.log("  outgoing:", m._relations?.outgoing);
    //   console.log("  incoming:", m._relations?.incoming);
    // }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      for (const model of this.models) {
        const ok = await model.migrate(client, options);
        if (!ok) {
          console.error(
            colors.red +
              colors.bold +
              `MORM MIGRATION ABORTED — model "${model.table}" failed. Rolling back.` +
              colors.reset
          );
          await client.query("ROLLBACK");
          this._migrating = false;
          return false;
        }
      }
      // ======================================================
      // MANY-TO-MANY — CREATE JUNCTION TABLES (SAME TRANSACTION)
      // ======================================================
      const junctionPlans = buildJunctionTables(this.models);

      for (const j of junctionPlans) {
        try {
          await client.query(j.createSQL);

          for (const idx of j.indexSQL ?? []) {
            await client.query(idx);
          }

          console.log(
            `${colors.green}Created junction table "${j.table}"${colors.reset}`
          );
        } catch (err) {
          console.error(
            `${colors.red}${colors.bold}MORM JUNCTION ERROR — "${j.table}"${colors.reset}`
          );
        }
      }
      // ======================================================
      // ENDS -- MANY-TO-MANY — CREATE JUNCTION TABLES (ATOMIC)
      // ======================================================

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(
        `${colors.red}${colors.bold}MORM GLOBAL MIGRATION ERROR — "${err}"${colors.reset}`
      );
    } finally {
      client.release();
    }

    console.log(); // single spacing at end

    // reset migrating flag so future migrations can run
    this._migrating = false;

    return true;
  }
}
