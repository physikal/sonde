import type Database from 'better-sqlite3';

export const version = 8;

export function up(db: Database.Database): void {
  db.exec(`ALTER TABLE api_keys ADD COLUMN key_type TEXT NOT NULL DEFAULT 'mcp'`);
  db.exec(`UPDATE api_keys SET key_type = 'agent' WHERE name LIKE 'agent:%'`);
}
