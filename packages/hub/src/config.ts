import { DEFAULT_HUB_PORT } from '@sonde/shared';
import { logger } from './logger.js';

export interface HubConfig {
  port: number;
  host: string;
  secret: string;
  dbPath: string;
  tlsEnabled: boolean;
  hubUrl?: string;
  adminUser?: string;
  adminPassword?: string;
}

export function loadConfig(): HubConfig {
  let secret = process.env.SONDE_SECRET;
  if (!secret && process.env.SONDE_API_KEY) {
    secret = process.env.SONDE_API_KEY;
    logger.warn(
      'SONDE_API_KEY is deprecated — use SONDE_SECRET instead. API keys are now managed via the dashboard.',
    );
  }
  if (!secret) {
    throw new Error('SONDE_SECRET environment variable is required');
  }
  if (secret.length < 16) {
    throw new Error('SONDE_SECRET must be at least 16 characters.');
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
    secret,
    dbPath: process.env.SONDE_DB_PATH ?? './sonde.db',
    tlsEnabled: process.env.SONDE_TLS === 'true',
    hubUrl: process.env.SONDE_HUB_URL || undefined,
    ...(adminUser !== undefined && adminPassword !== undefined ? { adminUser, adminPassword } : {}),
  };
}
