import crypto from 'node:crypto';
import type { SondeDb } from '../db/index.js';
import { decrypt, encrypt } from './crypto.js';
import type { IntegrationExecutor } from './executor.js';
import type { FetchFn, IntegrationConfig, IntegrationCredentials, IntegrationPack } from './types.js';
import { buildTlsFetch } from './tls-fetch.js';

/** Non-sensitive config snapshot for event logging */
function configSummary(
  config: IntegrationConfig,
): Record<string, unknown> {
  return {
    endpoint: config.endpoint,
    headerKeys: config.headers
      ? Object.keys(config.headers)
      : [],
    tlsRejectUnauthorized: config.tlsRejectUnauthorized ?? true,
  };
}

/** Non-sensitive credential snapshot for event logging */
function credentialSummary(
  creds: IntegrationCredentials,
): Record<string, unknown> {
  return {
    authMethod: creds.authMethod,
    credentialKeys: Object.keys(creds.credentials),
    hasOAuth2: !!creds.oauth2,
  };
}

interface CreateInput {
  type: string;
  name: string;
  config: IntegrationConfig;
  credentials: IntegrationCredentials;
}

interface UpdateInput {
  config?: IntegrationConfig;
  credentials?: IntegrationCredentials;
}

interface IntegrationSummary {
  id: string;
  type: string;
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
}

export class IntegrationManager {
  constructor(
    private db: SondeDb,
    private executor: IntegrationExecutor,
    private secret: string,
    private packCatalog: ReadonlyMap<string, IntegrationPack> = new Map(),
  ) {}

  create(input: CreateInput): IntegrationSummary {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const blob = JSON.stringify({ config: input.config, credentials: input.credentials });
    const configEncrypted = encrypt(blob, this.secret);

    this.db.createIntegration({
      id,
      type: input.type,
      name: input.name,
      configEncrypted,
      status: 'untested',
      lastTestedAt: null,
      lastTestResult: null,
      createdAt: now,
      updatedAt: now,
    });

    // Register with executor if a pack definition is available
    const pack = this.findPack(input.type);
    if (pack) {
      this.executor.registerPack(pack, input.config, input.credentials);
    }

    this.db.logIntegrationEvent({
      integrationId: id,
      eventType: 'created',
      status: 'success',
      message: `Integration "${input.name}" created (type: ${input.type})`,
      detailJson: JSON.stringify({
        config: configSummary(input.config),
        credentials: credentialSummary(input.credentials),
      }),
    });

    return {
      id,
      type: input.type,
      name: input.name,
      status: 'untested',
      lastTestedAt: null,
      lastTestResult: null,
      createdAt: now,
    };
  }

  list(): IntegrationSummary[] {
    return this.db.listIntegrations().map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      lastTestedAt: row.lastTestedAt,
      lastTestResult: row.lastTestResult,
      createdAt: row.createdAt,
    }));
  }

  get(id: string): IntegrationSummary | undefined {
    const row = this.db.getIntegration(id);
    if (!row) return undefined;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      lastTestedAt: row.lastTestedAt,
      lastTestResult: row.lastTestResult,
      createdAt: row.createdAt,
    };
  }

  update(id: string, input: UpdateInput): boolean {
    const row = this.db.getIntegration(id);
    if (!row) return false;

    const existing = this.getDecryptedConfig(id);
    if (!existing) return false;

    const merged = {
      config: input.config ?? existing.config,
      credentials: input.credentials ?? existing.credentials,
    };

    const blob = JSON.stringify(merged);
    const configEncrypted = encrypt(blob, this.secret);

    this.db.updateIntegration(id, { configEncrypted });

    // Re-register with executor
    this.executor.unregisterPack(row.name);
    const pack = this.findPack(row.type);
    if (pack) {
      this.executor.registerPack(pack, merged.config, merged.credentials);
    }

    if (input.config) {
      this.db.logIntegrationEvent({
        integrationId: id,
        eventType: 'config_update',
        status: 'success',
        message: 'Configuration updated',
        detailJson: JSON.stringify({
          savedConfig: configSummary(merged.config),
        }),
      });
    }
    if (input.credentials) {
      this.db.logIntegrationEvent({
        integrationId: id,
        eventType: 'credentials_update',
        status: 'success',
        message: 'Credentials updated',
        detailJson: JSON.stringify({
          savedCredentials: credentialSummary(merged.credentials),
        }),
      });
    }

    return true;
  }

  delete(id: string): boolean {
    const row = this.db.getIntegration(id);
    if (!row) return false;

    this.executor.unregisterPack(row.name);
    return this.db.deleteIntegration(id);
  }

  async testConnection(
    id: string,
  ): Promise<{ success: boolean; message?: string; testedAt: string }> {
    const row = this.db.getIntegration(id);
    if (!row) throw new Error('Integration not found');

    const decrypted = this.getDecryptedConfig(id);
    if (!decrypted) throw new Error('Failed to decrypt integration config');

    const pack = this.findPack(row.type);
    if (!pack) {
      const testedAt = new Date().toISOString();
      this.db.updateIntegration(id, {
        lastTestedAt: testedAt,
        lastTestResult: 'error: no pack definition',
      });
      return {
        success: false,
        message: 'No pack definition found for type: ' + row.type,
        testedAt,
      };
    }

    const testedAt = new Date().toISOString();
    try {
      const fetchFn = buildTlsFetch(decrypted.config);
      const success = await pack.testConnection(
        decrypted.config,
        decrypted.credentials,
        fetchFn,
      );
      const result = success ? 'ok' : 'failed';
      this.db.updateIntegration(id, {
        lastTestedAt: testedAt,
        lastTestResult: result,
        status: success ? 'active' : 'error',
      });

      const testDetail = {
        effectiveConfig: configSummary(decrypted.config),
      };

      if (success) {
        this.db.logIntegrationEvent({
          integrationId: id,
          eventType: 'test_connection',
          status: 'success',
          message: 'Connection test passed',
          detailJson: JSON.stringify(testDetail),
        });
        return { success: true, testedAt };
      }

      this.db.logIntegrationEvent({
        integrationId: id,
        eventType: 'test_connection',
        status: 'error',
        message: 'Connection refused or authentication failed',
        detailJson: JSON.stringify(testDetail),
      });
      return {
        success: false,
        message: 'Connection refused or authentication failed',
        testedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.db.updateIntegration(id, {
        lastTestedAt: testedAt,
        lastTestResult: `error: ${message}`,
        status: 'error',
      });

      const detail: Record<string, unknown> = {
        effectiveConfig: configSummary(decrypted.config),
        errorName: error instanceof Error ? error.constructor.name : 'Unknown',
        errorMessage: message,
      };
      if (error instanceof Error && error.cause) {
        const cause = error.cause;
        if (cause instanceof Error) {
          detail.causeName = cause.constructor.name;
          detail.causeMessage = cause.message;
          if ('code' in cause) detail.causeCode = cause.code;
        } else {
          detail.cause = String(cause);
        }
      }

      this.db.logIntegrationEvent({
        integrationId: id,
        eventType: 'test_connection',
        status: 'error',
        message,
        detailJson: JSON.stringify(detail),
      });

      return { success: false, message, testedAt };
    }
  }

  loadAll(): void {
    const rows = this.db.listIntegrations();
    for (const row of rows) {
      if (row.status === 'inactive') continue;

      try {
        const decrypted = this.getDecryptedConfig(row.id);
        if (!decrypted) continue;

        const pack = this.findPack(row.type);
        if (!pack) continue;

        this.executor.registerPack(pack, decrypted.config, decrypted.credentials);
      } catch {
        // Skip integrations that fail to decrypt (e.g. API key changed)
      }
    }
  }

  getConfig(id: string): IntegrationConfig | undefined {
    const decrypted = this.getDecryptedConfig(id);
    return decrypted?.config;
  }

  getDecryptedConfig(
    id: string,
  ): { config: IntegrationConfig; credentials: IntegrationCredentials } | undefined {
    const row = this.db.getIntegration(id);
    if (!row) return undefined;

    const blob = decrypt(row.configEncrypted, this.secret);
    return JSON.parse(blob) as { config: IntegrationConfig; credentials: IntegrationCredentials };
  }

  private findPack(type: string): IntegrationPack | undefined {
    return this.packCatalog.get(type);
  }
}
