import type Database from 'better-sqlite3';

export const version = 11;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
