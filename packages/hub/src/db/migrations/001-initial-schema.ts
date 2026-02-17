import type Database from 'better-sqlite3';

export const version = 1;

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen TEXT NOT NULL,
      os TEXT NOT NULL DEFAULT '',
      agent_version TEXT NOT NULL DEFAULT '',
      packs_json TEXT NOT NULL DEFAULT '[]',
      cert_fingerprint TEXT NOT NULL DEFAULT '',
      attestation_json TEXT NOT NULL DEFAULT '{}',
      attestation_mismatch INTEGER NOT NULL DEFAULT 0,
      cert_pem TEXT NOT NULL DEFAULT ''
    )
  `);

  // Add columns to existing agents tables that lack them
  const cols = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('cert_fingerprint')) {
    db.exec("ALTER TABLE agents ADD COLUMN cert_fingerprint TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has('attestation_json')) {
    db.exec("ALTER TABLE agents ADD COLUMN attestation_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!colNames.has('attestation_mismatch')) {
    db.exec('ALTER TABLE agents ADD COLUMN attestation_mismatch INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.has('cert_pem')) {
    db.exec("ALTER TABLE agents ADD COLUMN cert_pem TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_ca (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cert_pem TEXT NOT NULL,
      key_pem TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS enrollment_tokens (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by_agent TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      api_key_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL,
      probe TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      request_json TEXT,
      response_json TEXT,
      prev_hash TEXT NOT NULL DEFAULT ''
    )
  `);

  // Add prev_hash column to existing audit_log tables
  const auditCols = db.prepare("PRAGMA table_info('audit_log')").all() as Array<{
    name: string;
  }>;
  const auditColNames = new Set(auditCols.map((c) => c.name));
  if (!auditColNames.has('prev_hash')) {
    db.exec("ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      policy_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    )
  `);

  // Add last_used_at column to existing api_keys tables
  const apiKeyCols = db.prepare("PRAGMA table_info('api_keys')").all() as Array<{
    name: string;
  }>;
  const apiKeyColNames = new Set(apiKeyCols.map((c) => c.name));
  if (!apiKeyColNames.has('last_used_at')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN last_used_at TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_secret_expires_at INTEGER,
      client_id_issued_at INTEGER NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      resource TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      resource TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS setup (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}
