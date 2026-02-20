import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { decrypt, encrypt } from '../integrations/crypto.js';
import { runMigrations } from './migrator.js';

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

export interface IntegrationRow {
  id: string;
  type: string;
  name: string;
  configEncrypted: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRow {
  id: string;
  authMethod: string;
  userId: string;
  email: string | null;
  displayName: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export interface SsoConfigRow {
  id: string;
  tenantId: string;
  clientId: string;
  clientSecretEnc: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizedUserRow {
  id: string;
  email: string;
  roleId: string;
  displayName: string;
  entraObjectId: string | null;
  enabled: boolean;
  createdBy: string;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
}

export interface AuthorizedGroupRow {
  id: string;
  entraGroupId: string;
  entraGroupName: string;
  roleId: string;
  createdAt: string;
  createdBy: string;
}

export interface RoleRow {
  id: string;
  displayName: string;
  level: number;
  permissionsJson: string;
}

export interface AccessGroupRow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
}

export interface LocalAdminRow {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export interface IntegrationEventRow {
  id: number;
  integrationId: string;
  eventType: string;
  status: string | null;
  message: string | null;
  detailJson: string | null;
  createdAt: string;
}

export interface IntegrationEventWithName extends IntegrationEventRow {
  integrationName: string;
  integrationType: string;
}

export interface AuditEntryWithAgentName {
  id: number;
  timestamp: string;
  apiKeyId: string;
  apiKeyName: string | null;
  agentId: string;
  probe: string;
  status: string;
  durationMs: number;
  requestJson: string | null;
  responseJson: string | null;
  agentName: string | null;
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
    runMigrations(this.db);
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

  getAuditEntries(opts?: {
    agentId?: string;
    apiKeyId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Array<{
    id: number;
    timestamp: string;
    apiKeyId: string;
    apiKeyName: string | null;
    agentId: string;
    probe: string;
    status: string;
    durationMs: number;
    requestJson: string | null;
    responseJson: string | null;
  }> {
    const limit = opts?.limit ?? 50;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.agentId) {
      conditions.push('al.agent_id = ?');
      params.push(opts.agentId);
    }
    if (opts?.apiKeyId) {
      conditions.push('al.api_key_id = ?');
      params.push(opts.apiKeyId);
    }
    if (opts?.startDate) {
      conditions.push('al.timestamp >= ?');
      params.push(opts.startDate);
    }
    if (opts?.endDate) {
      conditions.push('al.timestamp <= ?');
      params.push(opts.endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT al.id, al.timestamp, al.api_key_id, ak.name AS api_key_name, al.agent_id, al.probe, al.status, al.duration_ms, al.request_json, al.response_json FROM audit_log al LEFT JOIN api_keys ak ON al.api_key_id = ak.id ${where} ORDER BY al.id DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      timestamp: string;
      api_key_id: string;
      api_key_name: string | null;
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
      apiKeyId: r.api_key_id,
      apiKeyName: r.api_key_name,
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

  getCa(secret?: string): { certPem: string; keyPem: string } | undefined {
    const row = this.db
      .prepare('SELECT cert_pem, key_pem, key_pem_enc FROM hub_ca WHERE id = 1')
      .get() as
      | { cert_pem: string; key_pem: string | null; key_pem_enc: string | null }
      | undefined;
    if (!row) return undefined;

    // Prefer encrypted key; fall back to plaintext for backward compatibility
    let keyPem: string;
    if (row.key_pem_enc && secret) {
      keyPem = decrypt(row.key_pem_enc, secret);
    } else if (row.key_pem) {
      keyPem = row.key_pem;
    } else {
      return undefined;
    }

    return { certPem: row.cert_pem, keyPem };
  }

  storeCa(certPem: string, keyPem: string, secret?: string): void {
    if (secret) {
      const keyPemEnc = encrypt(keyPem, secret);
      this.db
        .prepare(
          'INSERT OR REPLACE INTO hub_ca (id, cert_pem, key_pem, key_pem_enc, created_at) VALUES (1, ?, NULL, ?, ?)',
        )
        .run(certPem, keyPemEnc, new Date().toISOString());
    } else {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO hub_ca (id, cert_pem, key_pem, created_at) VALUES (1, ?, ?, ?)',
        )
        .run(certPem, keyPem, new Date().toISOString());
    }
  }

  createEnrollmentToken(token: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO enrollment_tokens (token, created_at, expires_at) VALUES (?, ?, ?)')
      .run(token, new Date().toISOString(), expiresAt);
  }

  listEnrollmentTokens(): Array<{
    token: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    usedByAgent: string | null;
    status: 'active' | 'used' | 'expired';
  }> {
    const rows = this.db
      .prepare(
        'SELECT token, created_at, expires_at, used_at, used_by_agent FROM enrollment_tokens ORDER BY created_at DESC',
      )
      .all() as Array<{
      token: string;
      created_at: string;
      expires_at: string;
      used_at: string | null;
      used_by_agent: string | null;
    }>;
    const now = new Date();
    return rows.map((r) => {
      let status: 'active' | 'used' | 'expired' = 'active';
      if (r.used_at) status = 'used';
      else if (new Date(r.expires_at) < now) status = 'expired';
      return {
        // Mask active tokens — only show prefix for identification
        token: status === 'active' ? `${r.token.slice(0, 8)}...` : r.token,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        usedByAgent: r.used_by_agent,
        status,
      };
    });
  }

  /** Check if an enrollment token is valid without consuming it. */
  isValidEnrollmentToken(token: string): boolean {
    const row = this.db.prepare('SELECT * FROM enrollment_tokens WHERE token = ?').get(token) as
      | { token: string; expires_at: string; used_at: string | null }
      | undefined;
    if (!row) return false;
    if (row.used_at) return false;
    if (new Date(row.expires_at) < new Date()) return false;
    return true;
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

  countApiKeys(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL')
      .get() as { count: number };
    return row.count;
  }

  createApiKey(
    id: string,
    name: string,
    keyHash: string,
    policyJson: string,
    roleId?: string,
    keyType: 'mcp' | 'agent' = 'mcp',
  ): void {
    this.db
      .prepare(
        'INSERT INTO api_keys (id, name, key_hash, policy_json, role_id, key_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, name, keyHash, policyJson, roleId ?? 'member', keyType, new Date().toISOString());
  }

  rotateApiKey(id: string, newKeyHash: string): boolean {
    const result = this.db
      .prepare('UPDATE api_keys SET key_hash = ? WHERE id = ? AND revoked_at IS NULL')
      .run(newKeyHash, id);
    return result.changes > 0;
  }

  getApiKeyByHash(keyHash: string):
    | {
        id: string;
        name: string;
        policyJson: string;
        expiresAt: string | null;
        revokedAt: string | null;
        roleId: string;
      }
    | undefined {
    const row = this.db
      .prepare(
        'SELECT id, name, policy_json, expires_at, revoked_at, role_id FROM api_keys WHERE key_hash = ?',
      )
      .get(keyHash) as
      | {
          id: string;
          name: string;
          policy_json: string;
          expires_at: string | null;
          revoked_at: string | null;
          role_id: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      policyJson: row.policy_json,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      roleId: row.role_id ?? 'member',
    };
  }

  revokeApiKey(id: string): void {
    this.db
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  updateApiKeyPolicy(id: string, policyJson: string): boolean {
    const result = this.db
      .prepare('UPDATE api_keys SET policy_json = ? WHERE id = ?')
      .run(policyJson, id);
    return result.changes > 0;
  }

  updateApiKeyLastUsed(id: string): void {
    this.db
      .prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  listApiKeys(): Array<{
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    policyJson: string;
    lastUsedAt: string | null;
    keyType: 'mcp' | 'agent';
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, name, policy_json, created_at, expires_at, revoked_at, last_used_at, key_type FROM api_keys',
      )
      .all() as Array<{
      id: string;
      name: string;
      policy_json: string;
      created_at: string;
      expires_at: string | null;
      revoked_at: string | null;
      last_used_at: string | null;
      key_type: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      policyJson: r.policy_json,
      lastUsedAt: r.last_used_at,
      keyType: (r.key_type === 'agent' ? 'agent' : 'mcp') as 'mcp' | 'agent',
    }));
  }

  // --- Owner-scoped API key methods ---

  createApiKeyWithOwner(
    id: string,
    name: string,
    keyHash: string,
    policyJson: string,
    roleId: string,
    keyType: 'mcp' | 'agent',
    ownerId: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO api_keys (id, name, key_hash, policy_json, role_id, key_type, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, name, keyHash, policyJson, roleId, keyType, ownerId, new Date().toISOString());
  }

  listApiKeysByOwner(ownerId: string): Array<{
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    policyJson: string;
    lastUsedAt: string | null;
    keyType: 'mcp' | 'agent';
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, name, policy_json, created_at, expires_at, revoked_at, last_used_at, key_type FROM api_keys WHERE owner_id = ? AND revoked_at IS NULL',
      )
      .all(ownerId) as Array<{
      id: string;
      name: string;
      policy_json: string;
      created_at: string;
      expires_at: string | null;
      revoked_at: string | null;
      last_used_at: string | null;
      key_type: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      policyJson: r.policy_json,
      lastUsedAt: r.last_used_at,
      keyType: (r.key_type === 'agent' ? 'agent' : 'mcp') as 'mcp' | 'agent',
    }));
  }

  countApiKeysByOwner(ownerId: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as count FROM api_keys WHERE owner_id = ? AND revoked_at IS NULL',
      )
      .get(ownerId) as { count: number };
    return row.count;
  }

  getApiKeyOwner(id: string): string | null {
    const row = this.db
      .prepare('SELECT owner_id FROM api_keys WHERE id = ?')
      .get(id) as { owner_id: string | null } | undefined;
    return row?.owner_id ?? null;
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

  // --- Hub Settings ---

  getHubSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setHubSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO hub_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, value, new Date().toISOString());
  }

  // --- Integrations ---

  createIntegration(row: IntegrationRow): void {
    this.db
      .prepare(
        'INSERT INTO integrations (id, type, name, config_encrypted, status, last_tested_at, last_test_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.id,
        row.type,
        row.name,
        row.configEncrypted,
        row.status,
        row.lastTestedAt,
        row.lastTestResult,
        row.createdAt,
        row.updatedAt,
      );
  }

  getIntegration(id: string): IntegrationRow | undefined {
    const row = this.db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      type: row.type as string,
      name: row.name as string,
      configEncrypted: row.config_encrypted as string,
      status: row.status as string,
      lastTestedAt: row.last_tested_at as string | null,
      lastTestResult: row.last_test_result as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  listIntegrations(): IntegrationRow[] {
    const rows = this.db.prepare('SELECT * FROM integrations').all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: row.id as string,
      type: row.type as string,
      name: row.name as string,
      configEncrypted: row.config_encrypted as string,
      status: row.status as string,
      lastTestedAt: row.last_tested_at as string | null,
      lastTestResult: row.last_test_result as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  updateIntegration(
    id: string,
    fields: {
      configEncrypted?: string;
      status?: string;
      lastTestedAt?: string;
      lastTestResult?: string;
    },
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.configEncrypted !== undefined) {
      sets.push('config_encrypted = ?');
      params.push(fields.configEncrypted);
    }
    if (fields.status !== undefined) {
      sets.push('status = ?');
      params.push(fields.status);
    }
    if (fields.lastTestedAt !== undefined) {
      sets.push('last_tested_at = ?');
      params.push(fields.lastTestedAt);
    }
    if (fields.lastTestResult !== undefined) {
      sets.push('last_test_result = ?');
      params.push(fields.lastTestResult);
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const result = this.db
      .prepare(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  deleteIntegration(id: string): boolean {
    const result = this.db.prepare('DELETE FROM integrations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- Sessions ---

  createSession(session: {
    id: string;
    authMethod: string;
    userId: string;
    email?: string | null;
    displayName: string;
    role: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO sessions (id, auth_method, user_id, email, display_name, role, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        session.id,
        session.authMethod,
        session.userId,
        session.email ?? null,
        session.displayName,
        session.role,
        session.expiresAt,
      );
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      authMethod: row.auth_method as string,
      userId: row.user_id as string,
      email: row.email as string | null,
      displayName: row.display_name as string,
      role: row.role as string,
      expiresAt: row.expires_at as string,
      createdAt: row.created_at as string,
    };
  }

  deleteSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  touchSession(id: string, newExpiresAt: string): boolean {
    const result = this.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run(newExpiresAt, id);
    return result.changes > 0;
  }

  cleanExpiredSessions(): number {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE expires_at < ?')
      .run(new Date().toISOString());
    return result.changes;
  }

  // --- SSO Config ---

  getSsoConfig(): SsoConfigRow | undefined {
    const row = this.db.prepare('SELECT * FROM sso_config WHERE id = ?').get('entra') as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      clientId: row.client_id as string,
      clientSecretEnc: row.client_secret_enc as string,
      enabled: (row.enabled as number) === 1,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  upsertSsoConfig(
    tenantId: string,
    clientId: string,
    clientSecretEnc: string,
    enabled: boolean,
  ): void {
    this.db
      .prepare(
        `INSERT INTO sso_config (id, tenant_id, client_id, client_secret_enc, enabled, created_at, updated_at)
         VALUES ('entra', ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           client_id = excluded.client_id,
           client_secret_enc = excluded.client_secret_enc,
           enabled = excluded.enabled,
           updated_at = datetime('now')`,
      )
      .run(tenantId, clientId, clientSecretEnc, enabled ? 1 : 0);
  }

  // --- Authorized Users ---

  getAuthorizedUserByEmail(email: string): AuthorizedUserRow | undefined {
    const row = this.db.prepare('SELECT * FROM authorized_users WHERE email = ?').get(email) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.mapAuthorizedUserRow(row);
  }

  getAuthorizedUserByOid(oid: string): AuthorizedUserRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM authorized_users WHERE entra_object_id = ?')
      .get(oid) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.mapAuthorizedUserRow(row);
  }

  listAuthorizedUsers(): AuthorizedUserRow[] {
    const rows = this.db
      .prepare('SELECT * FROM authorized_users ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapAuthorizedUserRow(row));
  }

  createAuthorizedUser(
    id: string,
    email: string,
    roleId: string,
    opts?: {
      displayName?: string;
      entraObjectId?: string;
      createdBy?: string;
    },
  ): void {
    this.db
      .prepare(
        'INSERT INTO authorized_users (id, email, role_id, display_name, entra_object_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        email,
        roleId,
        opts?.displayName ?? '',
        opts?.entraObjectId ?? null,
        opts?.createdBy ?? 'manual',
      );
  }

  updateAuthorizedUserRole(id: string, roleId: string): boolean {
    const result = this.db
      .prepare('UPDATE authorized_users SET role_id = ? WHERE id = ?')
      .run(roleId, id);
    return result.changes > 0;
  }

  updateAuthorizedUserLogin(
    id: string,
    fields: {
      displayName?: string;
      entraObjectId?: string;
    },
  ): void {
    const sets: string[] = ['last_login_at = ?', 'login_count = login_count + 1'];
    const params: unknown[] = [new Date().toISOString()];

    if (fields.displayName !== undefined) {
      sets.push('display_name = ?');
      params.push(fields.displayName);
    }
    if (fields.entraObjectId !== undefined) {
      sets.push('entra_object_id = ?');
      params.push(fields.entraObjectId);
    }

    params.push(id);
    this.db.prepare(`UPDATE authorized_users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  updateAuthorizedUserEnabled(id: string, enabled: boolean): boolean {
    const result = this.db
      .prepare('UPDATE authorized_users SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id);
    return result.changes > 0;
  }

  deleteAuthorizedUser(id: string): boolean {
    const result = this.db.prepare('DELETE FROM authorized_users WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private mapAuthorizedUserRow(row: Record<string, unknown>): AuthorizedUserRow {
    return {
      id: row.id as string,
      email: row.email as string,
      roleId: row.role_id as string,
      displayName: (row.display_name as string) ?? '',
      entraObjectId: (row.entra_object_id as string) ?? null,
      enabled: (row.enabled as number) !== 0,
      createdBy: (row.created_by as string) ?? 'manual',
      lastLoginAt: (row.last_login_at as string) ?? null,
      loginCount: (row.login_count as number) ?? 0,
      createdAt: row.created_at as string,
    };
  }

  // --- Roles ---

  getRole(id: string): RoleRow | undefined {
    const row = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      displayName: row.display_name as string,
      level: row.level as number,
      permissionsJson: row.permissions_json as string,
    };
  }

  listRoles(): RoleRow[] {
    const rows = this.db.prepare('SELECT * FROM roles ORDER BY level ASC').all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: row.id as string,
      displayName: row.display_name as string,
      level: row.level as number,
      permissionsJson: row.permissions_json as string,
    }));
  }

  // --- Authorized Groups ---

  createAuthorizedGroup(
    id: string,
    entraGroupId: string,
    entraGroupName: string,
    roleId: string,
    createdBy?: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO authorized_groups (id, entra_group_id, entra_group_name, role_id, created_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, entraGroupId, entraGroupName, roleId, createdBy ?? 'manual');
  }

  getAuthorizedGroupByEntraId(entraGroupId: string): AuthorizedGroupRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM authorized_groups WHERE entra_group_id = ?')
      .get(entraGroupId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.mapAuthorizedGroupRow(row);
  }

  listAuthorizedGroups(): AuthorizedGroupRow[] {
    const rows = this.db
      .prepare('SELECT * FROM authorized_groups ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapAuthorizedGroupRow(row));
  }

  updateAuthorizedGroupRole(id: string, roleId: string): boolean {
    const result = this.db
      .prepare('UPDATE authorized_groups SET role_id = ? WHERE id = ?')
      .run(roleId, id);
    return result.changes > 0;
  }

  deleteAuthorizedGroup(id: string): boolean {
    const result = this.db.prepare('DELETE FROM authorized_groups WHERE id = ?').run(id);
    return result.changes > 0;
  }

  countAuthorizedGroups(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM authorized_groups').get() as {
      count: number;
    };
    return row.count;
  }

  private mapAuthorizedGroupRow(row: Record<string, unknown>): AuthorizedGroupRow {
    return {
      id: row.id as string,
      entraGroupId: row.entra_group_id as string,
      entraGroupName: row.entra_group_name as string,
      roleId: row.role_id as string,
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
    };
  }

  // --- Access Groups ---

  createAccessGroup(id: string, name: string, description: string, createdBy?: string): void {
    this.db
      .prepare('INSERT INTO access_groups (id, name, description, created_by) VALUES (?, ?, ?, ?)')
      .run(id, name, description, createdBy ?? 'manual');
  }

  getAccessGroup(id: string): AccessGroupRow | undefined {
    const row = this.db.prepare('SELECT * FROM access_groups WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
    };
  }

  listAccessGroups(): AccessGroupRow[] {
    const rows = this.db.prepare('SELECT * FROM access_groups ORDER BY name ASC').all() as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
    }));
  }

  updateAccessGroup(id: string, fields: { name?: string; description?: string }): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.name !== undefined) {
      sets.push('name = ?');
      params.push(fields.name);
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      params.push(fields.description);
    }
    if (sets.length === 0) return false;

    params.push(id);
    const result = this.db
      .prepare(`UPDATE access_groups SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  deleteAccessGroup(id: string): boolean {
    const result = this.db.prepare('DELETE FROM access_groups WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Access group sub-resources

  addAccessGroupAgent(accessGroupId: string, agentPattern: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO access_group_agents (access_group_id, agent_pattern) VALUES (?, ?)',
      )
      .run(accessGroupId, agentPattern);
  }

  removeAccessGroupAgent(accessGroupId: string, agentPattern: string): boolean {
    const result = this.db
      .prepare('DELETE FROM access_group_agents WHERE access_group_id = ? AND agent_pattern = ?')
      .run(accessGroupId, agentPattern);
    return result.changes > 0;
  }

  getAccessGroupAgents(accessGroupId: string): Array<{ agentPattern: string }> {
    const rows = this.db
      .prepare('SELECT agent_pattern FROM access_group_agents WHERE access_group_id = ?')
      .all(accessGroupId) as Array<{ agent_pattern: string }>;
    return rows.map((r) => ({ agentPattern: r.agent_pattern }));
  }

  addAccessGroupIntegration(accessGroupId: string, integrationId: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO access_group_integrations (access_group_id, integration_id) VALUES (?, ?)',
      )
      .run(accessGroupId, integrationId);
  }

  removeAccessGroupIntegration(accessGroupId: string, integrationId: string): boolean {
    const result = this.db
      .prepare(
        'DELETE FROM access_group_integrations WHERE access_group_id = ? AND integration_id = ?',
      )
      .run(accessGroupId, integrationId);
    return result.changes > 0;
  }

  getAccessGroupIntegrations(accessGroupId: string): Array<{ integrationId: string }> {
    const rows = this.db
      .prepare('SELECT integration_id FROM access_group_integrations WHERE access_group_id = ?')
      .all(accessGroupId) as Array<{ integration_id: string }>;
    return rows.map((r) => ({ integrationId: r.integration_id }));
  }

  addAccessGroupUser(accessGroupId: string, userId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO access_group_users (access_group_id, user_id) VALUES (?, ?)')
      .run(accessGroupId, userId);
  }

  removeAccessGroupUser(accessGroupId: string, userId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM access_group_users WHERE access_group_id = ? AND user_id = ?')
      .run(accessGroupId, userId);
    return result.changes > 0;
  }

  getAccessGroupUsers(accessGroupId: string): Array<{ userId: string }> {
    const rows = this.db
      .prepare('SELECT user_id FROM access_group_users WHERE access_group_id = ?')
      .all(accessGroupId) as Array<{ user_id: string }>;
    return rows.map((r) => ({ userId: r.user_id }));
  }

  /** Get all access groups a user is assigned to. */
  getAccessGroupsForUser(userId: string): AccessGroupRow[] {
    const rows = this.db
      .prepare(
        `SELECT ag.* FROM access_groups ag
         INNER JOIN access_group_users agu ON ag.id = agu.access_group_id
         WHERE agu.user_id = ?`,
      )
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
    }));
  }

  // --- Integration Events ---

  logIntegrationEvent(event: {
    integrationId: string;
    eventType: string;
    status?: string;
    message?: string;
    detailJson?: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO integration_events (integration_id, event_type, status, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        event.integrationId,
        event.eventType,
        event.status ?? null,
        event.message ?? null,
        event.detailJson ?? null,
        new Date().toISOString(),
      );
  }

  getIntegrationEvents(
    integrationId: string,
    opts?: { limit?: number; offset?: number },
  ): IntegrationEventRow[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const rows = this.db
      .prepare(
        'SELECT * FROM integration_events WHERE integration_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      )
      .all(integrationId, limit, offset) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as number,
      integrationId: row.integration_id as string,
      eventType: row.event_type as string,
      status: (row.status as string) ?? null,
      message: (row.message as string) ?? null,
      detailJson: (row.detail_json as string) ?? null,
      createdAt: row.created_at as string,
    }));
  }

  getRecentIntegrationEventsAll(limit: number): IntegrationEventWithName[] {
    const rows = this.db
      .prepare(
        `SELECT ie.id, ie.integration_id, ie.event_type, ie.status, ie.message,
                ie.detail_json, ie.created_at, i.name AS integration_name, i.type AS integration_type
         FROM integration_events ie
         JOIN integrations i ON ie.integration_id = i.id
         ORDER BY ie.id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as number,
      integrationId: row.integration_id as string,
      eventType: row.event_type as string,
      status: (row.status as string) ?? null,
      message: (row.message as string) ?? null,
      detailJson: (row.detail_json as string) ?? null,
      createdAt: row.created_at as string,
      integrationName: row.integration_name as string,
      integrationType: row.integration_type as string,
    }));
  }

  getAuditEntriesWithNames(limit: number): AuditEntryWithAgentName[] {
    const rows = this.db
      .prepare(
        `SELECT al.id, al.timestamp, al.api_key_id, ak.name AS api_key_name,
                al.agent_id, al.probe, al.status,
                al.duration_ms, al.request_json, al.response_json,
                a.name AS agent_name
         FROM audit_log al
         INNER JOIN agents a ON al.agent_id = a.id
         LEFT JOIN api_keys ak ON al.api_key_id = ak.id
         ORDER BY al.id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: r.id as number,
      timestamp: r.timestamp as string,
      apiKeyId: r.api_key_id as string,
      apiKeyName: (r.api_key_name as string) ?? null,
      agentId: r.agent_id as string,
      probe: r.probe as string,
      status: r.status as string,
      durationMs: r.duration_ms as number,
      requestJson: (r.request_json as string) ?? null,
      responseJson: (r.response_json as string) ?? null,
      agentName: (r.agent_name as string) ?? null,
    }));
  }

  // --- Agent Tags ---

  getAgentTags(agentId: string): string[] {
    const rows = this.db
      .prepare('SELECT tag FROM agent_tags WHERE agent_id = ? ORDER BY tag')
      .all(agentId) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  setAgentTags(agentId: string, tags: string[]): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM agent_tags WHERE agent_id = ?')
        .run(agentId);
      const insert = this.db.prepare(
        'INSERT INTO agent_tags (agent_id, tag) VALUES (?, ?)',
      );
      for (const tag of tags) {
        insert.run(agentId, tag);
      }
    });
    tx();
  }

  addAgentTags(agentIds: string[], tags: string[]): void {
    const tx = this.db.transaction(() => {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO agent_tags (agent_id, tag) VALUES (?, ?)',
      );
      for (const id of agentIds) {
        for (const tag of tags) {
          insert.run(id, tag);
        }
      }
    });
    tx();
  }

  removeAgentTags(agentIds: string[], tags: string[]): void {
    const tx = this.db.transaction(() => {
      const del = this.db.prepare(
        'DELETE FROM agent_tags WHERE agent_id = ? AND tag = ?',
      );
      for (const id of agentIds) {
        for (const tag of tags) {
          del.run(id, tag);
        }
      }
    });
    tx();
  }

  getAllAgentTags(): Map<string, string[]> {
    const rows = this.db
      .prepare('SELECT agent_id, tag FROM agent_tags ORDER BY agent_id, tag')
      .all() as Array<{ agent_id: string; tag: string }>;
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const existing = map.get(row.agent_id);
      if (existing) {
        existing.push(row.tag);
      } else {
        map.set(row.agent_id, [row.tag]);
      }
    }
    return map;
  }

  // --- Integration Tags ---

  getIntegrationTags(integrationId: string): string[] {
    const rows = this.db
      .prepare('SELECT tag FROM integration_tags WHERE integration_id = ? ORDER BY tag')
      .all(integrationId) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  setIntegrationTags(integrationId: string, tags: string[]): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM integration_tags WHERE integration_id = ?')
        .run(integrationId);
      const insert = this.db.prepare(
        'INSERT INTO integration_tags (integration_id, tag) VALUES (?, ?)',
      );
      for (const tag of tags) {
        insert.run(integrationId, tag);
      }
    });
    tx();
  }

  addIntegrationTags(integrationIds: string[], tags: string[]): void {
    const tx = this.db.transaction(() => {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO integration_tags (integration_id, tag) VALUES (?, ?)',
      );
      for (const id of integrationIds) {
        for (const tag of tags) {
          insert.run(id, tag);
        }
      }
    });
    tx();
  }

  removeIntegrationTags(integrationIds: string[], tags: string[]): void {
    const tx = this.db.transaction(() => {
      const del = this.db.prepare(
        'DELETE FROM integration_tags WHERE integration_id = ? AND tag = ?',
      );
      for (const id of integrationIds) {
        for (const tag of tags) {
          del.run(id, tag);
        }
      }
    });
    tx();
  }

  /** Returns all unique tags with per-source (agent/integration) counts. */
  getAllTagsWithCounts(): Array<{
    tag: string;
    agentCount: number;
    integrationCount: number;
    totalCount: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT tag, source, COUNT(*) as cnt FROM (
           SELECT tag, 'agent' as source FROM agent_tags
           UNION ALL
           SELECT tag, 'integration' as source FROM integration_tags
         ) GROUP BY tag, source ORDER BY tag`,
      )
      .all() as Array<{ tag: string; source: string; cnt: number }>;

    const map = new Map<string, { agentCount: number; integrationCount: number }>();
    for (const row of rows) {
      const entry = map.get(row.tag) ?? { agentCount: 0, integrationCount: 0 };
      if (row.source === 'agent') {
        entry.agentCount = row.cnt;
      } else {
        entry.integrationCount = row.cnt;
      }
      map.set(row.tag, entry);
    }

    return [...map.entries()].map(([tag, counts]) => ({
      tag,
      agentCount: counts.agentCount,
      integrationCount: counts.integrationCount,
      totalCount: counts.agentCount + counts.integrationCount,
    }));
  }

  /** Deletes a tag from all agents and integrations. Returns rows affected per source. */
  deleteTagGlobally(tag: string): { agents: number; integrations: number } {
    let agents = 0;
    let integrations = 0;
    const tx = this.db.transaction(() => {
      agents = this.db
        .prepare('DELETE FROM agent_tags WHERE tag = ?')
        .run(tag).changes;
      integrations = this.db
        .prepare('DELETE FROM integration_tags WHERE tag = ?')
        .run(tag).changes;
    });
    tx();
    return { agents, integrations };
  }

  /**
   * Renames a tag globally across agents and integrations.
   * Handles merge: if an entity already has newTag, the old row is just removed.
   */
  renameTagGlobally(
    oldTag: string,
    newTag: string,
  ): { agents: number; integrations: number } {
    let agents = 0;
    let integrations = 0;
    const tx = this.db.transaction(() => {
      // Insert newTag for each entity that has oldTag (ignore if already exists)
      this.db
        .prepare(
          'INSERT OR IGNORE INTO agent_tags (agent_id, tag) SELECT agent_id, ? FROM agent_tags WHERE tag = ?',
        )
        .run(newTag, oldTag);
      this.db
        .prepare(
          'INSERT OR IGNORE INTO integration_tags (integration_id, tag) SELECT integration_id, ? FROM integration_tags WHERE tag = ?',
        )
        .run(newTag, oldTag);

      // Delete old tag rows
      agents = this.db
        .prepare('DELETE FROM agent_tags WHERE tag = ?')
        .run(oldTag).changes;
      integrations = this.db
        .prepare('DELETE FROM integration_tags WHERE tag = ?')
        .run(oldTag).changes;
    });
    tx();
    return { agents, integrations };
  }

  getAllIntegrationTags(): Map<string, string[]> {
    const rows = this.db
      .prepare('SELECT integration_id, tag FROM integration_tags ORDER BY integration_id, tag')
      .all() as Array<{ integration_id: string; tag: string }>;
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const existing = map.get(row.integration_id);
      if (existing) {
        existing.push(row.tag);
      } else {
        map.set(row.integration_id, [row.tag]);
      }
    }
    return map;
  }

  // --- Local Admins ---

  createLocalAdmin(
    id: string,
    username: string,
    passwordHash: string,
    salt: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO local_admins (id, username, password_hash, salt) VALUES (?, ?, ?, ?)',
      )
      .run(id, username, passwordHash, salt);
  }

  getLocalAdminByUsername(username: string): LocalAdminRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM local_admins WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      username: row.username as string,
      passwordHash: row.password_hash as string,
      salt: row.salt as string,
      createdAt: row.created_at as string,
    };
  }

  hasLocalAdmin(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM local_admins')
      .get() as { count: number };
    return row.count > 0;
  }

  close(): void {
    this.db.close();
  }
}
