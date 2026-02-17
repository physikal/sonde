import type Database from 'better-sqlite3';

export const version = 4;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      auth_method TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add role_id column to api_keys (defaults to 'member')
  // SQLite ALTER TABLE ADD COLUMN is safe — column simply won't exist on old rows
  // but DEFAULT fills it.
  const cols = db.prepare("PRAGMA table_info('api_keys')").all() as Array<{ name: string }>;
  const hasRoleId = cols.some((c) => c.name === 'role_id');
  if (!hasRoleId) {
    db.exec("ALTER TABLE api_keys ADD COLUMN role_id TEXT DEFAULT 'member'");
  }
}
