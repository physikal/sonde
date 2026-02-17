import type Database from 'better-sqlite3';

export const version = 5;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_config (
      id TEXT PRIMARY KEY DEFAULT 'entra',
      tenant_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret_enc TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role_id TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
