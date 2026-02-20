import { platform } from 'node:os';
import type { ProbeHandler } from '../../types.js';

export interface DmesgResult {
  lines: string[];
  lineCount: number;
}

/**
 * Reads the kernel ring buffer via `dmesg`.
 * On Linux uses `--time-format iso` for readable timestamps.
 * On macOS uses plain `dmesg` (no --time-format support).
 */
export const logsDmesg: ProbeHandler = async (params, exec) => {
  const lines = Math.min(
    Math.max(Number(params?.lines ?? 50), 1),
    500,
  );

  const isMac = platform() === 'darwin';
  const dmesgArgs = isMac ? [] : ['--time-format', 'iso'];

  const output = await exec('dmesg', dmesgArgs);
  return parseDmesgOutput(output, lines);
};

export function parseDmesgOutput(
  raw: string,
  lines: number,
): DmesgResult {
  const allLines = raw.trim().split('\n').filter(Boolean);
  const tailLines = allLines.slice(-lines);

  return {
    lines: tailLines,
    lineCount: tailLines.length,
  };
}
