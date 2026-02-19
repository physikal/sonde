import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, semverLt } from './update.js';

describe('semverLt', () => {
  it('returns true when a < b (major)', () => {
    expect(semverLt('0.1.0', '1.0.0')).toBe(true);
  });

  it('returns true when a < b (minor)', () => {
    expect(semverLt('1.0.0', '1.1.0')).toBe(true);
  });

  it('returns true when a < b (patch)', () => {
    expect(semverLt('1.1.0', '1.1.1')).toBe(true);
  });

  it('returns false when equal', () => {
    expect(semverLt('1.2.3', '1.2.3')).toBe(false);
  });

  it('returns false when a > b', () => {
    expect(semverLt('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns update info when newer version is available', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '99.0.0' }),
    });

    const result = await checkForUpdate();
    expect(result.latestVersion).toBe('99.0.0');
    expect(result.updateAvailable).toBe(true);
  });

  it('returns no update when on latest version', async () => {
    // Use 0.0.0 which is lower than any real version
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.0.0' }),
    });

    const result = await checkForUpdate();
    expect(result.updateAvailable).toBe(false);
  });

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(checkForUpdate()).rejects.toThrow('Network error');
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(checkForUpdate()).rejects.toThrow('Failed to check npm registry');
  });
});
