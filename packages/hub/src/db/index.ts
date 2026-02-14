import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export interface AgentRow {
  id: string;
  name: string;
  status: string;
  lastSeen: string;
  os: string;
  agentVersion: string;
  packs: Array<{ name: string; version: string; status: string }>;
  attestationJson?: string;
  attestationMismatch?: number;
  certPem?: string;
}

export interface AuditEntry {
  apiKeyId?: string;
  agentId: string;
  probe: string;
  status: string;
  durationMs: number;
  requestJson?: string;
  responseJson?: string;
}

export class SondeDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
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
    const cols = this.db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('cert_fingerprint')) {
      this.db.exec("ALTER TABLE agents ADD COLUMN cert_fingerprint TEXT NOT NULL DEFAULT ''");
    }
    if (!colNames.has('attestation_json')) {
      this.db.exec("ALTER TABLE agents ADD COLUMN attestation_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!colNames.has('attestation_mismatch')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN attestation_mismatch INTEGER NOT NULL DEFAULT 0');
    }
    if (!colNames.has('cert_pem')) {
      this.db.exec("ALTER TABLE agents ADD COLUMN cert_pem TEXT NOT NULL DEFAULT ''");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hub_ca (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cert_pem TEXT NOT NULL,
        key_pem TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        token TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by_agent TEXT
      )
    `);

    this.db.exec(`
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
    const auditCols = this.db.prepare("PRAGMA table_info('audit_log')").all() as Array<{
      name: string;
    }>;
    const auditColNames = new Set(auditCols.map((c) => c.name));
    if (!auditColNames.has('prev_hash')) {
      this.db.exec("ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL DEFAULT ''");
    }

    this.db.exec(`
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_secret TEXT,
        client_secret_expires_at INTEGER,
        client_id_issued_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      )
    `);

    this.db.exec(`
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        token TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        resource TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS setup (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  upsertAgent(agent: AgentRow): void {
    this.db
      .prepare(`
      INSERT INTO agents (id, name, status, last_seen, os, agent_version, packs_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        id = excluded.id,
        status = excluded.status,
        last_seen = excluded.last_seen,
        os = excluded.os,
        agent_version = excluded.agent_version,
        packs_json = excluded.packs_json
    `)
      .run(
        agent.id,
        agent.name,
        agent.status,
        agent.lastSeen,
        agent.os,
        agent.agentVersion,
        JSON.stringify(agent.packs),
      );
  }

  getAgent(nameOrId: string): AgentRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM agents WHERE id = ? OR name = ?')
      .get(nameOrId, nameOrId) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as string,
      lastSeen: row.last_seen as string,
      os: row.os as string,
      agentVersion: row.agent_version as string,
      packs: JSON.parse(row.packs_json as string) as AgentRow['packs'],
      attestationJson: row.attestation_json as string | undefined,
      attestationMismatch: row.attestation_mismatch as number | undefined,
      certPem: row.cert_pem as string | undefined,
    };
  }

  getAllAgents(): AgentRow[] {
    const rows = this.db.prepare('SELECT * FROM agents').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      status: row.status as string,
      lastSeen: row.last_seen as string,
      os: row.os as string,
      agentVersion: row.agent_version as string,
      packs: JSON.parse(row.packs_json as string) as AgentRow['packs'],
    }));
  }

  updateAgentStatus(id: string, status: string, lastSeen: string): void {
    this.db
      .prepare('UPDATE agents SET status = ?, last_seen = ? WHERE id = ?')
      .run(status, lastSeen, id);
  }

  logAudit(entry: AuditEntry): void {
    // Get last audit row to compute hash chain
    const lastRow = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;

    const prevHash = lastRow
      ? crypto.createHash('sha256').update(JSON.stringify(lastRow)).digest('hex')
      : '';

    this.db
      .prepare(`
      INSERT INTO audit_log (timestamp, api_key_id, agent_id, probe, status, duration_ms, request_json, response_json, prev_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        new Date().toISOString(),
        entry.apiKeyId ?? '',
        entry.agentId,
        entry.probe,
        entry.status,
        entry.durationMs,
        entry.requestJson ?? null,
        entry.responseJson ?? null,
        prevHash,
      );
  }

  getAuditEntries(opts?: { agentId?: string; limit?: number }): Array<{
    id: number;
    timestamp: string;
    agentId: string;
    probe: string;
    status: string;
    durationMs: number;
    requestJson: string | null;
    responseJson: string | null;
  }> {
    const limit = opts?.limit ?? 50;
    const agentId = opts?.agentId;

    const sql = agentId
      ? 'SELECT id, timestamp, agent_id, probe, status, duration_ms, request_json, response_json FROM audit_log WHERE agent_id = ? ORDER BY id DESC LIMIT ?'
      : 'SELECT id, timestamp, agent_id, probe, status, duration_ms, request_json, response_json FROM audit_log ORDER BY id DESC LIMIT ?';

    const rows = (
      agentId ? this.db.prepare(sql).all(agentId, limit) : this.db.prepare(sql).all(limit)
    ) as Array<{
      id: number;
      timestamp: string;
      agent_id: string;
      probe: string;
      status: string;
      duration_ms: number;
      request_json: string | null;
      response_json: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      agentId: r.agent_id,
      probe: r.probe,
      status: r.status,
      durationMs: r.duration_ms,
      requestJson: r.request_json,
      responseJson: r.response_json,
    }));
  }

  verifyAuditChain(): { valid: boolean; brokenAt?: number } {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all() as Array<
      Record<string, unknown>
    >;

    if (rows.length === 0) return { valid: true };

    // Genesis entry should have empty prev_hash
    const first = rows[0] as Record<string, unknown>;
    if (first.prev_hash !== '') {
      return { valid: false, brokenAt: first.id as number };
    }

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1] as Record<string, unknown>;
      const curr = rows[i] as Record<string, unknown>;
      const expectedHash = crypto.createHash('sha256').update(JSON.stringify(prev)).digest('hex');
      if (curr.prev_hash !== expectedHash) {
        return { valid: false, brokenAt: curr.id as number };
      }
    }

    return { valid: true };
  }

  getCa(): { certPem: string; keyPem: string } | undefined {
    const row = this.db.prepare('SELECT cert_pem, key_pem FROM hub_ca WHERE id = 1').get() as
      | { cert_pem: string; key_pem: string }
      | undefined;
    if (!row) return undefined;
    return { certPem: row.cert_pem, keyPem: row.key_pem };
  }

  storeCa(certPem: string, keyPem: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO hub_ca (id, cert_pem, key_pem, created_at) VALUES (1, ?, ?, ?)',
      )
      .run(certPem, keyPem, new Date().toISOString());
  }

  createEnrollmentToken(token: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO enrollment_tokens (token, created_at, expires_at) VALUES (?, ?, ?)')
      .run(token, new Date().toISOString(), expiresAt);
  }

  consumeEnrollmentToken(token: string, agentName: string): { valid: boolean; reason?: string } {
    const row = this.db.prepare('SELECT * FROM enrollment_tokens WHERE token = ?').get(token) as
      | { token: string; expires_at: string; used_at: string | null }
      | undefined;

    if (!row) return { valid: false, reason: 'Unknown token' };
    if (row.used_at) return { valid: false, reason: 'Token already used' };
    if (new Date(row.expires_at) < new Date()) return { valid: false, reason: 'Token expired' };

    this.db
      .prepare('UPDATE enrollment_tokens SET used_at = ?, used_by_agent = ? WHERE token = ?')
      .run(new Date().toISOString(), agentName, token);

    return { valid: true };
  }

  updateAgentCertFingerprint(agentId: string, fingerprint: string): void {
    this.db
      .prepare('UPDATE agents SET cert_fingerprint = ? WHERE id = ?')
      .run(fingerprint, agentId);
  }

  updateAgentAttestation(agentId: string, attestationJson: string, mismatch: boolean): void {
    this.db
      .prepare('UPDATE agents SET attestation_json = ?, attestation_mismatch = ? WHERE id = ?')
      .run(attestationJson, mismatch ? 1 : 0, agentId);
  }

  updateAgentCertPem(agentId: string, certPem: string): void {
    this.db.prepare('UPDATE agents SET cert_pem = ? WHERE id = ?').run(certPem, agentId);
  }

  getAgentCertPem(agentId: string): string | undefined {
    const row = this.db.prepare('SELECT cert_pem FROM agents WHERE id = ?').get(agentId) as
      | { cert_pem: string }
      | undefined;
    return row?.cert_pem || undefined;
  }

  // --- API Key management ---

  createApiKey(id: string, name: string, keyHash: string, policyJson: string): void {
    this.db
      .prepare(
        'INSERT INTO api_keys (id, name, key_hash, policy_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, name, keyHash, policyJson, new Date().toISOString());
  }

  getApiKeyByHash(keyHash: string):
    | {
        id: string;
        name: string;
        policyJson: string;
        expiresAt: string | null;
        revokedAt: string | null;
      }
    | undefined {
    const row = this.db
      .prepare(
        'SELECT id, name, policy_json, expires_at, revoked_at FROM api_keys WHERE key_hash = ?',
      )
      .get(keyHash) as
      | {
          id: string;
          name: string;
          policy_json: string;
          expires_at: string | null;
          revoked_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      policyJson: row.policy_json,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  revokeApiKey(id: string): void {
    this.db
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  listApiKeys(): Array<{
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
  }> {
    const rows = this.db
      .prepare('SELECT id, name, created_at, expires_at, revoked_at FROM api_keys')
      .all() as Array<{
      id: string;
      name: string;
      created_at: string;
      expires_at: string | null;
      revoked_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    }));
  }

  // --- OAuth stores ---

  getOAuthClient(clientId: string):
    | {
        client_id: string;
        client_secret?: string;
        client_secret_expires_at?: number;
        client_id_issued_at: number;
        metadata_json: string;
      }
    | undefined {
    return this.db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as
      | {
          client_id: string;
          client_secret?: string;
          client_secret_expires_at?: number;
          client_id_issued_at: number;
          metadata_json: string;
        }
      | undefined;
  }

  insertOAuthClient(
    clientId: string,
    clientSecret: string | null,
    clientSecretExpiresAt: number | null,
    clientIdIssuedAt: number,
    metadataJson: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO oauth_clients (client_id, client_secret, client_secret_expires_at, client_id_issued_at, metadata_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(clientId, clientSecret, clientSecretExpiresAt, clientIdIssuedAt, metadataJson);
  }

  insertOAuthCode(
    code: string,
    clientId: string,
    challenge: string,
    redirectUri: string,
    scopesJson: string,
    resource: string | null,
    createdAt: number,
    expiresAt: number,
  ): void {
    this.db
      .prepare(
        'INSERT INTO oauth_codes (code, client_id, challenge, redirect_uri, scopes_json, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(code, clientId, challenge, redirectUri, scopesJson, resource, createdAt, expiresAt);
  }

  getOAuthCode(code: string):
    | {
        code: string;
        client_id: string;
        challenge: string;
        redirect_uri: string;
        scopes_json: string;
        resource: string | null;
        created_at: number;
        expires_at: number;
      }
    | undefined {
    return this.db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(code) as
      | {
          code: string;
          client_id: string;
          challenge: string;
          redirect_uri: string;
          scopes_json: string;
          resource: string | null;
          created_at: number;
          expires_at: number;
        }
      | undefined;
  }

  deleteOAuthCode(code: string): void {
    this.db.prepare('DELETE FROM oauth_codes WHERE code = ?').run(code);
  }

  insertOAuthToken(
    token: string,
    clientId: string,
    scopesJson: string,
    resource: string | null,
    createdAt: number,
    expiresAt: number,
  ): void {
    this.db
      .prepare(
        'INSERT INTO oauth_tokens (token, client_id, scopes_json, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(token, clientId, scopesJson, resource, createdAt, expiresAt);
  }

  getOAuthToken(token: string):
    | {
        token: string;
        client_id: string;
        scopes_json: string;
        resource: string | null;
        created_at: number;
        expires_at: number;
      }
    | undefined {
    return this.db.prepare('SELECT * FROM oauth_tokens WHERE token = ?').get(token) as
      | {
          token: string;
          client_id: string;
          scopes_json: string;
          resource: string | null;
          created_at: number;
          expires_at: number;
        }
      | undefined;
  }

  deleteOAuthToken(token: string): void {
    this.db.prepare('DELETE FROM oauth_tokens WHERE token = ?').run(token);
  }

  // --- Setup ---

  getSetupValue(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM setup WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setSetupValue(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO setup (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, value, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
