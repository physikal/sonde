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
}

const CONFIG_DIR = path.join(os.homedir(), '.sonde');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): AgentConfig | undefined {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as AgentConfig;
  } catch {
    return undefined;
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
