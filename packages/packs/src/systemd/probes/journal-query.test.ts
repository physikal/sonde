import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { JournalQueryResult } from './journal-query.js';
import { journalQuery, parseJournalQuery } from './journal-query.js';

const SAMPLE_OUTPUT = `{"__REALTIME_TIMESTAMP":"1705312200000000","PRIORITY":"6","MESSAGE":"Starting nginx...","_PID":"1234","_UID":"0","_SYSTEMD_UNIT":"nginx.service"}
{"__REALTIME_TIMESTAMP":"1705312201000000","PRIORITY":"6","MESSAGE":"Started nginx.","_PID":"1234","_UID":"0","_SYSTEMD_UNIT":"nginx.service"}
{"__REALTIME_TIMESTAMP":"1705312205000000","PRIORITY":"4","MESSAGE":"worker process exited on signal 15","_PID":"1235","_UID":"33","_SYSTEMD_UNIT":"nginx.service"}`;

describe('parseJournalQuery', () => {
  it('parses journalctl JSON output into structured data', () => {
    const result = parseJournalQuery('nginx.service', SAMPLE_OUTPUT);

    expect(result.unit).toBe('nginx.service');
    expect(result.entries).toHaveLength(3);
    expect(result.entryCount).toBe(3);

    expect(result.entries[0]).toEqual({
      timestamp: '1705312200000000',
      priority: 6,
      message: 'Starting nginx...',
      pid: '1234',
      uid: '0',
    });

    expect(result.entries[2]?.priority).toBe(4);
    expect(result.entries[2]?.message).toBe('worker process exited on signal 15');
  });

  it('handles empty output', () => {
    const result = parseJournalQuery('nginx.service', '');
    expect(result.entries).toHaveLength(0);
    expect(result.entryCount).toBe(0);
  });
});

describe('journalQuery handler', () => {
  it('calls journalctl with default lines and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('journalctl');
      expect(args).toEqual(['-u', 'nginx.service', '-n', '50', '--no-pager', '-o', 'json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await journalQuery({ unit: 'nginx.service' }, mockExec)) as JournalQueryResult;
    expect(result.unit).toBe('nginx.service');
    expect(result.entryCount).toBe(3);
  });

  it('uses custom lines param', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('journalctl');
      expect(args).toEqual(['-u', 'sshd.service', '-n', '20', '--no-pager', '-o', 'json']);
      return '{}';
    };

    // Single-line JSON object, not an array — parses as one entry
    const result = (await journalQuery(
      { unit: 'sshd.service', lines: 20 },
      mockExec,
    )) as JournalQueryResult;
    expect(result.unit).toBe('sshd.service');
  });
});
