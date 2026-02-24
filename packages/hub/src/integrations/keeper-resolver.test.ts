import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeeperResolver, isKeeperRef, parseKeeperRef } from './keeper-resolver.js';
import type { IntegrationCredentials } from './types.js';

describe('isKeeperRef', () => {
  it('returns true for valid keeper refs', () => {
    expect(isKeeperRef('keeper://abc-123/XXXX-YYYY/field/password')).toBe(true);
    expect(isKeeperRef('keeper://id/uid/custom_field/My Label')).toBe(true);
  });

  it('returns false for non-keeper values', () => {
    expect(isKeeperRef('plain-password')).toBe(false);
    expect(isKeeperRef('')).toBe(false);
    expect(isKeeperRef('keeper://')).toBe(false);
    expect(isKeeperRef('keeper://missing')).toBe(false);
  });
});

describe('parseKeeperRef', () => {
  it('parses a field reference', () => {
    const ref = parseKeeperRef('keeper://int-1/rec-1/field/password', 'myKey');
    expect(ref).toEqual({
      keeperIntegrationId: 'int-1',
      recordUid: 'rec-1',
      selector: 'field',
      fieldType: 'password',
      originalKey: 'myKey',
    });
  });

  it('parses a custom_field reference', () => {
    const ref = parseKeeperRef('keeper://int-1/rec-1/custom_field/API Key', 'apiKey');
    expect(ref).toEqual({
      keeperIntegrationId: 'int-1',
      recordUid: 'rec-1',
      selector: 'custom_field',
      fieldType: 'API Key',
      originalKey: 'apiKey',
    });
  });

  it('returns undefined for non-keeper values', () => {
    expect(parseKeeperRef('plain', 'k')).toBeUndefined();
  });
});

// Mock the Keeper SDK import
vi.mock('@keeper-security/secrets-manager-core', () => ({
  inMemoryStorage: vi.fn((obj: unknown) => obj),
  getSecrets: vi.fn(),
}));

function mockRecord(
  uid: string,
  title: string,
  type: string,
  fields: Array<{ type: string; value: string[]; label?: string }>,
  custom?: Array<{ type: string; value: string[]; label?: string }>,
) {
  return {
    recordUid: uid,
    revision: 0,
    data: { title, type, fields, custom },
  };
}

function mockSecrets(records: ReturnType<typeof mockRecord>[]) {
  return { records, appData: { title: '', type: '' } };
}

describe('KeeperResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDeviceConfig = JSON.stringify({
    hostname: 'keepersecurity.com',
    clientId: 'test-client',
  });

  function makeResolver(configs: Record<string, { deviceConfig: string } | undefined>) {
    return new KeeperResolver((id) => {
      const cfg = configs[id];
      if (!cfg) return undefined;
      return {
        config: { endpoint: 'keepersecurity.com' },
        credentials: {
          packName: 'keeper',
          authMethod: 'api_key' as const,
          credentials: { deviceConfig: cfg.deviceConfig },
        },
      };
    });
  }

  it('returns credentials unchanged when no keeper refs', async () => {
    const resolver = makeResolver({});
    const creds: IntegrationCredentials = {
      packName: 'servicenow',
      authMethod: 'api_key',
      credentials: {
        username: 'admin',
        password: 'secret123',
      },
    };

    const result = await resolver.resolveCredentials(creds);
    expect(result).toBe(creds);
  });

  it('resolves keeper references', async () => {
    const sdk = await import('@keeper-security/secrets-manager-core');
    vi.mocked(sdk.getSecrets).mockResolvedValueOnce(
      mockSecrets([
        mockRecord('rec-1', 'SN Creds', 'login', [
          { type: 'login', value: ['svc_user'] },
          { type: 'password', value: ['vault-secret'] },
        ]),
      ]),
    );

    const resolver = makeResolver({
      'keeper-1': { deviceConfig: mockDeviceConfig },
    });

    const creds: IntegrationCredentials = {
      packName: 'servicenow',
      authMethod: 'api_key',
      credentials: {
        username: 'svc_sonde',
        password: 'keeper://keeper-1/rec-1/field/password',
      },
    };

    const result = await resolver.resolveCredentials(creds);
    expect(result.credentials.username).toBe('svc_sonde');
    expect(result.credentials.password).toBe('vault-secret');
  });

  it('groups multiple refs by keeper integration ID', async () => {
    const sdk = await import('@keeper-security/secrets-manager-core');
    vi.mocked(sdk.getSecrets).mockResolvedValueOnce(
      mockSecrets([
        mockRecord('rec-1', 'SN Creds', 'login', [
          { type: 'login', value: ['vault-user'] },
          { type: 'password', value: ['vault-pass'] },
        ]),
      ]),
    );

    const resolver = makeResolver({
      'keeper-1': { deviceConfig: mockDeviceConfig },
    });

    const creds: IntegrationCredentials = {
      packName: 'servicenow',
      authMethod: 'api_key',
      credentials: {
        username: 'keeper://keeper-1/rec-1/field/login',
        password: 'keeper://keeper-1/rec-1/field/password',
      },
    };

    const result = await resolver.resolveCredentials(creds);
    expect(result.credentials.username).toBe('vault-user');
    expect(result.credentials.password).toBe('vault-pass');
    // Should only call getSecrets once for the same keeper ID
    expect(sdk.getSecrets).toHaveBeenCalledTimes(1);
  });

  it('throws when keeper integration not found', async () => {
    const resolver = makeResolver({});
    const creds: IntegrationCredentials = {
      packName: 'servicenow',
      authMethod: 'api_key',
      credentials: {
        password: 'keeper://missing-id/rec-1/field/password',
      },
    };

    await expect(resolver.resolveCredentials(creds)).rejects.toThrow(/not found/);
  });

  it('throws when record not accessible', async () => {
    const sdk = await import('@keeper-security/secrets-manager-core');
    vi.mocked(sdk.getSecrets).mockResolvedValueOnce(mockSecrets([]));

    const resolver = makeResolver({
      'keeper-1': { deviceConfig: mockDeviceConfig },
    });

    const creds: IntegrationCredentials = {
      packName: 'servicenow',
      authMethod: 'api_key',
      credentials: {
        password: 'keeper://keeper-1/missing-rec/field/password',
      },
    };

    await expect(resolver.resolveCredentials(creds)).rejects.toThrow(/not accessible/);
  });

  it('throws when field not found on record', async () => {
    const sdk = await import('@keeper-security/secrets-manager-core');
    vi.mocked(sdk.getSecrets).mockResolvedValueOnce(
      mockSecrets([mockRecord('rec-1', 'Test', 'login', [{ type: 'login', value: ['user'] }])]),
    );

    const resolver = makeResolver({
      'keeper-1': { deviceConfig: mockDeviceConfig },
    });

    const creds: IntegrationCredentials = {
      packName: 'servicenow',
      authMethod: 'api_key',
      credentials: {
        password: 'keeper://keeper-1/rec-1/field/nonexistent',
      },
    };

    await expect(resolver.resolveCredentials(creds)).rejects.toThrow(/not found/);
  });

  it('resolves custom_field references', async () => {
    const sdk = await import('@keeper-security/secrets-manager-core');
    vi.mocked(sdk.getSecrets).mockResolvedValueOnce(
      mockSecrets([
        mockRecord(
          'rec-1',
          'Test',
          'login',
          [],
          [
            {
              type: 'text',
              label: 'API Token',
              value: ['custom-secret'],
            },
          ],
        ),
      ]),
    );

    const resolver = makeResolver({
      'keeper-1': { deviceConfig: mockDeviceConfig },
    });

    const creds: IntegrationCredentials = {
      packName: 'test',
      authMethod: 'api_key',
      credentials: {
        token: 'keeper://keeper-1/rec-1/custom_field/API Token',
      },
    };

    const result = await resolver.resolveCredentials(creds);
    expect(result.credentials.token).toBe('custom-secret');
  });

  it('wraps SDK network errors with actionable message', async () => {
    const sdk = await import('@keeper-security/secrets-manager-core');
    vi.mocked(sdk.getSecrets).mockRejectedValueOnce(new Error('fetch failed'));

    const resolver = makeResolver({
      'keeper-1': { deviceConfig: mockDeviceConfig },
    });

    const creds: IntegrationCredentials = {
      packName: 'test',
      authMethod: 'api_key',
      credentials: {
        password: 'keeper://keeper-1/rec-1/field/password',
      },
    };

    await expect(resolver.resolveCredentials(creds)).rejects.toThrow(/Cannot reach Keeper vault/);
  });
});
