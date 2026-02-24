import type { IntegrationConfig, IntegrationCredentials } from './types.js';

const KEEPER_REF = /^keeper:\/\/([^/]+)\/([^/]+)\/(field|custom_field)\/(.+)$/;

interface KeeperReference {
  keeperIntegrationId: string;
  recordUid: string;
  selector: 'field' | 'custom_field';
  fieldType: string;
  originalKey: string;
}

type DecryptedConfig = {
  config: IntegrationConfig;
  credentials: IntegrationCredentials;
};

type GetDecryptedConfigFn = (id: string) => DecryptedConfig | undefined;

export function isKeeperRef(value: string): boolean {
  return KEEPER_REF.test(value);
}

export function parseKeeperRef(value: string, key: string): KeeperReference | undefined {
  const match = KEEPER_REF.exec(value);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return undefined;
  return {
    keeperIntegrationId: match[1],
    recordUid: match[2],
    selector: match[3] as 'field' | 'custom_field',
    fieldType: match[4],
    originalKey: key,
  };
}

export class KeeperResolver {
  constructor(private getDecryptedConfig: GetDecryptedConfigFn) {}

  async resolveCredentials(credentials: IntegrationCredentials): Promise<IntegrationCredentials> {
    const refs: KeeperReference[] = [];
    for (const [key, value] of Object.entries(credentials.credentials)) {
      const ref = parseKeeperRef(value, key);
      if (ref) refs.push(ref);
    }

    if (refs.length === 0) return credentials;

    // Group references by Keeper integration ID
    const grouped = new Map<string, KeeperReference[]>();
    for (const ref of refs) {
      const existing = grouped.get(ref.keeperIntegrationId);
      if (existing) {
        existing.push(ref);
      } else {
        grouped.set(ref.keeperIntegrationId, [ref]);
      }
    }

    const resolved = { ...credentials.credentials };

    for (const [keeperId, groupRefs] of grouped) {
      const decrypted = this.getDecryptedConfig(keeperId);
      if (!decrypted) {
        throw new Error(
          `Credential source 'Keeper' (${keeperId}) not found. Check Integrations page.`,
        );
      }

      const deviceConfig = decrypted.credentials.credentials.deviceConfig;
      if (!deviceConfig) {
        throw new Error(
          `Keeper integration (${keeperId}) has no device config. Re-initialize the Keeper integration.`,
        );
      }

      const sdk = await import('@keeper-security/secrets-manager-core');
      const storage = sdk.inMemoryStorage(JSON.parse(deviceConfig));

      // Collect unique record UIDs for this Keeper instance
      const recordUids = [...new Set(groupRefs.map((r) => r.recordUid))];

      let secrets: {
        records: Array<{
          recordUid: string;
          data: {
            title: string;
            type: string;
            fields: Array<{ type: string; value: unknown[]; label?: string }>;
            custom?: Array<{ type: string; value: unknown[]; label?: string }>;
          };
        }>;
      };
      try {
        secrets = await sdk.getSecrets({ storage }, recordUids);
      } catch (error) {
        throw new Error(
          `Cannot reach Keeper vault. Check network connectivity. (${error instanceof Error ? error.message : 'Unknown error'})`,
        );
      }

      for (const ref of groupRefs) {
        const record = secrets.records.find((r) => r.recordUid === ref.recordUid);
        if (!record) {
          throw new Error(
            `Keeper record ${ref.recordUid} not accessible. Verify the Application has access to this record's Shared Folder.`,
          );
        }

        const value = extractField(record, ref);
        if (value === undefined) {
          throw new Error(`Field '${ref.fieldType}' not found on Keeper record ${ref.recordUid}.`);
        }

        resolved[ref.originalKey] = value;
      }
    }

    return { ...credentials, credentials: resolved };
  }
}

function extractField(
  record: {
    data: {
      fields: Array<{
        type: string;
        value: unknown[];
        label?: string;
      }>;
      custom?: Array<{
        type: string;
        value: unknown[];
        label?: string;
      }>;
    };
  },
  ref: KeeperReference,
): string | undefined {
  const fields = ref.selector === 'custom_field' ? (record.data.custom ?? []) : record.data.fields;

  const field =
    ref.selector === 'custom_field'
      ? fields.find((f) => f.label === ref.fieldType)
      : fields.find((f) => f.type === ref.fieldType);

  if (!field || !field.value || field.value.length === 0) {
    return undefined;
  }

  const val = field.value[0];
  return typeof val === 'string' ? val : String(val);
}
