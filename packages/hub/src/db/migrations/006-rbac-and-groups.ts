import type Database from 'better-sqlite3';

export const version = 6;

export function up(db: Database.Database): void {
  // Roles reference table
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      level INTEGER NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '[]'
    )
  `);

  // Seed the three roles
  db.exec(`
    INSERT OR IGNORE INTO roles (id, display_name, level, permissions_json) VALUES
      ('member', 'Member', 1, '["probe:execute","agent:read","integration:read"]'),
      ('admin', 'Admin', 2, '["probe:execute","agent:read","integration:read","agent:manage","integration:manage","user:read","user:manage","audit:read","policy:manage","enrollment:manage","apikey:manage"]'),
      ('owner', 'Owner', 3, '["probe:execute","agent:read","integration:read","agent:manage","integration:manage","user:read","user:manage","audit:read","policy:manage","enrollment:manage","apikey:manage","sso:manage","settings:manage","role:manage"]')
  `);

  // Extend authorized_users with new columns (idempotent via PRAGMA check)
  const cols = db.prepare("PRAGMA table_info('authorized_users')").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has('display_name')) {
    db.exec("ALTER TABLE authorized_users ADD COLUMN display_name TEXT DEFAULT ''");
  }
  if (!colNames.has('entra_object_id')) {
    db.exec('ALTER TABLE authorized_users ADD COLUMN entra_object_id TEXT');
  }
  if (!colNames.has('enabled')) {
    db.exec('ALTER TABLE authorized_users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!colNames.has('created_by')) {
    db.exec("ALTER TABLE authorized_users ADD COLUMN created_by TEXT DEFAULT 'manual'");
  }
  if (!colNames.has('last_login_at')) {
    db.exec('ALTER TABLE authorized_users ADD COLUMN last_login_at TEXT');
  }
  if (!colNames.has('login_count')) {
    db.exec('ALTER TABLE authorized_users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0');
  }

  // Create unique index on entra_object_id (partial — only non-null values)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_users_entra_oid
    ON authorized_users (entra_object_id)
    WHERE entra_object_id IS NOT NULL
  `);

  // Authorized groups (Entra security groups)
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_groups (
      id TEXT PRIMARY KEY,
      entra_group_id TEXT NOT NULL UNIQUE,
      entra_group_name TEXT NOT NULL DEFAULT '',
      role_id TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT NOT NULL DEFAULT 'manual'
    )
  `);

  // Access groups
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT NOT NULL DEFAULT 'manual'
    )
  `);

  // Access group → agent patterns
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_group_agents (
      access_group_id TEXT NOT NULL,
      agent_pattern TEXT NOT NULL,
      PRIMARY KEY (access_group_id, agent_pattern),
      FOREIGN KEY (access_group_id) REFERENCES access_groups(id) ON DELETE CASCADE
    )
  `);

  // Access group → integrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_group_integrations (
      access_group_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      PRIMARY KEY (access_group_id, integration_id),
      FOREIGN KEY (access_group_id) REFERENCES access_groups(id) ON DELETE CASCADE
    )
  `);

  // Access group → users
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_group_users (
      access_group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (access_group_id, user_id),
      FOREIGN KEY (access_group_id) REFERENCES access_groups(id) ON DELETE CASCADE
    )
  `);
}
