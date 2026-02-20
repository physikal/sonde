import type Database from 'better-sqlite3';

export const version = 14;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS probe_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      probe TEXT NOT NULL,
      agent_or_source TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('agent', 'integration')),
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      caller_api_key_id TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probe_results_timestamp
      ON probe_results(timestamp)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probe_results_status_ts
      ON probe_results(status, timestamp)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probe_results_probe
      ON probe_results(probe, timestamp)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probe_results_source
      ON probe_results(agent_or_source, timestamp)
  `);
}
