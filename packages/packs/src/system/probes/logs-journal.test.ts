import { describe, expect, it, vi } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { JournalResult } from './logs-journal.js';
import { logsJournal, parseJournalOutput } from './logs-journal.js';

vi.mock('node:os', () => ({ platform: () => 'linux' }));

const JOURNAL_JSON_OUTPUT = [
  JSON.stringify({
    __REALTIME_TIMESTAMP: '1700000000000000',
    PRIORITY: '6',
    MESSAGE: 'Started Session 42 of User root.',
    _PID: '1',
    _UID: '0',
    _SYSTEMD_UNIT: 'session-42.scope',
  }),
  JSON.stringify({
    __REALTIME_TIMESTAMP: '1700000001000000',
    PRIORITY: '3',
    MESSAGE: 'Failed to start nginx.service',
    _PID: '512',
    _UID: '0',
    _SYSTEMD_UNIT: 'nginx.service',
  }),
].join('\n');

const SINGLE_ENTRY = JSON.stringify({
  __REALTIME_TIMESTAMP: '1700000000000000',
  PRIORITY: '4',
  MESSAGE: 'Warning from sshd',
  _PID: '100',
  _UID: '0',
});

describe('parseJournalOutput', () => {
  it('parses multiple JSON journal entries', () => {
    const result = parseJournalOutput(JOURNAL_JSON_OUTPUT);

    expect(result.entries).toHaveLength(2);
    expect(result.entryCount).toBe(2);
    expect(result.unit).toBeUndefined();

    expect(result.entries[0]).toEqual({
      timestamp: '2023-11-14T22:13:20.000Z',
      priority: 6,
      message: 'Started Session 42 of User root.',
      pid: 1,
      uid: 0,
      unit: 'session-42.scope',
    });

    expect(result.entries[1]).toEqual({
      timestamp: '2023-11-14T22:13:21.000Z',
      priority: 3,
      message: 'Failed to start nginx.service',
      pid: 512,
      uid: 0,
      unit: 'nginx.service',
    });
  });

  it('sets unit in result when filtering by unit', () => {
    const result = parseJournalOutput(SINGLE_ENTRY, 'sshd');

    expect(result.unit).toBe('sshd');
    expect(result.entries).toHaveLength(1);
  });

  it('skips malformed JSON lines', () => {
    const input = `not json at all\n${SINGLE_ENTRY}\n{broken`;
    const result = parseJournalOutput(input);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.message).toBe('Warning from sshd');
  });

  it('handles empty output', () => {
    const result = parseJournalOutput('');
    expect(result.entries).toHaveLength(0);
    expect(result.entryCount).toBe(0);
  });

  it('handles entry without _SYSTEMD_UNIT', () => {
    const result = parseJournalOutput(SINGLE_ENTRY);
    expect(result.entries[0]?.unit).toBeUndefined();
  });
});

describe('logsJournal handler', () => {
  it('passes correct args to exec with defaults', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return SINGLE_ENTRY;
    };

    const result = (await logsJournal(
      undefined,
      mockExec,
    )) as JournalResult;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('journalctl');
    expect(calls[0]?.args).toEqual([
      '-n', '50', '--no-pager', '-o', 'json',
    ]);
    expect(result.entryCount).toBe(1);
  });

  it('passes unit and priority params', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return SINGLE_ENTRY;
    };

    await logsJournal(
      { unit: 'nginx', priority: 'err', lines: 100 },
      mockExec,
    );

    expect(calls[0]?.args).toEqual([
      '-n', '100', '--no-pager', '-o', 'json',
      '-u', 'nginx',
      '-p', 'err',
    ]);
  });

  it('clamps lines to valid range', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return SINGLE_ENTRY;
    };

    await logsJournal({ lines: 9999 }, mockExec);
    expect(calls[0]?.args).toContain('500');

    await logsJournal({ lines: 0 }, mockExec);
    expect(calls[1]?.args).toContain('1');
  });
});
