/**
 * The local store: SQLite in WAL mode via node:sqlite (D3). One file under
 * FORGE_HOME (default ./.forge). The owner's legacy data/ directory is never
 * touched.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync as DB } from "node:sqlite";

// node:sqlite prints an ExperimentalWarning once; FORGE reads that as noise.
const originalEmit = process.emitWarning;
function quietSqliteWarning() {
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (/SQLite is an experimental feature/.test(text)) return;
    return (originalEmit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE files (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL, bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'upload', created_at TEXT NOT NULL);
   CREATE TABLE builds (
     id TEXT PRIMARY KEY, request TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT,
     provenance TEXT NOT NULL, model TEXT, file_ids TEXT NOT NULL, parent_tool TEXT,
     tool_id TEXT, version INTEGER, created_at TEXT NOT NULL, ended_at TEXT);
   CREATE TABLE events (
     build_id TEXT NOT NULL, seq INTEGER NOT NULL, at_ms INTEGER NOT NULL, type TEXT NOT NULL,
     body TEXT NOT NULL, PRIMARY KEY (build_id, seq));
   CREATE TABLE tools (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, request_key TEXT NOT NULL,
     status TEXT NOT NULL, current_version INTEGER, last_file_ids TEXT NOT NULL DEFAULT '[]',
     schedule TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE versions (
     tool_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, ir_hash TEXT,
     recipe TEXT NOT NULL, english TEXT NOT NULL, passport TEXT NOT NULL, grants TEXT NOT NULL,
     examples TEXT NOT NULL DEFAULT '[]', build_id TEXT, status TEXT NOT NULL,
     approved_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY (tool_id, version));
   CREATE TABLE runs (
     id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
     event_key TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,
     error TEXT, inputs TEXT NOT NULL, ms REAL NOT NULL, at TEXT NOT NULL);
   CREATE UNIQUE INDEX runs_once ON runs (tool_id, hash, event_key) WHERE status = 'done';
   CREATE TABLE artifacts (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool_id TEXT NOT NULL, name TEXT NOT NULL,
     format TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE receipts (
     id TEXT PRIMARY KEY, run_id TEXT, tool_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL,
     target TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL, effect_key TEXT,
     artifact_id TEXT, at TEXT NOT NULL);
   CREATE UNIQUE INDEX receipts_once ON receipts (effect_key) WHERE status = 'committed';
   CREATE TABLE examples (
     id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE memory (
     id TEXT PRIMARY KEY, request TEXT NOT NULL, recipe TEXT NOT NULL, files TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export function forgeHome(): string {
  return resolve(process.env.FORGE_HOME ?? join(process.cwd(), ".forge"));
}

export function openDatabase(path = join(forgeHome(), "forge.db")): DB {
  quietSqliteWarning();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      db.prepare("UPDATE schema_version SET version = ?").run(version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}

export function tx<T>(db: DB, f: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = f();
    db.exec("COMMIT");
    return out;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
