import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Feedstr's own metadata DB. Per the stack storage boundary, signed Nostr events
// live in Idenstr's private relay; everything Feedstr owns (column config, feed
// rules, keyword mutes, read-position, cached observed notes) lives here and is
// never published.
const root = fileURLToPath(new URL('../..', import.meta.url));
let db = null;
let dbPath = null;
const stmtCache = new Map();

// Compile each SQL once and reuse the prepared statement. Always resolve the db
// first: getDb() detects a path change and clears the cache, so a cached
// statement can never outlive its database.
function prep(sql) {
  const database = getDb();
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = database.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

export function getDbPath() {
  if (process.env.FEEDSTR_DB_STORE) return process.env.FEEDSTR_DB_STORE;
  return join(root, 'data', 'feedstr.db');
}

export function getDb() {
  const nextPath = getDbPath();
  if (db && dbPath === nextPath) return db;
  if (db) db.close();
  stmtCache.clear();
  mkdirSync(dirname(nextPath), { recursive: true });
  db = new DatabaseSync(nextPath);
  dbPath = nextPath;
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cached_notes (
      column_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at INTEGER,
      event_json TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (column_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cached_notes_col ON cached_notes(column_id, created_at);
  `);
  return db;
}

export function getStateValue(key) {
  const row = prep('SELECT value FROM state WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setStateValue(key, value) {
  prep(`
    INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

export function getCachedNotes(columnId, limit = 500) {
  return prep('SELECT event_json FROM cached_notes WHERE column_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(columnId, limit)
    .map((row) => JSON.parse(row.event_json));
}

// Replace a column's cached snapshot with the events the client currently holds.
export function setCachedNotes(columnId, events) {
  const database = getDb();
  const rows = (Array.isArray(events) ? events : [])
    .filter((event) => event && event.id)
    .slice(0, 500);
  const del = prep('DELETE FROM cached_notes WHERE column_id = ?');
  const insert = prep(
    'INSERT OR REPLACE INTO cached_notes (column_id, event_id, created_at, event_json) VALUES (?, ?, ?, ?)'
  );
  database.exec('BEGIN');
  try {
    del.run(columnId);
    for (const event of rows) {
      insert.run(columnId, String(event.id), Number(event.created_at ?? 0), JSON.stringify(event));
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

export function deleteCachedNotes(columnId) {
  prep('DELETE FROM cached_notes WHERE column_id = ?').run(columnId);
}

export function closeDbForTests() {
  if (db) db.close();
  db = null;
  dbPath = null;
  stmtCache.clear();
}
