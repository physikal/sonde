import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AgentConfig {
  hubUrl: string;
  apiKey: string;
  agentName: string;
  agentId?: string;
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
