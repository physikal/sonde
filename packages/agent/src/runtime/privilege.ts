import { execFileSync } from 'node:child_process';

/** Exit with error if running as root (uid 0). */
export function checkNotRoot(): void {
  if (process.getuid?.() === 0) {
    console.error('Error: sonde agent must not run as root.');
    console.error('');
    if (sondeUserExists()) {
      console.error('A "sonde" user exists. Install the systemd service:');
      console.error('  sonde service install');
      console.error('');
      console.error('Or start interactively as the sonde user:');
      console.error('  su -s /bin/sh sonde -c "sonde start"');
    } else {
      console.error('Create a dedicated user and re-run the installer:');
      console.error('  useradd --system --home-dir /var/lib/sonde --create-home \\');
      console.error('    --shell /usr/sbin/nologin sonde');
      console.error('  sonde service install');
    }
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
