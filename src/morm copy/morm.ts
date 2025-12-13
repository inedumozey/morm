import { Pool } from "pg";

import { createModelRuntime } from "./model.js";
import { colors } from "./utils/logColors.js";

export interface TransformOptions {
  trim?: number;
  sanitize?: number;
  toLowerCase?: number;
  toUpperCase?: number;
}

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
}

export interface MormOptions {
  allowSLL?: boolean;
  transaction?: TransactionOptions;
  transform?: TransformOptions;
}

export class Morm {
  private pool!: InstanceType<typeof Pool>;
  private url!: URL;
  private options?: MormOptions | undefined;
  private models: any[] = [];
  private _migrationSummary: {
    table: string;
    ok: boolean;
    changed: number;
    skipped: number;
  }[] = [];
  private _migrating: boolean = false;

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
      options?.allowSLL ?? (!isLocal && { rejectUnauthorized: false });

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

  model(config: {
    table: string;
    columns: any[];
    indexes?: any[];
    enums?: any[]; // enums validated at runtime only
  }) {
    const mdl = createModelRuntime(this, config as any);
    this.models.push(mdl);
    return mdl;
  }

  async migrate(options?: { clean?: boolean; reset?: boolean }) {
    if (this._migrating) return false;
    this._migrating = true;

    // reset summary storage before each run
    this._migrationSummary = [];

    // ======================================================
    // AUTOMATIC TABLE RENAME DETECTION
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

    // ======================================================
    // DROP TABLES NOT IN MODELS
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
    // ======================================================

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      for (const model of this.models) {
        const ok = await model.migrate(client, options);
        if (!ok) {
          // don't throw — continue
          continue;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("MORM global migrate error:", err);
    } finally {
      client.release();
    }

    // SUMMARY OUTPUT
    const summary = this._migrationSummary.filter(
      (s) => s.changed > 0 || s.skipped > 0
    );

    if (summary.length === 0) {
      this._migrating = false;
      this._migrationSummary = [];
      return true;
    }

    console.log(
      `${colors.bold}${colors.cyan}MORM MIGRATION SUMMARY:${colors.reset}`
    );

    for (const s of summary) {
      console.log(
        `  ${colors.green}${s.table}${colors.reset}` +
          ` — OK (${s.changed} changes, ${s.skipped} skipped)`
      );
    }

    console.log(); // single spacing at end

    // reset migrating flag so future migrations can run
    this._migrating = false;

    // VERY IMPORTANT: CLEAR MIGRATION SUMMARY AFTER USE
    this._migrationSummary = [];

    return true;
  }
}
