import crypto from 'node:crypto';
import type { SondeDb } from '../db/index.js';
import { encrypt, decrypt } from './crypto.js';
import type { IntegrationExecutor } from './executor.js';
import type { IntegrationConfig, IntegrationCredentials, IntegrationPack } from './types.js';

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
      status: 'active',
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

    return { id, type: input.type, name: input.name, status: 'active', lastTestedAt: null, lastTestResult: null, createdAt: now };
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

    return true;
  }

  delete(id: string): boolean {
    const row = this.db.getIntegration(id);
    if (!row) return false;

    this.executor.unregisterPack(row.name);
    return this.db.deleteIntegration(id);
  }

  async testConnection(id: string): Promise<{ success: boolean; message?: string; testedAt: string }> {
    const row = this.db.getIntegration(id);
    if (!row) throw new Error('Integration not found');

    const decrypted = this.getDecryptedConfig(id);
    if (!decrypted) throw new Error('Failed to decrypt integration config');

    const pack = this.findPack(row.type);
    if (!pack) {
      const testedAt = new Date().toISOString();
      this.db.updateIntegration(id, { lastTestedAt: testedAt, lastTestResult: 'error: no pack definition' });
      return { success: false, message: 'No pack definition found for type: ' + row.type, testedAt };
    }

    const testedAt = new Date().toISOString();
    try {
      const success = await pack.testConnection(decrypted.config, decrypted.credentials, globalThis.fetch.bind(globalThis));
      const result = success ? 'ok' : 'failed';
      this.db.updateIntegration(id, {
        lastTestedAt: testedAt,
        lastTestResult: result,
        status: success ? 'active' : 'error',
      });
      return { success, testedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.db.updateIntegration(id, {
        lastTestedAt: testedAt,
        lastTestResult: `error: ${message}`,
        status: 'error',
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

  getDecryptedConfig(id: string): { config: IntegrationConfig; credentials: IntegrationCredentials } | undefined {
    const row = this.db.getIntegration(id);
    if (!row) return undefined;

    const blob = decrypt(row.configEncrypted, this.secret);
    return JSON.parse(blob) as { config: IntegrationConfig; credentials: IntegrationCredentials };
  }

  private findPack(type: string): IntegrationPack | undefined {
    return this.packCatalog.get(type);
  }
}
