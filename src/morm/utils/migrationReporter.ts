// utils/migrationReporter.ts
//
// Central migration reporter.
// All sub-systems call report.add(...) during migration.
// morm.ts calls report.render() once at the very end.
//
// Output style:
//
//  ╔══════════════════════════════════╗
//  ║      MORM  ·  MIGRATION          ║
//  ╚══════════════════════════════════╝
//
//    ENUMS
//    ├─ Created     USER_ROLE, GENDER
//    └─ Dropped     OLD_STATUS
//
//    TABLES
//    ├─ Created     patients, admissions
//    ├─ Renamed     account → accounts
//    └─ Dropped     temp_log
//
//    COLUMNS  ›  patients
//    ├─ Added       ward_id, bed_number
//    ├─ NOT NULL    name, email
//    └─ FK          ward_id  (ON DELETE: NO ACTION → CASCADE)
//
//    INDEXES  ›  patients
//    ├─ Created     patients_ward_id_idx
//    └─ Dropped     patients_old_col_idx
//
//    ERRORS  ›  patients
//    └─ Cannot ADD column: ward_id (table has data, no default)
//
//    ✓  Complete  ·  3 tables  ·  7 changes  ·  0 errors
//

/* ===================================================== */
/* ANSI COLORS                                           */
/* ===================================================== */

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // Structure
  border: "\x1b[38;5;240m", // dark gray  — box borders, tree lines
  section: "\x1b[38;5;75m", // steel blue — section labels (ENUMS, TABLES…)
  subject: "\x1b[38;5;252m", // near-white — table/column names

  // Semantics
  created: "\x1b[38;5;114m", // soft green  — new things
  renamed: "\x1b[38;5;45m", // soft orange — renames
  dropped: "\x1b[38;5;208m", // soft red    — removals
  changed: "\x1b[38;5;183m", // soft purple — modifications
  error: "\x1b[38;5;203m", // bright red  — errors
  warning: "\x1b[1;93m", // bright yellow bold — warnings (attention-grabbing)
  ok: "\x1b[38;5;114m", // soft green  — success tick
  detail: "\x1b[38;5;244m", // mid gray    — parenthetical detail
};

/* ===================================================== */
/* TYPES                                                 */
/* ===================================================== */

export type EnumEvent =
  | { kind: "created"; names: string[] }
  | { kind: "updated"; names: string[] }
  | { kind: "renamed"; pairs: { from: string; to: string }[] }
  | { kind: "dropped"; names: string[] }
  | { kind: "blocked"; names: string[] };

export type TableEvent =
  | { kind: "created"; names: string[] }
  | { kind: "renamed"; pairs: { from: string; to: string }[] }
  | { kind: "dropped"; names: string[] };

export type JunctionEvent =
  | { kind: "created"; names: string[] }
  | { kind: "dropped"; names: string[] };

export type ColumnEvent =
  | { kind: "added"; table: string; names: string[] }
  | { kind: "dropped"; table: string; names: string[] }
  | { kind: "renamed"; table: string; pairs: { from: string; to: string }[] }
  | {
      kind: "type";
      table: string;
      pairs: { col: string; from: string; to: string }[];
    }
  | { kind: "notNull"; table: string; set: string[]; dropped: string[] }
  | { kind: "unique"; table: string; set: string[]; dropped: string[] }
  | { kind: "default"; table: string; set: string[]; dropped: string[] }
  | {
      kind: "check";
      table: string;
      added: string[];
      dropped: string[];
      updated: string[];
    }
  | { kind: "pk"; table: string; added: string[]; dropped: string[] }
  | {
      kind: "fk";
      table: string;
      added: string[];
      dropped: string[];
      rebuilt: { col: string; reasons: string }[];
    }
  | { kind: "identity"; table: string; set: string[]; dropped: string[] };

export type IndexEvent =
  | { kind: "created"; table: string; names: string[] }
  | { kind: "dropped"; table: string; names: string[] };

export type ErrorEvent = {
  section: string;
  table?: string;
  message: string;
};

export type WarningEvent = {
  section: string;
  table?: string;
  message: string;
};

/* ===================================================== */
/* REPORTER CLASS                                        */
/* ===================================================== */

export class MigrationReporter {
  private enums: EnumEvent[] = [];
  private tables: TableEvent[] = [];
  private junctions: JunctionEvent[] = [];
  private columns: ColumnEvent[] = [];
  private indexes: IndexEvent[] = [];
  public errors: ErrorEvent[] = [];
  public warnings: WarningEvent[] = [];

  /* ---- Collectors ---- */

  addEnum(event: EnumEvent) {
    this.enums.push(event);
  }
  addTable(event: TableEvent) {
    this.tables.push(event);
  }
  addJunction(event: JunctionEvent) {
    this.junctions.push(event);
  }
  addColumn(event: ColumnEvent) {
    this.columns.push(event);
  }
  addIndex(event: IndexEvent) {
    this.indexes.push(event);
  }
  addError(event: ErrorEvent) {
    this.errors.push(event);
  }
  addWarning(event: WarningEvent) {
    this.warnings.push(event);
  }

  hasErrors() {
    return this.errors.length > 0;
  }
  hasWarnings() {
    return this.warnings.length > 0;
  }

  hasWork() {
    return (
      this.enums.length > 0 ||
      this.tables.length > 0 ||
      this.junctions.length > 0 ||
      this.columns.length > 0 ||
      this.indexes.length > 0 ||
      this.errors.length > 0 ||
      this.warnings.length > 0
    );
  }

  /* ---- Reset between runs ---- */
  reset() {
    this.enums = [];
    this.tables = [];
    this.junctions = [];
    this.columns = [];
    this.indexes = [];
    this.errors = [];
    this.warnings = [];
  }

  /* ===================================================== */
  /* RENDER                                                */
  /* ===================================================== */

  render() {
    if (!this.hasWork()) return;

    const lines: string[] = [];

    /* ---- Header ---- */
    lines.push(...renderHeader());

    /* ---- Enums ---- */
    if (this.enums.length > 0) {
      lines.push(...renderEnums(this.enums));
      lines.push("");
    }

    /* ---- Tables ---- */
    if (this.tables.length > 0) {
      lines.push(...renderTables(this.tables));
      lines.push("");
    }

    /* ---- Junctions ---- */
    if (this.junctions.length > 0) {
      lines.push(...renderJunctions(this.junctions));
      lines.push("");
    }

    /* ---- Columns (grouped by table) ---- */
    const colsByTable = groupBy(this.columns, (e) => e.table);
    for (const [table, events] of colsByTable) {
      lines.push(...renderColumns(table, events));
      lines.push("");
    }

    /* ---- Indexes (grouped by table) ---- */
    const idxByTable = groupBy(this.indexes, (e) => e.table);
    for (const [table, events] of idxByTable) {
      lines.push(...renderIndexes(table, events));
      lines.push("");
    }

    /* ---- Warnings ---- */
    if (this.warnings.length > 0) {
      lines.push(...renderWarnings(this.warnings));
    }

    /* ---- Errors ---- */
    if (this.errors.length > 0) {
      lines.push(...renderErrors(this.errors));
    }

    /* ---- Summary ---- */
    lines.push(renderSummary(this));
    lines.push("");

    console.log(lines.join("\n"));
  }

  /* Expose counts for summary */
  _countChanges() {
    let n = 0;

    for (const e of this.enums) {
      if (e.kind === "created" || e.kind === "updated" || e.kind === "renamed")
        n += "names" in e ? e.names.length : e.pairs.length;
    }
    for (const e of this.tables) {
      n += "names" in e ? e.names.length : e.pairs.length;
    }
    for (const e of this.junctions) {
      n += e.names.length;
    }
    for (const e of this.columns) {
      switch (e.kind) {
        case "added":
          n += e.names.length;
          break;
        case "dropped":
          n += e.names.length;
          break;
        case "renamed":
          n += e.pairs.length;
          break;
        case "type":
          n += e.pairs.length;
          break;
        case "notNull":
          n += e.set.length + e.dropped.length;
          break;
        case "unique":
          n += e.set.length + e.dropped.length;
          break;
        case "default":
          n += e.set.length + e.dropped.length;
          break;
        case "check":
          n += e.added.length + e.dropped.length + e.updated.length;
          break;
        case "pk":
          n += e.added.length + e.dropped.length;
          break;
        case "fk":
          n += e.added.length + e.dropped.length + e.rebuilt.length;
          break;
        case "identity":
          n += e.set.length + e.dropped.length;
          break;
      }
    }
    for (const e of this.indexes) {
      n += e.names.length;
    }
    return n;
  }

  _countTables() {
    const seen = new Set<string>();
    for (const e of this.columns) seen.add(e.table);
    for (const e of this.indexes) seen.add(e.table);
    for (const e of this.tables) {
      if ("names" in e) e.names.forEach((n) => seen.add(n));
      else e.pairs.forEach((p) => seen.add(p.to));
    }
    return seen.size;
  }
}

/* ===================================================== */
/* RENDER HELPERS                                        */
/* ===================================================== */

/** Tree line characters */
const T = {
  mid: `${c.border}├─${c.reset}`,
  last: `${c.border}└─${c.reset}`,
  pipe: `${c.border}│${c.reset}`,
};

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function names(arr: string[], color = c.subject) {
  return arr
    .map((n) => `${color}${n}${c.reset}`)
    .join(`${c.detail}, ${c.reset}`);
}

function pairs(arr: { from: string; to: string }[]) {
  return arr
    .map(
      (p) =>
        `${c.dropped}${p.from}${c.reset} ${c.border}→${c.reset} ${c.created}${p.to}${c.reset}`,
    )
    .join(`  `);
}

/** Section header: "  ENUMS" or "  COLUMNS  ›  patients" */
function sectionHeader(label: string, subject?: string): string {
  const s = `  ${c.bold}${c.section}${label}${c.reset}`;
  if (!subject) return s;
  return `${s}  ${c.border}›${c.reset}  ${c.bold}${c.subject}${subject}${c.reset}`;
}

/** Render a list of tree rows, last one gets └─ */
function treeRows(
  rows: { label: string; value: string; color?: string }[],
): string[] {
  return rows.map((row, i) => {
    const isLast = i === rows.length - 1;
    const branch = isLast ? T.last : T.mid;
    const labelColor = row.color ?? c.changed;
    const label = `${labelColor}${row.label.padEnd(12)}${c.reset}`;
    return `  ${branch} ${label} ${row.value}`;
  });
}

/* ===================================================== */
/* SECTION RENDERERS                                     */
/* ===================================================== */

function renderHeader(): string[] {
  const title = "  MORM  ·  MIGRATION  ";
  const width = title.length + 4;
  const bar = "═".repeat(width);
  return [
    "",
    `  ${c.border}╔${bar}╗${c.reset}`,
    `  ${c.border}║${c.reset}${c.bold}${c.section}${title}${c.reset}${c.border}  ║${c.reset}`,
    `  ${c.border}╚${bar}╝${c.reset}`,
    "",
  ];
}

function renderEnums(events: EnumEvent[]): string[] {
  const rows: { label: string; value: string; color?: string }[] = [];

  for (const e of events) {
    switch (e.kind) {
      case "created":
        rows.push({
          label: "Created",
          value: names(e.names, c.created),
          color: c.created,
        });
        break;
      case "updated":
        rows.push({
          label: "Updated",
          value: names(e.names, c.changed),
          color: c.changed,
        });
        break;
      case "renamed":
        rows.push({
          label: "Renamed",
          value: pairs(e.pairs),
          color: c.renamed,
        });
        break;
      case "dropped":
        rows.push({
          label: "Dropped",
          value: names(e.names, c.dropped),
          color: c.dropped,
        });
        break;
      case "blocked":
        rows.push({
          label: "Blocked",
          value: `${c.detail}${e.names.join(", ")} (still in use)${c.reset}`,
          color: c.detail,
        });
        break;
    }
  }

  if (rows.length === 0) return [];
  return [sectionHeader("ENUMS"), ...treeRows(rows)];
}

function renderTables(events: TableEvent[]): string[] {
  const rows: { label: string; value: string; color?: string }[] = [];

  for (const e of events) {
    switch (e.kind) {
      case "created":
        rows.push({
          label: "Created",
          value: names(e.names, c.created),
          color: c.created,
        });
        break;
      case "renamed":
        rows.push({
          label: "Renamed",
          value: pairs(e.pairs),
          color: c.renamed,
        });
        break;
      case "dropped":
        rows.push({
          label: "Dropped",
          value: names(e.names, c.dropped),
          color: c.dropped,
        });
        break;
    }
  }

  if (rows.length === 0) return [];
  return [sectionHeader("TABLES"), ...treeRows(rows)];
}

function renderJunctions(events: JunctionEvent[]): string[] {
  const created: string[] = [];
  const dropped: string[] = [];
  for (const e of events) {
    if (e.kind === "created") created.push(...e.names);
    if (e.kind === "dropped") dropped.push(...e.names);
  }
  if (created.length === 0 && dropped.length === 0) return [];
  const rows: { label: string; value: string; color?: string }[] = [];
  if (created.length)
    rows.push({
      label: "Created",
      value: names(created, c.created),
      color: c.created,
    });
  if (dropped.length)
    rows.push({
      label: "Dropped",
      value: names(dropped, c.dropped),
      color: c.dropped,
    });
  return [sectionHeader("JUNCTIONS"), ...treeRows(rows)];
}

function renderColumns(table: string, events: ColumnEvent[]): string[] {
  const rows: { label: string; value: string; color?: string }[] = [];

  for (const e of events) {
    switch (e.kind) {
      case "added":
        rows.push({
          label: "Added",
          value: names(e.names, c.created),
          color: c.created,
        });
        break;
      case "dropped":
        rows.push({
          label: "Dropped",
          value: names(e.names, c.dropped),
          color: c.dropped,
        });
        break;
      case "renamed":
        rows.push({
          label: "Renamed",
          value: pairs(e.pairs),
          color: c.renamed,
        });
        break;
      case "type":
        rows.push({
          label: "Type",
          value: e.pairs
            .map(
              (p) =>
                `${c.subject}${p.col}${c.reset} ${c.detail}(${c.dropped}${p.from}${c.reset} ${c.border}→${c.reset} ${c.created}${p.to}${c.reset}${c.detail})${c.reset}`,
            )
            .join("  "),
          color: c.changed,
        });
        break;
      case "notNull":
        if (e.set.length)
          rows.push({
            label: "NOT NULL ✓",
            value: names(e.set, c.created),
            color: c.created,
          });
        if (e.dropped.length)
          rows.push({
            label: "NOT NULL ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        break;
      case "unique":
        if (e.set.length)
          rows.push({
            label: "Unique ✓",
            value: names(e.set, c.created),
            color: c.created,
          });
        if (e.dropped.length)
          rows.push({
            label: "Unique ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        break;
      case "default":
        if (e.set.length)
          rows.push({
            label: "Default ✓",
            value: names(e.set, c.created),
            color: c.created,
          });
        if (e.dropped.length)
          rows.push({
            label: "Default ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        break;
      case "check":
        if (e.added.length)
          rows.push({
            label: "Check ✓",
            value: names(e.added, c.created),
            color: c.created,
          });
        if (e.updated.length)
          rows.push({
            label: "Check ~",
            value: names(e.updated, c.changed),
            color: c.changed,
          });
        if (e.dropped.length)
          rows.push({
            label: "Check ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        break;
      case "pk":
        if (e.added.length)
          rows.push({
            label: "PK ✓",
            value: names(e.added, c.created),
            color: c.created,
          });
        if (e.dropped.length)
          rows.push({
            label: "PK ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        break;
      case "fk":
        if (e.added.length)
          rows.push({
            label: "FK ✓",
            value: names(e.added, c.created),
            color: c.created,
          });
        if (e.dropped.length)
          rows.push({
            label: "FK ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        if (e.rebuilt.length)
          rows.push({
            label: "FK ~",
            value: e.rebuilt
              .map(
                (r) =>
                  `${c.subject}${r.col}${c.reset} ${c.detail}(${r.reasons})${c.reset}`,
              )
              .join("  "),
            color: c.changed,
          });
        break;
      case "identity":
        if (e.set.length)
          rows.push({
            label: "Identity ✓",
            value: names(e.set, c.created),
            color: c.created,
          });
        if (e.dropped.length)
          rows.push({
            label: "Identity ✗",
            value: names(e.dropped, c.dropped),
            color: c.dropped,
          });
        break;
    }
  }

  if (rows.length === 0) return [];
  return [sectionHeader("COLUMNS", table), ...treeRows(rows)];
}

function renderIndexes(table: string, events: IndexEvent[]): string[] {
  const rows: { label: string; value: string; color?: string }[] = [];
  const created: string[] = [];
  const dropped: string[] = [];

  for (const e of events) {
    if (e.kind === "created") created.push(...e.names);
    if (e.kind === "dropped") dropped.push(...e.names);
  }

  if (created.length)
    rows.push({
      label: "Created",
      value: names(created, c.created),
      color: c.created,
    });
  if (dropped.length)
    rows.push({
      label: "Dropped",
      value: names(dropped, c.dropped),
      color: c.dropped,
    });

  if (rows.length === 0) return [];
  return [sectionHeader("INDEXES", table), ...treeRows(rows)];
}

function renderWarnings(warnings: WarningEvent[]): string[] {
  const bySection = groupBy(warnings, (e) => e.table ?? e.section);
  const out: string[] = [];

  for (const [subject, warns] of bySection) {
    out.push(sectionHeader("WARNING", subject));
    out.push(
      ...treeRows(
        warns.map((e) => ({
          label: e.section,
          value: `${c.warning}${e.message}${c.reset}`,
          color: c.warning,
        })),
      ),
    );
    out.push("");
  }

  return out;
}

function renderErrors(errors: ErrorEvent[]): string[] {
  const bySection = groupBy(errors, (e) => e.table ?? e.section);
  const out: string[] = [];

  for (const [subject, errs] of bySection) {
    out.push(sectionHeader("ERROR", subject));
    out.push(
      ...treeRows(
        errs.map((e) => ({
          label: e.section,
          value: `${c.error}${e.message}${c.reset}`,
          color: c.error,
        })),
      ),
    );
    out.push(""); // blank line between each error group
  }

  return out;
}

function renderSummary(report: MigrationReporter): string {
  const changes = report._countChanges();
  const tables = report._countTables();
  const errors = report.errors.length;
  const warnings = report.warnings.length;

  const tick =
    errors > 0
      ? `${c.error}✗${c.reset}`
      : warnings > 0
        ? `${c.warning}⚠${c.reset}`
        : `${c.ok}✓${c.reset}`;

  const status =
    errors > 0
      ? `${c.error}Completed with errors${c.reset}`
      : warnings > 0
        ? `${c.warning}Complete with warnings${c.reset}`
        : `${c.ok}Complete${c.reset}`;

  const parts = [
    `${c.subject}${tables}${c.reset} ${c.detail}table${tables !== 1 ? "s" : ""}${c.reset}`,
    `${c.subject}${changes}${c.reset} ${c.detail}change${changes !== 1 ? "s" : ""}${c.reset}`,
    `${errors > 0 ? c.error : c.detail}${errors} error${errors !== 1 ? "s" : ""}${c.reset}`,
    `${warnings > 0 ? c.warning : c.detail}${warnings} warning${warnings !== 1 ? "s" : ""}${c.reset}`,
  ];

  return `  ${tick}  ${status}  ${c.border}·${c.reset}  ${parts.join(`  ${c.border}·${c.reset}  `)}`;
}

/* ===================================================== */
/* SINGLETON                                             */
/* ===================================================== */

/** Single shared reporter instance used across the migration run */
export const reporter = new MigrationReporter();
