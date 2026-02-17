import type Database from 'better-sqlite3';
import { migrations } from './migrations/index.js';

/**
 * Run all pending migrations against the database.
 * Each migration runs in its own transaction. Returns the count of migrations applied.
 */
export function runMigrations(db: Database.Database): number {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Initialize version row if missing
  const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as
    | { version: number }
    | undefined;
  if (!row) {
    db.prepare('INSERT INTO schema_version (id, version) VALUES (1, 0)').run();
  }

  const currentVersion = (
    db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number }
  ).version;

  let applied = 0;

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    const runInTransaction = db.transaction(() => {
      migration.up(db);
      db.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(migration.version);
    });

    runInTransaction();
    applied++;
    console.log(`Migration ${migration.version} applied`);
  }

  return applied;
}
