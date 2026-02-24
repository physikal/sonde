import type { IntegrationPack } from '@sonde/shared';

const REGION_HOSTNAMES: Record<string, string> = {
  US: 'keepersecurity.com',
  EU: 'keepersecurity.eu',
  AU: 'keepersecurity.com.au',
  GOV: 'govcloud.keepersecurity.us',
  JP: 'keepersecurity.jp',
  CA: 'keepersecurity.ca',
};

async function loadSdk(): Promise<typeof import('@keeper-security/secrets-manager-core')> {
  return await import('@keeper-security/secrets-manager-core');
}

/**
 * Rebuild an in-memory KeyValueStorage from a previously
 * serialized device config JSON string.
 */
export async function rebuildStorage(
  deviceConfigJson: string,
): Promise<import('@keeper-security/secrets-manager-core').KeyValueStorage> {
  const sdk = await loadSdk();
  return sdk.inMemoryStorage(JSON.parse(deviceConfigJson));
}

/**
 * Initialize a new Keeper device binding using a one-time access token.
 * Returns the serialized device config JSON to store encrypted in the DB.
 * The one-time token is consumed during this call and cannot be reused.
 */
export async function initializeKeeper(oneTimeToken: string, hostname?: string): Promise<string> {
  const sdk = await loadSdk();
  const configObj: Record<string, string> = {};
  const storage = sdk.inMemoryStorage(configObj);

  if (hostname) {
    await storage.saveString('hostname', hostname);
  }

  await sdk.initializeStorage(storage, oneTimeToken, hostname);
  const { records } = await sdk.getSecrets({ storage });

  // Verify the binding worked by checking we got a response
  if (!records) {
    throw new Error('Keeper initialization failed: no records returned');
  }

  return JSON.stringify(configObj);
}

/**
 * Resolve the hostname for a given region code.
 * Returns undefined for unknown regions (SDK will use its default).
 */
export function regionToHostname(region?: string): string | undefined {
  if (!region) return undefined;
  return REGION_HOSTNAMES[region.toUpperCase()];
}

export const keeperPack: IntegrationPack = {
  manifest: {
    name: 'keeper',
    type: 'integration',
    version: '0.1.0',
    description: 'Keeper Secrets Manager — pull credentials from Keeper vault',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'list-records',
        description: 'List accessible record UIDs and titles',
        capability: 'observe',
        timeout: 15000,
      },
    ],
    runbook: {
      category: 'keeper',
      probes: ['list-records'],
      parallel: false,
    },
  },

  handlers: {
    'list-records': async (_params, _config, credentials) => {
      const deviceConfig = credentials.credentials.deviceConfig;
      if (!deviceConfig) throw new Error('Keeper device config not found');
      const sdk = await loadSdk();
      const storage = await rebuildStorage(deviceConfig);
      const { records } = await sdk.getSecrets({ storage });
      return records.map((r) => ({
        uid: r.recordUid,
        title: r.data.title,
        type: r.data.type,
      }));
    },
  },

  testConnection: async (_config, credentials) => {
    const deviceConfig = credentials.credentials.deviceConfig;
    if (!deviceConfig) return false;
    const sdk = await loadSdk();
    const storage = await rebuildStorage(deviceConfig);
    const { records } = await sdk.getSecrets({ storage });
    return Array.isArray(records);
  },
};
