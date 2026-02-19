import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const UNIT_NAME = 'sonde-agent';
const UNIT_PATH = `/etc/systemd/system/${UNIT_NAME}.service`;

export interface ServiceResult {
  success: boolean;
  message: string;
}

function isLinux(): boolean {
  return process.platform === 'linux';
}

function resolveSondeBinary(): string {
  return execFileSync('which', ['sonde'], {
    encoding: 'utf-8',
    timeout: 5_000,
  }).trim();
}

export function generateUnitFile(): string {
  const user = os.userInfo();
  const sondeBin = resolveSondeBinary();

  return `[Unit]
Description=Sonde Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user.username}
Environment=HOME=${user.homedir}
ExecStart=${sondeBin} start --headless
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${UNIT_NAME}

[Install]
WantedBy=multi-user.target
`;
}

export function isServiceInstalled(): boolean {
  if (!isLinux()) return false;
  return fs.existsSync(UNIT_PATH);
}

export function getServiceStatus(): string {
  if (!isLinux()) return 'unsupported';
  if (!isServiceInstalled()) return 'not-installed';

  try {
    return execFileSync('systemctl', ['is-active', UNIT_NAME], {
      encoding: 'utf-8',
      timeout: 5_000,
    }).trim();
  } catch {
    return 'inactive';
  }
}

export function installService(): ServiceResult {
  if (!isLinux()) {
    return {
      success: false,
      message: 'systemd services are only supported on Linux.',
    };
  }

  try {
    const unitContent = generateUnitFile();

    execFileSync('sudo', ['tee', UNIT_PATH], {
      input: unitContent,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    execFileSync('sudo', ['systemctl', 'daemon-reload'], { stdio: 'pipe', timeout: 10_000 });
    execFileSync('sudo', ['systemctl', 'enable', UNIT_NAME], { stdio: 'pipe', timeout: 10_000 });
    execFileSync('sudo', ['systemctl', 'start', UNIT_NAME], { stdio: 'pipe', timeout: 10_000 });

    return {
      success: true,
      message: `${UNIT_NAME} service installed and started.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Failed to install service: ${msg}` };
  }
}

export function uninstallService(): ServiceResult {
  if (!isLinux()) {
    return {
      success: false,
      message: 'systemd services are only supported on Linux.',
    };
  }

  if (!isServiceInstalled()) {
    return { success: false, message: 'Service is not installed.' };
  }

  try {
    execFileSync('sudo', ['systemctl', 'stop', UNIT_NAME], { stdio: 'pipe', timeout: 10_000 });
    execFileSync('sudo', ['systemctl', 'disable', UNIT_NAME], { stdio: 'pipe', timeout: 10_000 });
    execFileSync('sudo', ['rm', '-f', UNIT_PATH], { stdio: 'pipe', timeout: 5_000 });
    execFileSync('sudo', ['systemctl', 'daemon-reload'], { stdio: 'pipe', timeout: 10_000 });

    return {
      success: true,
      message: `${UNIT_NAME} service removed.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to uninstall service: ${msg}`,
    };
  }
}

export function stopService(): ServiceResult {
  if (!isLinux()) {
    return {
      success: false,
      message: 'systemd services are only supported on Linux.',
    };
  }

  try {
    execFileSync('systemctl', ['stop', UNIT_NAME], { stdio: 'pipe', timeout: 10_000 });
    return { success: true, message: `Stopped ${UNIT_NAME} service.` };
  } catch {
    try {
      execFileSync('sudo', ['systemctl', 'stop', UNIT_NAME], { stdio: 'inherit', timeout: 30_000 });
      return { success: true, message: `Stopped ${UNIT_NAME} service.` };
    } catch {
      return {
        success: false,
        message: `Could not stop service. Try: sudo systemctl stop ${UNIT_NAME}`,
      };
    }
  }
}

export function restartService(): ServiceResult {
  if (!isLinux()) {
    return {
      success: false,
      message: 'systemd services are only supported on Linux.',
    };
  }

  try {
    execFileSync('systemctl', ['restart', UNIT_NAME], { stdio: 'pipe', timeout: 10_000 });
    return { success: true, message: `Restarted ${UNIT_NAME} service.` };
  } catch {
    try {
      execFileSync('sudo', ['systemctl', 'restart', UNIT_NAME], {
        stdio: 'inherit',
        timeout: 30_000,
      });
      return { success: true, message: `Restarted ${UNIT_NAME} service.` };
    } catch {
      return {
        success: false,
        message: `Could not restart service. Try: sudo systemctl restart ${UNIT_NAME}`,
      };
    }
  }
}
