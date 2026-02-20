import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSecret = vi.fn();

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class MockDefaultAzureCredential {},
}));

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class MockSecretClient {
    getSecret = mockGetSecret;
  },
}));

import { fetchSecretFromKeyVault } from './keyvault.js';

describe('fetchSecretFromKeyVault', () => {
  beforeEach(() => {
    mockGetSecret.mockReset();
  });

  it('returns the secret value on success', async () => {
    mockGetSecret.mockResolvedValue({ value: 'my-vault-secret' });

    const result = await fetchSecretFromKeyVault(
      'https://sonde-vault.vault.azure.net',
      'sonde-secret',
    );

    expect(result).toBe('my-vault-secret');
    expect(mockGetSecret).toHaveBeenCalledWith('sonde-secret');
  });

  it('throws when secret value is empty', async () => {
    mockGetSecret.mockResolvedValue({ value: '' });

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('exists but has an empty value');
  });

  it('throws when secret value is undefined', async () => {
    mockGetSecret.mockResolvedValue({ value: undefined });

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('exists but has an empty value');
  });

  it('wraps 401 errors with auth guidance', async () => {
    const error = new Error('Authentication failed');
    Object.assign(error, { statusCode: 401 });
    mockGetSecret.mockRejectedValue(error);

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('Key Vault authentication failed (401)');
  });

  it('wraps 403 errors with RBAC guidance', async () => {
    const error = new Error('Forbidden');
    Object.assign(error, { statusCode: 403 });
    mockGetSecret.mockRejectedValue(error);

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('Key Vault access denied (403)');
  });

  it('wraps 404 errors with creation guidance', async () => {
    const error = new Error('Not found');
    Object.assign(error, { statusCode: 404 });
    mockGetSecret.mockRejectedValue(error);

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('Key Vault secret "sonde-secret" not found');
  });

  it('wraps network errors with connectivity guidance', async () => {
    mockGetSecret.mockRejectedValue(new Error('getaddrinfo ENOTFOUND sonde-vault.vault.azure.net'));

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('Cannot reach Key Vault');
  });

  it('re-throws unknown errors unchanged', async () => {
    const error = new Error('Something unexpected');
    mockGetSecret.mockRejectedValue(error);

    await expect(
      fetchSecretFromKeyVault('https://sonde-vault.vault.azure.net', 'sonde-secret'),
    ).rejects.toThrow('Something unexpected');
  });
});
