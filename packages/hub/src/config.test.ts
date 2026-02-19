import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear relevant env vars
    process.env.SONDE_SECRET = undefined;
    process.env.SONDE_API_KEY = undefined;
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

  it('uses SONDE_SECRET when set', () => {
    process.env.SONDE_SECRET = 'my-secret-value-1234567890';
    const config = loadConfig();
    expect(config.secret).toBe('my-secret-value-1234567890');
  });

  it('falls back to SONDE_API_KEY with deprecation warning', () => {
    process.env.SONDE_API_KEY = 'legacy-key-value-1234567890';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const config = loadConfig();
    expect(config.secret).toBe('legacy-key-value-1234567890');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SONDE_API_KEY is deprecated'));
  });

  it('prefers SONDE_SECRET over SONDE_API_KEY', () => {
    process.env.SONDE_SECRET = 'preferred-secret-1234567890';
    process.env.SONDE_API_KEY = 'legacy-key-value-1234567890';
    const config = loadConfig();
    expect(config.secret).toBe('preferred-secret-1234567890');
  });

  it('throws when neither SONDE_SECRET nor SONDE_API_KEY is set', () => {
    expect(() => loadConfig()).toThrow('SONDE_SECRET environment variable is required');
  });

  it('throws when secret is too short', () => {
    process.env.SONDE_SECRET = 'short';
    expect(() => loadConfig()).toThrow('SONDE_SECRET must be at least 16 characters');
  });
});
