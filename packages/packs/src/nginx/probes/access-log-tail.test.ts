import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { AccessLogTailResult } from './access-log-tail.js';
import { accessLogTail, parseLogTail } from './access-log-tail.js';

const SAMPLE_LOG = `192.168.1.1 - - [15/Jan/2024:10:30:00 +0000] "GET / HTTP/1.1" 200 612
192.168.1.2 - - [15/Jan/2024:10:30:01 +0000] "GET /api HTTP/1.1" 200 1234
192.168.1.1 - - [15/Jan/2024:10:30:02 +0000] "POST /login HTTP/1.1" 302 0
`;

describe('parseLogTail', () => {
  it('parses log lines correctly', () => {
    const result = parseLogTail('/var/log/nginx/access.log', SAMPLE_LOG);
    expect(result.logPath).toBe('/var/log/nginx/access.log');
    expect(result.lineCount).toBe(3);
    expect(result.lines[0]).toContain('GET / HTTP/1.1');
  });

  it('handles empty log', () => {
    const result = parseLogTail('/var/log/nginx/access.log', '');
    expect(result.lineCount).toBe(0);
    expect(result.lines).toEqual([]);
  });
});

describe('accessLogTail handler', () => {
  it('uses default path and line count', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tail');
      expect(args).toEqual(['-n', '100', '/var/log/nginx/access.log']);
      return SAMPLE_LOG;
    };

    const result = (await accessLogTail(undefined, mockExec)) as AccessLogTailResult;
    expect(result.lineCount).toBe(3);
  });

  it('uses custom path and lines', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tail');
      expect(args).toEqual(['-n', '50', '/custom/access.log']);
      return SAMPLE_LOG;
    };

    const result = (await accessLogTail(
      { logPath: '/custom/access.log', lines: 50 },
      mockExec,
    )) as AccessLogTailResult;
    expect(result.logPath).toBe('/custom/access.log');
  });
});
