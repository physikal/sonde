import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { KeysCountResult } from './keys-count.js';
import { keysCount, parseKeysCount } from './keys-count.js';

const SAMPLE_OUTPUT = `# Keyspace
db0:keys=1234,expires=100,avg_ttl=5000
db1:keys=567,expires=50,avg_ttl=3000`;

describe('parseKeysCount', () => {
  it('parses keyspace databases', () => {
    const result = parseKeysCount(SAMPLE_OUTPUT);
    expect(result.databases).toHaveLength(2);
    expect(result.databases[0]).toEqual({ db: 0, keys: 1234, expires: 100 });
    expect(result.databases[1]).toEqual({ db: 1, keys: 567, expires: 50 });
    expect(result.totalKeys).toBe(1801);
  });

  it('handles empty output', () => {
    const result = parseKeysCount('');
    expect(result.databases).toEqual([]);
    expect(result.totalKeys).toBe(0);
  });

  it('handles only header line', () => {
    const result = parseKeysCount('# Keyspace\n');
    expect(result.databases).toEqual([]);
    expect(result.totalKeys).toBe(0);
  });
});

describe('keysCount handler', () => {
  it('calls redis-cli INFO keyspace', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('redis-cli');
      expect(args).toContain('INFO');
      expect(args).toContain('keyspace');
      return SAMPLE_OUTPUT;
    };

    const result = (await keysCount(undefined, mockExec)) as KeysCountResult;
    expect(result.totalKeys).toBe(1801);
  });
});
