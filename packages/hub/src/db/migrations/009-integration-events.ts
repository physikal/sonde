import type Database from 'better-sqlite3';

export const version = 9;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT,
      message TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX idx_integration_events_lookup
      ON integration_events (integration_id, created_at DESC)
  `);
}
