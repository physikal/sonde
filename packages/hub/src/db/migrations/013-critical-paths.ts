import type Database from 'better-sqlite3';

export const version = 13;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS critical_paths (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS critical_path_steps (
      id TEXT PRIMARY KEY,
      path_id TEXT NOT NULL REFERENCES critical_paths(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      label TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('agent', 'integration')),
      target_id TEXT NOT NULL,
      probes_json TEXT DEFAULT '[]',
      UNIQUE(path_id, step_order)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_critical_path_steps_path_id ON critical_path_steps(path_id)
  `);
}
