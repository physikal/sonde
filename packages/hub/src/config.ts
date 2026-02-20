import { DEFAULT_HUB_PORT } from '@sonde/shared';
import { fetchSecretFromKeyVault } from './keyvault.js';
import { logger } from './logger.js';

export type SecretSource = 'local' | 'keyvault';

export interface HubConfig {
  port: number;
  host: string;
  secret: string;
  secretSource: SecretSource;
  dbPath: string;
  tlsEnabled: boolean;
  hubUrl?: string;
  adminUser?: string;
  adminPassword?: string;
}

export async function loadConfig(): Promise<HubConfig> {
  const secretSource = (process.env.SONDE_SECRET_SOURCE ?? 'local') as string;
  if (secretSource !== 'local' && secretSource !== 'keyvault') {
    throw new Error(
      `Invalid SONDE_SECRET_SOURCE: "${secretSource}". Must be "local" or "keyvault".`,
    );
  }

  let secret: string | undefined;

  if (secretSource === 'keyvault') {
    const vaultUrl = process.env.AZURE_KEYVAULT_URL;
    if (!vaultUrl) {
      throw new Error(
        'AZURE_KEYVAULT_URL is required when SONDE_SECRET_SOURCE=keyvault. ' +
          'Set it to your vault URL, e.g. https://sonde-vault.vault.azure.net',
      );
    }

    const secretName = process.env.AZURE_KEYVAULT_SECRET_NAME ?? 'sonde-secret';
    secret = await fetchSecretFromKeyVault(vaultUrl, secretName);
  } else {
    secret = process.env.SONDE_SECRET;
    if (!secret && process.env.SONDE_API_KEY) {
      secret = process.env.SONDE_API_KEY;
      logger.warn(
        'SONDE_API_KEY is deprecated — use SONDE_SECRET instead. API keys are now managed via the dashboard.',
      );
    }
    if (!secret) {
      throw new Error('SONDE_SECRET environment variable is required');
    }
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
    secretSource: secretSource as SecretSource,
    dbPath: process.env.SONDE_DB_PATH ?? './sonde.db',
    tlsEnabled: process.env.SONDE_TLS === 'true',
    hubUrl: process.env.SONDE_HUB_URL || undefined,
    ...(adminUser !== undefined && adminPassword !== undefined ? { adminUser, adminPassword } : {}),
  };
}
