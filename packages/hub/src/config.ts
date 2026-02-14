import { DEFAULT_HUB_PORT } from '@sonde/shared';

export interface HubConfig {
  port: number;
  host: string;
  apiKey: string;
  dbPath: string;
}

export function loadConfig(): HubConfig {
  const apiKey = process.env.SONDE_API_KEY;
  if (!apiKey) {
    throw new Error('SONDE_API_KEY environment variable is required');
  }

  return {
    port: Number(process.env.PORT) || DEFAULT_HUB_PORT,
    host: process.env.HOST ?? '0.0.0.0',
    apiKey,
    dbPath: process.env.SONDE_DB_PATH ?? './sonde.db',
  };
}
