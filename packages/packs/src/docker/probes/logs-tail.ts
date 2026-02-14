import type { ProbeHandler } from '../../types.js';

export interface LogsTailResult {
  container: string;
  lines: string[];
  lineCount: number;
}

/**
 * Runs `docker logs --tail N <container>` and returns the log lines.
 */
export const logsTail: ProbeHandler = async (params, exec) => {
  const container = params?.container as string;
  const lines = (params?.lines as number) ?? 100;

  const stdout = await exec('docker', ['logs', '--tail', String(lines), container]);
  return parseLogsTail(container, stdout);
};

export function parseLogsTail(container: string, stdout: string): LogsTailResult {
  const lines = stdout.split('\n');
  // Remove trailing empty line from split
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return {
    container,
    lines,
    lineCount: lines.length,
  };
}
