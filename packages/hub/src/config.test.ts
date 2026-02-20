import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

vi.mock('./keyvault.js', () => ({
  fetchSecretFromKeyVault: vi.fn(),
}));

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear relevant env vars
    process.env.SONDE_SECRET = undefined;
    process.env.SONDE_API_KEY = undefined;
    process.env.SONDE_SECRET_SOURCE = undefined;
    process.env.AZURE_KEYVAULT_URL = undefined;
    process.env.AZURE_KEYVAULT_SECRET_NAME = undefined;
    process.env.PORT = undefined;
    process.env.HOST = undefined;
    process.env.SONDE_DB_PATH = undefined;
    process.env.SONDE_TLS = undefined;
    process.env.SONDE_HUB_URL = undefined;
    process.env.SONDE_ADMIN_USER = undefined;
    process.env.SONDE_ADMIN_PASSWORD = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('uses SONDE_SECRET when set', async () => {
    process.env.SONDE_SECRET = 'my-secret-value-1234567890';
    const config = await loadConfig();
    expect(config.secret).toBe('my-secret-value-1234567890');
    expect(config.secretSource).toBe('local');
  });

  it('falls back to SONDE_API_KEY with deprecation warning', async () => {
    process.env.SONDE_API_KEY = 'legacy-key-value-1234567890';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const config = await loadConfig();
    expect(config.secret).toBe('legacy-key-value-1234567890');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SONDE_API_KEY is deprecated'));
  });

  it('prefers SONDE_SECRET over SONDE_API_KEY', async () => {
    process.env.SONDE_SECRET = 'preferred-secret-1234567890';
    process.env.SONDE_API_KEY = 'legacy-key-value-1234567890';
    const config = await loadConfig();
    expect(config.secret).toBe('preferred-secret-1234567890');
  });

  it('throws when neither SONDE_SECRET nor SONDE_API_KEY is set', async () => {
    await expect(loadConfig()).rejects.toThrow('SONDE_SECRET environment variable is required');
  });

  it('throws when secret is too short', async () => {
    process.env.SONDE_SECRET = 'short';
    await expect(loadConfig()).rejects.toThrow('SONDE_SECRET must be at least 16 characters');
  });

  it('defaults to local when SONDE_SECRET_SOURCE is unset', async () => {
    process.env.SONDE_SECRET = 'my-secret-value-1234567890';
    const config = await loadConfig();
    expect(config.secretSource).toBe('local');
  });

  it('uses local source when SONDE_SECRET_SOURCE=local', async () => {
    process.env.SONDE_SECRET_SOURCE = 'local';
    process.env.SONDE_SECRET = 'my-secret-value-1234567890';
    const config = await loadConfig();
    expect(config.secretSource).toBe('local');
    expect(config.secret).toBe('my-secret-value-1234567890');
  });

  it('throws when SONDE_SECRET_SOURCE is invalid', async () => {
    process.env.SONDE_SECRET_SOURCE = 'invalid';
    await expect(loadConfig()).rejects.toThrow(
      'Invalid SONDE_SECRET_SOURCE: "invalid". Must be "local" or "keyvault".',
    );
  });

  it('throws when SONDE_SECRET_SOURCE=keyvault without AZURE_KEYVAULT_URL', async () => {
    process.env.SONDE_SECRET_SOURCE = 'keyvault';
    await expect(loadConfig()).rejects.toThrow(
      'AZURE_KEYVAULT_URL is required when SONDE_SECRET_SOURCE=keyvault',
    );
  });

  it('calls fetchSecretFromKeyVault when SONDE_SECRET_SOURCE=keyvault', async () => {
    const { fetchSecretFromKeyVault } = await import('./keyvault.js');
    vi.mocked(fetchSecretFromKeyVault).mockResolvedValue('vault-secret-value-1234567890');

    process.env.SONDE_SECRET_SOURCE = 'keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://sonde-vault.vault.azure.net';

    const config = await loadConfig();
    expect(config.secret).toBe('vault-secret-value-1234567890');
    expect(config.secretSource).toBe('keyvault');
    expect(fetchSecretFromKeyVault).toHaveBeenCalledWith(
      'https://sonde-vault.vault.azure.net',
      'sonde-secret',
    );
  });

  it('uses custom secret name from AZURE_KEYVAULT_SECRET_NAME', async () => {
    const { fetchSecretFromKeyVault } = await import('./keyvault.js');
    vi.mocked(fetchSecretFromKeyVault).mockResolvedValue('vault-secret-value-1234567890');

    process.env.SONDE_SECRET_SOURCE = 'keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://sonde-vault.vault.azure.net';
    process.env.AZURE_KEYVAULT_SECRET_NAME = 'my-custom-secret';

    await loadConfig();
    expect(fetchSecretFromKeyVault).toHaveBeenCalledWith(
      'https://sonde-vault.vault.azure.net',
      'my-custom-secret',
    );
  });
});
