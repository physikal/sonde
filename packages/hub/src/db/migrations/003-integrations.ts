import type Database from 'better-sqlite3';

export const version = 3;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE,
      config_encrypted TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_tested_at TEXT,
      last_test_result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
