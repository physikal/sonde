import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AgentConfig {
  hubUrl: string;
  apiKey: string;
  agentName: string;
  agentId?: string;
  enrollmentToken?: string;
  certPath?: string;
  keyPath?: string;
  caCertPath?: string;
  scrubPatterns?: string[];
  allowUnsignedPacks?: boolean;
  disabledPacks?: string[];
}

const CONFIG_DIR = path.join(os.homedir(), '.sonde');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PID_FILE = path.join(CONFIG_DIR, 'agent.pid');

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): AgentConfig | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return undefined;
    if (code === 'EACCES') {
      console.error(`Cannot read config at ${CONFIG_FILE}. Check file permissions.`);
      process.exit(1);
    }
    return undefined;
  }

  try {
    return JSON.parse(raw) as AgentConfig;
  } catch {
    console.error(`Config file corrupted at ${CONFIG_FILE}. Re-enroll with "sonde enroll".`);
    process.exit(1);
  }
}

export function saveConfig(config: AgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

/** Save cert/key/ca PEM files to ~/.sonde/ and update config paths. */
export function saveCerts(
  config: AgentConfig,
  certPem: string,
  keyPem: string,
  caCertPem: string,
): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const certPath = path.join(CONFIG_DIR, 'cert.pem');
  const keyPath = path.join(CONFIG_DIR, 'key.pem');
  const caCertPath = path.join(CONFIG_DIR, 'ca.pem');

  fs.writeFileSync(certPath, certPem, 'utf-8');
  fs.writeFileSync(keyPath, keyPem, 'utf-8');
  fs.writeFileSync(caCertPath, caCertPem, 'utf-8');

  config.certPath = certPath;
  config.keyPath = keyPath;
  config.caCertPath = caCertPath;
}

export function writePidFile(pid: number): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

/**
 * Read PID file and verify the process is still alive.
 * Returns undefined if file missing or process is dead.
 */
export function readPidFile(): number | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(PID_FILE, 'utf-8').trim();
  } catch {
    return undefined;
  }

  const pid = Number.parseInt(raw, 10);
  if (Number.isNaN(pid)) return undefined;

  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    // Process is dead — clean up stale PID file
    removePidFile();
    return undefined;
  }
}

export function removePidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // Ignore if already removed
  }
}

/**
 * Stop a running background agent if one exists.
 * Returns true if an agent was stopped.
 */
export function stopRunningAgent(): boolean {
  const pid = readPidFile();
  if (pid === undefined) return false;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process already gone
  }
  removePidFile();
  return true;
}
