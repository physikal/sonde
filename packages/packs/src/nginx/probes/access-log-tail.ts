import type { ProbeHandler } from '../../types.js';

export interface AccessLogTailResult {
  logPath: string;
  lines: string[];
  lineCount: number;
}

export const accessLogTail: ProbeHandler = async (params, exec) => {
  const logPath = (params?.logPath as string) ?? '/var/log/nginx/access.log';
  const lines = (params?.lines as number) ?? 100;

  const stdout = await exec('tail', ['-n', String(lines), logPath]);
  return parseLogTail(logPath, stdout);
};

export function parseLogTail(logPath: string, stdout: string): AccessLogTailResult {
  const lines = stdout.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return { logPath, lines, lineCount: lines.length };
}
