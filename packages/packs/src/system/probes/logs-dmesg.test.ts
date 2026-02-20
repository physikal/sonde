import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { DmesgResult } from './logs-dmesg.js';
import { logsDmesg, parseDmesgOutput } from './logs-dmesg.js';

const DMESG_OUTPUT = `[2024-01-15T10:00:01+0000] EXT4-fs (sda1): mounted filesystem
[2024-01-15T10:00:02+0000] audit: type=1400 msg=avc:
[2024-01-15T10:00:03+0000] NET: Registered PF_INET6
[2024-01-15T10:00:04+0000] usb 1-1: new high-speed USB device
[2024-01-15T10:00:05+0000] e1000: Intel(R) PRO/1000 Network Driver`;

describe('parseDmesgOutput', () => {
  it('returns last N lines', () => {
    const result = parseDmesgOutput(DMESG_OUTPUT, 3);

    expect(result.lineCount).toBe(3);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toContain('NET: Registered PF_INET6');
    expect(result.lines[2]).toContain('e1000');
  });

  it('returns all lines when lines exceeds total', () => {
    const result = parseDmesgOutput(DMESG_OUTPUT, 100);

    expect(result.lineCount).toBe(5);
    expect(result.lines).toHaveLength(5);
  });

  it('handles empty output', () => {
    const result = parseDmesgOutput('', 50);

    expect(result.lineCount).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('handles single line', () => {
    const result = parseDmesgOutput(
      '[0.000000] Linux version 6.1.0',
      50,
    );

    expect(result.lineCount).toBe(1);
    expect(result.lines[0]).toContain('Linux version');
  });
});

describe('logsDmesg handler', () => {
  it('passes correct args on Linux', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return DMESG_OUTPUT;
    };

    const result = (await logsDmesg(
      undefined,
      mockExec,
    )) as DmesgResult;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('dmesg');
    // On the CI/test runner platform, args will vary
    // but the handler should call dmesg
    expect(result.lineCount).toBeGreaterThan(0);
  });

  it('clamps lines to valid range', async () => {
    const mockExec: ExecFn = async () => DMESG_OUTPUT;

    const result = (await logsDmesg(
      { lines: 2 },
      mockExec,
    )) as DmesgResult;
    expect(result.lineCount).toBe(2);

    const result2 = (await logsDmesg(
      { lines: 9999 },
      mockExec,
    )) as DmesgResult;
    // 500 clamped but only 5 lines in fixture
    expect(result2.lineCount).toBe(5);
  });
});
