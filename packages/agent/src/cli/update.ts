import { execFileSync } from 'node:child_process';
import { VERSION } from '../version.js';
import { isServiceInstalled, restartService } from './service.js';

/**
 * Lightweight semver comparison: returns true if a < b.
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
 * Check for available updates by querying the npm registry.
 */
export async function checkForUpdate(): Promise<{
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}> {
  const res = await fetch('https://registry.npmjs.org/@sonde/agent/latest', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to check npm registry (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { version?: string };
  const latestVersion = data.version;
  if (!latestVersion) {
    throw new Error('No version found in npm registry response');
  }

  return {
    currentVersion: VERSION,
    latestVersion,
    updateAvailable: semverLt(VERSION, latestVersion),
  };
}

/**
 * Perform the update by running npm install -g.
 * After install, tries to restart the systemd service (best-effort).
 */
export function performUpdate(targetVersion: string): void {
  console.log(`Installing @sonde/agent@${targetVersion}...`);
  execFileSync('npm', ['install', '-g', `@sonde/agent@${targetVersion}`], {
    stdio: 'inherit',
    timeout: 120_000,
  });

  // Verify the installed version
  const output = execFileSync('sonde', ['--version'], {
    encoding: 'utf-8',
    timeout: 5_000,
  }).trim();
  if (output !== targetVersion) {
    throw new Error(`Version mismatch after install: expected ${targetVersion}, got ${output}`);
  }

  console.log(`Successfully updated to v${targetVersion}`);

  if (isServiceInstalled()) {
    const result = restartService();
    console.log(result.message);
  } else {
    console.log('Restart the agent to use the new version:');
    console.log('  sonde restart');
    if (process.platform === 'linux') {
      console.log('');
      console.log('Tip: Run "sonde service install" to start on boot.');
    }
  }
}
