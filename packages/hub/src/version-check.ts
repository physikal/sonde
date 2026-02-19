import type { SondeDb } from './db/index.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Lightweight semver comparison: returns true if a < b.
 * Only handles standard 3-part versions (major.minor.patch).
 */
export function semverLt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

/**
 * Fetch the latest published version of @sonde/agent from the npm registry.
 * Returns undefined on network or parsing errors.
 */
export async function checkLatestAgentVersion(): Promise<string | undefined> {
  try {
    const res = await fetch('https://registry.npmjs.org/@sonde/agent/latest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  }
}

/**
 * Start a periodic loop that checks npm for the latest agent version
 * and stores it in hub_settings. Runs immediately, then every 6 hours.
 */
export function startVersionCheckLoop(
  db: SondeDb,
  intervalMs: number = SIX_HOURS_MS,
): NodeJS.Timeout {
  const check = async () => {
    const version = await checkLatestAgentVersion();
    if (version) {
      db.setHubSetting('latest_agent_version', version);
    }
  };

  // Fire immediately (don't await — runs in background)
  check();

  return setInterval(check, intervalMs);
}
