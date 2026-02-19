import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { MysqlStatusResult } from './status.js';
import { parseMysqlStatus, status } from './status.js';

const SAMPLE_OUTPUT = `Uptime\t86400
Threads_connected\t15
Questions\t1728000
Slow_queries\t42
Opened_tables\t500
Open_tables\t200`;

describe('parseMysqlStatus', () => {
  it('parses status variables', () => {
    const result = parseMysqlStatus(SAMPLE_OUTPUT);
    expect(result.uptime).toBe(86400);
    expect(result.threads).toBe(15);
    expect(result.questions).toBe(1728000);
    expect(result.slowQueries).toBe(42);
    expect(result.opens).toBe(500);
    expect(result.openTables).toBe(200);
    expect(result.queriesPerSecondAvg).toBe(20);
  });

  it('stores all variables in map', () => {
    const result = parseMysqlStatus(SAMPLE_OUTPUT);
    expect(result.variables['Uptime']).toBe('86400');
    expect(result.variables['Slow_queries']).toBe('42');
  });

  it('handles empty output', () => {
    const result = parseMysqlStatus('');
    expect(result.uptime).toBe(0);
    expect(result.queriesPerSecondAvg).toBe(0);
  });
});

describe('status handler', () => {
  it('calls mysql SHOW GLOBAL STATUS', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('mysql');
      const query = args[args.length - 1];
      expect(query).toContain('SHOW GLOBAL STATUS');
      return SAMPLE_OUTPUT;
    };

    const result = (await status(undefined, mockExec)) as MysqlStatusResult;
    expect(result.uptime).toBe(86400);
  });
});
