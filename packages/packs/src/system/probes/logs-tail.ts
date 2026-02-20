import type { ProbeHandler } from '../../types.js';

export interface LogTailResult {
  logPath: string;
  lines: string[];
  lineCount: number;
}

const ALLOWED_PREFIXES = ['/var/log/', '/tmp/'];

export function validateLogPath(path: string): void {
  if (!path.startsWith('/')) {
    throw new Error(
      `Path must be absolute (start with /): ${path}`,
    );
  }

  if (path.includes('..')) {
    throw new Error(
      `Path must not contain '..': ${path}`,
    );
  }

  const allowed = ALLOWED_PREFIXES.some((prefix) =>
    path.startsWith(prefix),
  );
  if (!allowed) {
    throw new Error(
      `Path must start with one of: ${ALLOWED_PREFIXES.join(', ')} — got: ${path}`,
    );
  }
}

/**
 * Tails a log file at a given absolute path.
 * Restricted to /var/log/ and /tmp/ for security.
 */
export const logsTail: ProbeHandler = async (params, exec) => {
  const path = params?.path as string | undefined;
  if (!path) {
    throw new Error('Missing required parameter: path');
  }

  validateLogPath(path);

  const lines = Math.min(
    Math.max(Number(params?.lines ?? 50), 1),
    500,
  );

  const output = await exec('tail', [
    '-n',
    String(lines),
    path,
  ]);

  return parseLogTailOutput(output, path);
};

export function parseLogTailOutput(
  raw: string,
  logPath: string,
): LogTailResult {
  const lines = raw.split('\n').filter(Boolean);
  return {
    logPath,
    lines,
    lineCount: lines.length,
  };
}
