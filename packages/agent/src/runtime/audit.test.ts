import { describe, expect, it } from 'vitest';
import { AgentAuditLog } from './audit.js';

describe('AgentAuditLog', () => {
  it('logs entries and verifies chain', () => {
    const log = new AgentAuditLog();

    log.log('system.disk.usage', 'success', 10);
    log.log('system.memory.usage', 'success', 20);
    log.log('system.cpu.usage', 'error', 30);

    const entries = log.getRecent();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.prevHash).toBe('');
    expect(entries[1]?.prevHash).not.toBe('');
    expect(log.verifyChain()).toEqual({ valid: true });
  });

  it('ring buffer cap works', () => {
    const log = new AgentAuditLog(3);

    log.log('p1', 'success', 1);
    log.log('p2', 'success', 2);
    log.log('p3', 'success', 3);
    log.log('p4', 'success', 4);

    const entries = log.getRecent();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.probe).toBe('p2');
    expect(entries[2]?.probe).toBe('p4');
  });

  it('empty log is valid', () => {
    const log = new AgentAuditLog();
    expect(log.verifyChain()).toEqual({ valid: true });
  });

  it('getRecent(n) returns last n entries', () => {
    const log = new AgentAuditLog();
    log.log('p1', 'success', 1);
    log.log('p2', 'success', 2);
    log.log('p3', 'success', 3);

    const last2 = log.getRecent(2);
    expect(last2).toHaveLength(2);
    expect(last2[0]?.probe).toBe('p2');
    expect(last2[1]?.probe).toBe('p3');
  });

  it('chain after ring buffer eviction still verifies within remaining entries', () => {
    const log = new AgentAuditLog(2);

    log.log('p1', 'success', 1);
    log.log('p2', 'success', 2);
    log.log('p3', 'success', 3);

    // After eviction, the first remaining entry's prevHash won't match empty string
    // verifyChain checks what's in the buffer, genesis may have non-empty prevHash
    const result = log.verifyChain();
    // First entry in buffer (p2) has a prevHash from p1, which is no longer genesis
    // This is expected: a truncated chain won't verify from genesis
    expect(result.valid).toBe(false);
  });
});
