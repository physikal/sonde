import type { ProbeHandler } from '../../types.js';

export interface ErrorLogTailResult {
  logPath: string;
  lines: string[];
  lineCount: number;
}

export const errorLogTail: ProbeHandler = async (params, exec) => {
  const logPath = (params?.logPath as string) ?? '/var/log/nginx/error.log';
  const lines = (params?.lines as number) ?? 100;

  const stdout = await exec('tail', ['-n', String(lines), logPath]);
  return parseErrorLogTail(logPath, stdout);
};

export function parseErrorLogTail(logPath: string, stdout: string): ErrorLogTailResult {
  const lines = stdout.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return { logPath, lines, lineCount: lines.length };
}
