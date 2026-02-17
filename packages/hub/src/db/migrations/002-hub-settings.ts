import type Database from 'better-sqlite3';

export const version = 2;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}
