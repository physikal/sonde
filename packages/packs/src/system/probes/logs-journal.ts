import { platform } from 'node:os';
import type { ProbeHandler } from '../../types.js';

export interface JournalEntry {
  timestamp: string;
  priority: number;
  message: string;
  pid: number;
  uid: number;
  unit?: string;
}

export interface JournalResult {
  entries: JournalEntry[];
  entryCount: number;
  unit?: string;
}

/**
 * Reads recent systemd journal entries via `journalctl -o json`.
 * Linux only — fails with a clear message on macOS.
 */
export const logsJournal: ProbeHandler = async (params, exec) => {
  if (platform() === 'darwin') {
    throw new Error(
      'system.logs.journal requires systemd (Linux only)',
    );
  }

  const lines = Math.min(
    Math.max(Number(params?.lines ?? 50), 1),
    500,
  );
  const unit = params?.unit as string | undefined;
  const priority = params?.priority as string | undefined;

  const args = [
    '-n',
    String(lines),
    '--no-pager',
    '-o',
    'json',
  ];

  if (unit) {
    args.push('-u', unit);
  }
  if (priority) {
    args.push('-p', priority);
  }

  const output = await exec('journalctl', args);
  return parseJournalOutput(output, unit);
};

export function parseJournalOutput(
  raw: string,
  unit?: string,
): JournalResult {
  const entries: JournalEntry[] = [];

  for (const line of raw.trim().split('\n')) {
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const timestamp =
      typeof obj.__REALTIME_TIMESTAMP === 'string'
        ? formatUsecTimestamp(obj.__REALTIME_TIMESTAMP)
        : String(obj.__REALTIME_TIMESTAMP ?? '');

    entries.push({
      timestamp,
      priority: Number(obj.PRIORITY ?? 6),
      message: String(obj.MESSAGE ?? ''),
      pid: Number(obj._PID ?? 0),
      uid: Number(obj._UID ?? 0),
      unit: obj._SYSTEMD_UNIT
        ? String(obj._SYSTEMD_UNIT)
        : undefined,
    });
  }

  const result: JournalResult = {
    entries,
    entryCount: entries.length,
  };
  if (unit) {
    result.unit = unit;
  }
  return result;
}

function formatUsecTimestamp(usec: string): string {
  const ms = Math.floor(Number(usec) / 1000);
  if (Number.isNaN(ms)) return usec;
  return new Date(ms).toISOString();
}
