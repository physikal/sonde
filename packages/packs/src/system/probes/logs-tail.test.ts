import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { LogTailResult } from './logs-tail.js';
import {
  logsTail,
  parseLogTailOutput,
  validateLogPath,
} from './logs-tail.js';

const SYSLOG_OUTPUT = `Jan 15 10:00:01 host systemd[1]: Started Session 1
Jan 15 10:00:02 host sshd[512]: Accepted publickey
Jan 15 10:00:03 host kernel: audit: type=1400`;

describe('validateLogPath', () => {
  it('accepts valid /var/log/ paths', () => {
    expect(() =>
      validateLogPath('/var/log/syslog'),
    ).not.toThrow();
    expect(() =>
      validateLogPath('/var/log/nginx/access.log'),
    ).not.toThrow();
  });

  it('accepts valid /tmp/ paths', () => {
    expect(() =>
      validateLogPath('/tmp/debug.log'),
    ).not.toThrow();
  });

  it('rejects relative paths', () => {
    expect(() =>
      validateLogPath('var/log/syslog'),
    ).toThrow('Path must be absolute');
  });

  it('rejects paths with ..', () => {
    expect(() =>
      validateLogPath('/var/log/../../etc/shadow'),
    ).toThrow("must not contain '..'");
  });

  it('rejects paths outside allowed prefixes', () => {
    expect(() =>
      validateLogPath('/etc/shadow'),
    ).toThrow('must start with one of');
    expect(() =>
      validateLogPath('/home/user/.bash_history'),
    ).toThrow('must start with one of');
    expect(() =>
      validateLogPath('/root/.ssh/id_rsa'),
    ).toThrow('must start with one of');
  });
});

describe('parseLogTailOutput', () => {
  it('parses multi-line log output', () => {
    const result = parseLogTailOutput(
      SYSLOG_OUTPUT,
      '/var/log/syslog',
    );

    expect(result.logPath).toBe('/var/log/syslog');
    expect(result.lineCount).toBe(3);
    expect(result.lines[0]).toContain('Started Session');
    expect(result.lines[2]).toContain('audit');
  });

  it('handles empty output', () => {
    const result = parseLogTailOutput('', '/var/log/empty.log');

    expect(result.lineCount).toBe(0);
    expect(result.lines).toHaveLength(0);
  });
});

describe('logsTail handler', () => {
  it('throws when path is missing', async () => {
    const mockExec: ExecFn = async () => '';
    await expect(
      logsTail(undefined, mockExec),
    ).rejects.toThrow('Missing required parameter: path');
    await expect(
      logsTail({}, mockExec),
    ).rejects.toThrow('Missing required parameter: path');
  });

  it('throws for invalid paths before calling exec', async () => {
    const calls: string[] = [];
    const mockExec: ExecFn = async (cmd) => {
      calls.push(cmd);
      return '';
    };

    await expect(
      logsTail({ path: '/etc/shadow' }, mockExec),
    ).rejects.toThrow('must start with one of');
    expect(calls).toHaveLength(0);
  });

  it('passes correct args with defaults', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return SYSLOG_OUTPUT;
    };

    const result = (await logsTail(
      { path: '/var/log/syslog' },
      mockExec,
    )) as LogTailResult;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('tail');
    expect(calls[0]?.args).toEqual([
      '-n', '50', '/var/log/syslog',
    ]);
    expect(result.logPath).toBe('/var/log/syslog');
    expect(result.lineCount).toBe(3);
  });

  it('clamps lines to valid range', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    await logsTail(
      { path: '/var/log/syslog', lines: 9999 },
      mockExec,
    );
    expect(calls[0]?.args).toContain('500');

    await logsTail(
      { path: '/var/log/syslog', lines: 0 },
      mockExec,
    );
    expect(calls[1]?.args).toContain('1');
  });
});
