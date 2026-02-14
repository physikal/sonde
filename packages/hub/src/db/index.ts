import Database from 'better-sqlite3';

export interface AgentRow {
  id: string;
  name: string;
  status: string;
  lastSeen: string;
  os: string;
  agentVersion: string;
  packs: Array<{ name: string; version: string; status: string }>;
}

export interface AuditEntry {
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
        packs_json TEXT NOT NULL DEFAULT '[]'
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
        response_json TEXT
      )
    `);
  }

  upsertAgent(agent: AgentRow): void {
    this.db
      .prepare(`
      INSERT INTO agents (id, name, status, last_seen, os, agent_version, packs_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
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
    this.db
      .prepare(`
      INSERT INTO audit_log (timestamp, agent_id, probe, status, duration_ms, request_json, response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        new Date().toISOString(),
        entry.agentId,
        entry.probe,
        entry.status,
        entry.durationMs,
        entry.requestJson ?? null,
        entry.responseJson ?? null,
      );
  }

  close(): void {
    this.db.close();
  }
}
