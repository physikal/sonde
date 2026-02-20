import type Database from 'better-sqlite3';

export const version = 12;

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE api_keys ADD COLUMN owner_id TEXT;
    CREATE INDEX idx_api_keys_owner ON api_keys(owner_id);
  `);
}
