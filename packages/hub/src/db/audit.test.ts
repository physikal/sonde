import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SondeDb } from './index.js';

describe('Audit hash chain', () => {
  it('genesis entry has empty prev_hash', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({
      agentId: 'agent-1',
      probe: 'system.disk.usage',
      status: 'success',
      durationMs: 42,
    });

    const rows = (db as unknown as { db: { prepare: (s: string) => { all: () => unknown[] } } }).db
      .prepare('SELECT * FROM audit_log ORDER BY id ASC')
      .all() as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.prev_hash).toBe('');

    db.close();
  });

  it('second entry prev_hash is SHA-256 of first row', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({
      agentId: 'agent-1',
      probe: 'system.disk.usage',
      status: 'success',
      durationMs: 10,
    });

    // Read the first row as raw
    const rawDb = (
      db as unknown as {
        db: { prepare: (s: string) => { get: () => unknown; all: () => unknown[] } };
      }
    ).db;
    const firstRow = rawDb
      .prepare('SELECT * FROM audit_log ORDER BY id ASC LIMIT 1')
      .get() as Record<string, unknown>;

    db.logAudit({
      agentId: 'agent-1',
      probe: 'system.memory.usage',
      status: 'success',
      durationMs: 20,
    });

    const rows = rawDb.prepare('SELECT * FROM audit_log ORDER BY id ASC').all() as Array<
      Record<string, unknown>
    >;
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(firstRow)).digest('hex');

    expect(rows[1]?.prev_hash).toBe(expectedHash);

    db.close();
  });

  it('chain verifies as valid', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({ agentId: 'a', probe: 'p1', status: 'success', durationMs: 1 });
    db.logAudit({ agentId: 'a', probe: 'p2', status: 'success', durationMs: 2 });
    db.logAudit({ agentId: 'a', probe: 'p3', status: 'error', durationMs: 3 });

    expect(db.verifyAuditChain()).toEqual({ valid: true });

    db.close();
  });

  it('tampered entry breaks chain', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({ agentId: 'a', probe: 'p1', status: 'success', durationMs: 1 });
    db.logAudit({ agentId: 'a', probe: 'p2', status: 'success', durationMs: 2 });
    db.logAudit({ agentId: 'a', probe: 'p3', status: 'success', durationMs: 3 });

    // Tamper with the second entry
    const rawDb = (
      db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }
    ).db;
    rawDb.prepare("UPDATE audit_log SET status = 'tampered' WHERE id = 2").run();

    const result = db.verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);

    db.close();
  });

  it('empty chain is valid', () => {
    const db = new SondeDb(':memory:');
    expect(db.verifyAuditChain()).toEqual({ valid: true });
    db.close();
  });

  it('includes api_key_id in audit entries', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({
      apiKeyId: 'key-123',
      agentId: 'agent-1',
      probe: 'system.disk.usage',
      status: 'success',
      durationMs: 10,
    });

    const rawDb = (db as unknown as { db: { prepare: (s: string) => { get: () => unknown } } }).db;
    const row = rawDb.prepare('SELECT api_key_id FROM audit_log WHERE id = 1').get() as {
      api_key_id: string;
    };
    expect(row.api_key_id).toBe('key-123');

    db.close();
  });
});

describe('getAuditEntries filters', () => {
  it('filters by apiKeyId', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({
      apiKeyId: 'key-a',
      agentId: 'a1',
      probe: 'p1',
      status: 'success',
      durationMs: 1,
    });
    db.logAudit({
      apiKeyId: 'key-b',
      agentId: 'a1',
      probe: 'p2',
      status: 'success',
      durationMs: 2,
    });
    db.logAudit({
      apiKeyId: 'key-a',
      agentId: 'a2',
      probe: 'p3',
      status: 'success',
      durationMs: 3,
    });

    const results = db.getAuditEntries({ apiKeyId: 'key-a' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.apiKeyId === 'key-a')).toBe(true);

    db.close();
  });

  it('returns apiKeyId in results', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({
      apiKeyId: 'key-xyz',
      agentId: 'a1',
      probe: 'p1',
      status: 'success',
      durationMs: 1,
    });

    const results = db.getAuditEntries();
    expect(results).toHaveLength(1);
    expect(results[0]?.apiKeyId).toBe('key-xyz');

    db.close();
  });

  it('filters by date range', () => {
    const db = new SondeDb(':memory:');

    // Insert entries with controlled timestamps via raw SQL
    const rawDb = (
      db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }
    ).db;
    rawDb
      .prepare(
        "INSERT INTO audit_log (timestamp, api_key_id, agent_id, probe, status, duration_ms, prev_hash) VALUES (?, '', 'a1', 'p1', 'success', 1, '')",
      )
      .run('2026-01-01T00:00:00Z');
    rawDb
      .prepare(
        "INSERT INTO audit_log (timestamp, api_key_id, agent_id, probe, status, duration_ms, prev_hash) VALUES (?, '', 'a1', 'p2', 'success', 2, '')",
      )
      .run('2026-01-15T00:00:00Z');
    rawDb
      .prepare(
        "INSERT INTO audit_log (timestamp, api_key_id, agent_id, probe, status, duration_ms, prev_hash) VALUES (?, '', 'a1', 'p3', 'success', 3, '')",
      )
      .run('2026-02-01T00:00:00Z');

    const results = db.getAuditEntries({
      startDate: '2026-01-10T00:00:00Z',
      endDate: '2026-01-20T00:00:00Z',
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.probe).toBe('p2');

    db.close();
  });

  it('combines apiKeyId and agentId filters', () => {
    const db = new SondeDb(':memory:');

    db.logAudit({
      apiKeyId: 'key-a',
      agentId: 'a1',
      probe: 'p1',
      status: 'success',
      durationMs: 1,
    });
    db.logAudit({
      apiKeyId: 'key-a',
      agentId: 'a2',
      probe: 'p2',
      status: 'success',
      durationMs: 2,
    });
    db.logAudit({
      apiKeyId: 'key-b',
      agentId: 'a1',
      probe: 'p3',
      status: 'success',
      durationMs: 3,
    });

    const results = db.getAuditEntries({ apiKeyId: 'key-a', agentId: 'a1' });
    expect(results).toHaveLength(1);
    expect(results[0]?.probe).toBe('p1');

    db.close();
  });
});
