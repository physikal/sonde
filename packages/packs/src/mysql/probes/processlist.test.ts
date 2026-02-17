import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { MysqlProcesslistResult } from './processlist.js';
import { parseProcesslist, processlist } from './processlist.js';

const SAMPLE_OUTPUT = `42\troot\tlocalhost\tmyapp\tQuery\t120\texecuting\tSELECT * FROM large_table
99\tappuser\t192.168.1.10\tmyapp\tSleep\t5\t\t`;

describe('parseProcesslist', () => {
  it('parses process list output', () => {
    const result = parseProcesslist(SAMPLE_OUTPUT);
    expect(result.count).toBe(2);
    expect(result.processes[0]).toEqual({
      id: 42,
      user: 'root',
      host: 'localhost',
      db: 'myapp',
      command: 'Query',
      time: 120,
      state: 'executing',
      info: 'SELECT * FROM large_table',
    });
    expect(result.processes[1]?.command).toBe('Sleep');
  });

  it('handles empty output', () => {
    const result = parseProcesslist('');
    expect(result.count).toBe(0);
    expect(result.processes).toEqual([]);
  });
});

describe('processlist handler', () => {
  it('calls mysql with correct args', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('mysql');
      expect(args).toContain('--batch');
      expect(args).toContain('--skip-column-names');
      const query = args[args.length - 1];
      expect(query).toContain('PROCESSLIST');
      return SAMPLE_OUTPUT;
    };

    const result = (await processlist(undefined, mockExec)) as MysqlProcesslistResult;
    expect(result.count).toBe(2);
  });
});
