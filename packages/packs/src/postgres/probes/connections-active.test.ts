import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ConnectionsActiveResult } from './connections-active.js';
import { connectionsActive, parseConnectionsActive } from './connections-active.js';

const SAMPLE_OUTPUT = `1234\tmyapp\tappuser\t192.168.1.10\tactive\tSELECT * FROM users\t2024-01-15 10:30:00
5678\tpostgres\tpostgres\t\tidle\t\t2024-01-15 09:00:00`;

describe('parseConnectionsActive', () => {
  it('parses connections output', () => {
    const result = parseConnectionsActive(SAMPLE_OUTPUT);
    expect(result.total).toBe(2);
    expect(result.connections[0]).toEqual({
      pid: 1234,
      database: 'myapp',
      user: 'appuser',
      clientAddr: '192.168.1.10',
      state: 'active',
      query: 'SELECT * FROM users',
      backendStart: '2024-01-15 10:30:00',
    });
  });

  it('handles empty output', () => {
    const result = parseConnectionsActive('');
    expect(result.total).toBe(0);
  });
});

describe('connectionsActive handler', () => {
  it('calls psql with correct args', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('psql');
      expect(args).toContain('-t');
      expect(args).toContain('-A');
      return SAMPLE_OUTPUT;
    };

    const result = (await connectionsActive(undefined, mockExec)) as ConnectionsActiveResult;
    expect(result.total).toBe(2);
  });
});
