import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { ErrorLogTailResult } from './error-log-tail.js';
import { errorLogTail, parseErrorLogTail } from './error-log-tail.js';

const SAMPLE_ERROR_LOG = `2024/01/15 10:30:00 [error] 1234#1234: *5 open() "/usr/share/nginx/html/favicon.ico" failed (2: No such file or directory)
2024/01/15 10:30:01 [warn] 1234#1234: conflicting server name "example.com"
`;

describe('parseErrorLogTail', () => {
  it('parses error log lines', () => {
    const result = parseErrorLogTail('/var/log/nginx/error.log', SAMPLE_ERROR_LOG);
    expect(result.logPath).toBe('/var/log/nginx/error.log');
    expect(result.lineCount).toBe(2);
    expect(result.lines[0]).toContain('[error]');
  });
});

describe('errorLogTail handler', () => {
  it('uses default path and line count', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tail');
      expect(args).toEqual(['-n', '100', '/var/log/nginx/error.log']);
      return SAMPLE_ERROR_LOG;
    };

    const result = (await errorLogTail(undefined, mockExec)) as ErrorLogTailResult;
    expect(result.lineCount).toBe(2);
  });

  it('uses custom parameters', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('tail');
      expect(args).toEqual(['-n', '25', '/custom/error.log']);
      return SAMPLE_ERROR_LOG;
    };

    const result = (await errorLogTail(
      { logPath: '/custom/error.log', lines: 25 },
      mockExec,
    )) as ErrorLogTailResult;
    expect(result.logPath).toBe('/custom/error.log');
  });
});
