import { DEFAULT_HUB_PORT } from '@sonde/shared';

export interface HubConfig {
  port: number;
  host: string;
  apiKey: string;
  dbPath: string;
  tlsEnabled: boolean;
  hubUrl?: string;
  adminUser?: string;
  adminPassword?: string;
}

export function loadConfig(): HubConfig {
  const apiKey = process.env.SONDE_API_KEY;
  if (!apiKey) {
    throw new Error('SONDE_API_KEY environment variable is required');
  }
  if (apiKey.length < 16) {
    throw new Error('SONDE_API_KEY must be at least 16 characters.');
  }

  const port = Number(process.env.PORT) || DEFAULT_HUB_PORT;
  if (process.env.PORT && (port < 1 || port > 65535 || !Number.isInteger(port))) {
    throw new Error('PORT must be between 1 and 65535.');
  }

  const adminUser = process.env.SONDE_ADMIN_USER;
  const adminPassword = process.env.SONDE_ADMIN_PASSWORD;

  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    apiKey,
    dbPath: process.env.SONDE_DB_PATH ?? './sonde.db',
    tlsEnabled: process.env.SONDE_TLS === 'true',
    hubUrl: process.env.SONDE_HUB_URL || undefined,
    ...(adminUser && adminPassword ? { adminUser, adminPassword } : {}),
  };
}
