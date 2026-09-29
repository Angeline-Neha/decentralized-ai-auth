import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config, ensureDataDir } from "../config.js";

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  agent TEXT NOT NULL,
  parent_id INTEGER NOT NULL DEFAULT 0,
  actions_root TEXT NOT NULL,
  per_call_cap TEXT NOT NULL,
  total_budget TEXT NOT NULL,
  spent TEXT NOT NULL DEFAULT '0',
  escrow TEXT NOT NULL DEFAULT '0',
  approval_threshold TEXT NOT NULL,
  window_seconds INTEGER NOT NULL,
  window_start INTEGER NOT NULL DEFAULT 0,
  expiry INTEGER NOT NULL,
  max_calls_per_window INTEGER NOT NULL,
  calls_in_window INTEGER NOT NULL DEFAULT 0,
  strikes INTEGER NOT NULL DEFAULT 0,
  max_strikes INTEGER NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS grant_manifests (
  grant_id INTEGER PRIMARY KEY,
  actions_json TEXT NOT NULL,
  root TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  index_num INTEGER NOT NULL UNIQUE,
  grant_id INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  code INTEGER NOT NULL,
  head TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  action_name TEXT,
  outcome TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS provider_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id INTEGER NOT NULL,
  nonce INTEGER NOT NULL,
  action_name TEXT NOT NULL,
  amount TEXT NOT NULL,
  payee TEXT,
  params_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS pending_intents (
  pending_id INTEGER PRIMARY KEY,
  grant_id INTEGER NOT NULL,
  nonce INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS indexer_cursors (
  name TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL,
  log_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_grant ON audit_events(grant_id);
CREATE INDEX IF NOT EXISTS idx_audit_index ON audit_events(index_num);
`;

export function getDb(): DatabaseSync {
  if (!db) {
    ensureDataDir();
    // An orphaned -wal/-shm left behind without its main file (e.g. gateway.db was deleted while the
    // gateway was still running, or the WAL was committed to git) must never be replayed into a new DB.
    if (!fs.existsSync(config.dbPath)) {
      for (const ext of ["-wal", "-shm"]) {
        try {
          fs.rmSync(config.dbPath + ext, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    db = new DatabaseSync(config.dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
  }
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

export interface GrantRow {
  id: number;
  owner: string;
  agent: string;
  parent_id: number;
  actions_root: string;
  per_call_cap: string;
  total_budget: string;
  spent: string;
  escrow: string;
  approval_threshold: string;
  window_seconds: number;
  window_start: number;
  expiry: number;
  max_calls_per_window: number;
  calls_in_window: number;
  strikes: number;
  max_strikes: number;
  depth: number;
  status: number;
  updated_at: number;
}

export interface AuditRow {
  id: number;
  index_num: number;
  grant_id: number;
  action_id: string;
  amount: string;
  params_hash: string;
  code: number;
  head: string;
  block_number: number;
  tx_hash: string;
  log_index: number;
  action_name: string | null;
  outcome: string | null;
  created_at: number;
}

export interface ManifestRow {
  grant_id: number;
  actions_json: string;
  root: string;
  created_at: number;
}

export function getCursor(name: string): { blockNumber: number; logIndex: number } {
  const row = getDb()
    .prepare("SELECT block_number, log_index FROM indexer_cursors WHERE name = ?")
    .get(name) as { block_number: number; log_index: number } | undefined;
  return { blockNumber: row?.block_number ?? 0, logIndex: row?.log_index ?? -1 };
}

export function setCursor(name: string, blockNumber: number, logIndex: number) {
  getDb()
    .prepare(
      `INSERT INTO indexer_cursors (name, block_number, log_index) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET block_number = excluded.block_number, log_index = excluded.log_index`,
    )
    .run(name, blockNumber, logIndex);
}

/** Wipe every indexed table (chain is the source of truth; everything here is rebuildable). */
export function wipeAll() {
  const d = getDb();
  for (const t of ["audit_events", "provider_runs", "pending_intents", "grants", "grant_manifests", "indexer_cursors"]) {
    d.exec(`DELETE FROM ${t}`);
  }
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
