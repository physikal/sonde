import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { LogsTailResult } from './logs-tail.js';
import { logsTail, parseLogsTail } from './logs-tail.js';

const SAMPLE_LOGS = `2024-01-15T10:30:00Z Starting nginx...
2024-01-15T10:30:01Z Listening on port 80
2024-01-15T10:30:05Z GET / 200 0.5ms
`;

describe('parseLogsTail', () => {
  it('parses log output into structured data', () => {
    const result = parseLogsTail('web-server', SAMPLE_LOGS);

    expect(result.container).toBe('web-server');
    expect(result.lines).toHaveLength(3);
    expect(result.lineCount).toBe(3);
    expect(result.lines[0]).toBe('2024-01-15T10:30:00Z Starting nginx...');
  });

  it('handles empty output', () => {
    const result = parseLogsTail('web-server', '');
    expect(result.lines).toHaveLength(0);
    expect(result.lineCount).toBe(0);
  });
});

describe('logsTail handler', () => {
  it('calls docker logs with default lines and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('docker');
      expect(args).toEqual(['logs', '--tail', '100', 'web-server']);
      return SAMPLE_LOGS;
    };

    const result = (await logsTail({ container: 'web-server' }, mockExec)) as LogsTailResult;
    expect(result.container).toBe('web-server');
    expect(result.lineCount).toBe(3);
  });

  it('uses custom lines param', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('docker');
      expect(args).toEqual(['logs', '--tail', '50', 'my-app']);
      return SAMPLE_LOGS;
    };

    const result = (await logsTail({ container: 'my-app', lines: 50 }, mockExec)) as LogsTailResult;
    expect(result.container).toBe('my-app');
  });
});
