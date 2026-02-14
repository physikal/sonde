import type { ProbeHandler } from '../../types.js';

export interface JournalEntry {
  timestamp: string;
  priority: number;
  message: string;
  pid: string;
  uid: string;
}

export interface JournalQueryResult {
  unit: string;
  entries: JournalEntry[];
  entryCount: number;
}

/**
 * Runs `journalctl -u <unit> -n <lines> --no-pager -o json` and parses each JSON line.
 */
export const journalQuery: ProbeHandler = async (params, exec) => {
  const unit = params?.unit as string;
  const lines = (params?.lines as number) ?? 50;

  const stdout = await exec('journalctl', [
    '-u',
    unit,
    '-n',
    String(lines),
    '--no-pager',
    '-o',
    'json',
  ]);
  return parseJournalQuery(unit, stdout);
};

export function parseJournalQuery(unit: string, stdout: string): JournalQueryResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const entries: JournalEntry[] = [];

  for (const line of lines) {
    const raw = JSON.parse(line);
    entries.push({
      timestamp: raw.__REALTIME_TIMESTAMP ?? raw._SOURCE_REALTIME_TIMESTAMP ?? '',
      priority: Number(raw.PRIORITY ?? 6),
      message: raw.MESSAGE ?? '',
      pid: raw._PID ?? '',
      uid: raw._UID ?? '',
    });
  }

  return {
    unit,
    entries,
    entryCount: entries.length,
  };
}
