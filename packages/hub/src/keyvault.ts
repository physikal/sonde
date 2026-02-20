import { logger } from './logger.js';

/**
 * Fetches a secret from Azure Key Vault using dynamic imports.
 * Azure SDK packages are only loaded when this function is called,
 * so standalone deployments pay zero overhead.
 *
 * Authentication uses DefaultAzureCredential which auto-detects:
 * - Managed Identity (zero config on Azure VMs)
 * - App Registration (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
 */
export async function fetchSecretFromKeyVault(
  vaultUrl: string,
  secretName: string,
): Promise<string> {
  logger.info({ vaultUrl, secretName }, 'Fetching SONDE_SECRET from Azure Key Vault');

  let DefaultAzureCredential: typeof import('@azure/identity').DefaultAzureCredential;
  let SecretClient: typeof import('@azure/keyvault-secrets').SecretClient;

  try {
    const identity = await import('@azure/identity');
    const secrets = await import('@azure/keyvault-secrets');
    DefaultAzureCredential = identity.DefaultAzureCredential;
    SecretClient = secrets.SecretClient;
  } catch {
    throw new Error(
      'Azure SDK packages not found. Install @azure/identity and @azure/keyvault-secrets.',
    );
  }

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUrl, credential);

  try {
    const secret = await client.getSecret(secretName);

    if (!secret.value) {
      throw new Error(
        `Key Vault secret "${secretName}" exists but has an empty value. ` +
          `Set it with: az keyvault secret set --vault-name <vault> --name ${secretName} --value <secret>`,
      );
    }

    logger.info('SONDE_SECRET loaded from Key Vault');
    return secret.value;
  } catch (err: unknown) {
    if (err instanceof Error && 'statusCode' in err) {
      const statusCode = (err as { statusCode: number }).statusCode;

      if (statusCode === 401) {
        throw new Error(
          'Key Vault authentication failed (401). ' +
            'For Managed Identity: ensure the VM/App Service has a system-assigned identity enabled. ' +
            'For App Registration: set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET env vars.',
        );
      }

      if (statusCode === 403) {
        throw new Error(
          'Key Vault access denied (403). ' +
            `Assign the "Key Vault Secrets User" RBAC role to the identity, or add a Key Vault access policy ` +
            'granting Secret Get permission.',
        );
      }

      if (statusCode === 404) {
        throw new Error(
          `Key Vault secret "${secretName}" not found in ${vaultUrl}. ` +
            `Create it with: az keyvault secret set --vault-name <vault> --name ${secretName} --value <secret>`,
        );
      }
    }

    if (
      err instanceof Error &&
      (err.message.includes('ENOTFOUND') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('getaddrinfo'))
    ) {
      throw new Error(
        `Cannot reach Key Vault at ${vaultUrl}. Check network connectivity and DNS resolution. Ensure the vault URL follows the format https://<vault-name>.vault.azure.net`,
      );
    }

    throw err;
  }
}
