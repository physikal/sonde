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
