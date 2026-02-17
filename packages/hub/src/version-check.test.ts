import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SondeDb } from './db/index.js';
import { checkLatestAgentVersion, semverLt, startVersionCheckLoop } from './version-check.js';

describe('semverLt', () => {
  it('should return true when a < b (major)', () => {
    expect(semverLt('0.1.0', '1.0.0')).toBe(true);
  });

  it('should return true when a < b (minor)', () => {
    expect(semverLt('1.0.0', '1.1.0')).toBe(true);
  });

  it('should return true when a < b (patch)', () => {
    expect(semverLt('1.1.0', '1.1.1')).toBe(true);
  });

  it('should return false when versions are equal', () => {
    expect(semverLt('1.2.3', '1.2.3')).toBe(false);
  });

  it('should return false when a > b', () => {
    expect(semverLt('2.0.0', '1.9.9')).toBe(false);
  });

  it('should handle multi-digit version parts', () => {
    expect(semverLt('1.9.0', '1.10.0')).toBe(true);
  });
});

describe('checkLatestAgentVersion', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return version from npm registry', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.2.0' }),
    });

    const version = await checkLatestAgentVersion();
    expect(version).toBe('0.2.0');
  });

  it('should return undefined on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const version = await checkLatestAgentVersion();
    expect(version).toBeUndefined();
  });

  it('should return undefined on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const version = await checkLatestAgentVersion();
    expect(version).toBeUndefined();
  });
});

describe('startVersionCheckLoop', () => {
  const originalFetch = globalThis.fetch;
  let db: SondeDb;

  beforeEach(() => {
    process.env.SONDE_API_KEY = 'test-key';
    db = new SondeDb(':memory:');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    db?.close();
    vi.restoreAllMocks();
  });

  it('should store latest version in hub_settings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.3.0' }),
    });

    const timer = startVersionCheckLoop(db, 60_000);

    // Wait for the immediate check to complete
    await vi.waitFor(() => {
      const val = db.getHubSetting('latest_agent_version');
      expect(val).toBe('0.3.0');
    });

    clearInterval(timer);
  });
});
