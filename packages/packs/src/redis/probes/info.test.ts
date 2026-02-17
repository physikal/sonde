import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { RedisInfoResult } from './info.js';
import { info, parseRedisInfo } from './info.js';

const SAMPLE_OUTPUT = `# Server
redis_version:7.2.4
uptime_in_seconds:86400
# Clients
connected_clients:42
# Memory
used_memory_human:12.50M
used_memory_peak_human:15.00M
# Stats
total_connections_received:1500
total_commands_processed:987654
# Replication
role:master`;

describe('parseRedisInfo', () => {
  it('parses key info fields', () => {
    const result = parseRedisInfo(SAMPLE_OUTPUT);
    expect(result.version).toBe('7.2.4');
    expect(result.uptimeSeconds).toBe(86400);
    expect(result.connectedClients).toBe(42);
    expect(result.usedMemoryHuman).toBe('12.50M');
    expect(result.usedMemoryPeakHuman).toBe('15.00M');
    expect(result.totalConnectionsReceived).toBe(1500);
    expect(result.totalCommandsProcessed).toBe(987654);
    expect(result.role).toBe('master');
  });

  it('stores all key-value pairs in raw', () => {
    const result = parseRedisInfo(SAMPLE_OUTPUT);
    expect(result.raw['redis_version']).toBe('7.2.4');
    expect(result.raw['role']).toBe('master');
  });

  it('handles empty output', () => {
    const result = parseRedisInfo('');
    expect(result.version).toBe('');
    expect(result.uptimeSeconds).toBe(0);
    expect(result.connectedClients).toBe(0);
    expect(result.role).toBe('');
  });
});

describe('info handler', () => {
  it('calls redis-cli with default host/port', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('redis-cli');
      expect(args).toContain('-h');
      expect(args).toContain('127.0.0.1');
      expect(args).toContain('-p');
      expect(args).toContain('6379');
      expect(args).toContain('INFO');
      return SAMPLE_OUTPUT;
    };

    const result = (await info(undefined, mockExec)) as RedisInfoResult;
    expect(result.version).toBe('7.2.4');
  });

  it('passes custom host/port', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(args).toContain('redis.example.com');
      expect(args).toContain('6380');
      return SAMPLE_OUTPUT;
    };

    await info({ host: 'redis.example.com', port: 6380 }, mockExec);
  });
});
