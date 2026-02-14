import { execFileSync } from 'node:child_process';

/** Exit with error if running as root (uid 0) */
export function checkNotRoot(): void {
  if (process.getuid?.() === 0) {
    console.error('Error: sonde agent must not run as root.');
    console.error('Run as the dedicated "sonde" user or a non-root account.');
    console.error('See: packages/agent/scripts/install.sh');
    process.exit(1);
  }
}

/** Check if the 'sonde' system user exists */
export function sondeUserExists(): boolean {
  try {
    execFileSync('id', ['-u', 'sonde'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Return group list for the sonde user */
export function getSondeGroups(): string[] {
  try {
    const output = execFileSync('id', ['-Gn', 'sonde'], { encoding: 'utf-8' }).trim();
    return output ? output.split(/\s+/) : [];
  } catch {
    return [];
  }
}

/** Return the command to add the sonde user to a group */
export function suggestGroupAdd(group: string): string {
  return `sudo usermod -aG ${group} sonde`;
}
