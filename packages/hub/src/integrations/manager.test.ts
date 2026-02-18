import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SondeDb } from '../db/index.js';
import { decrypt } from './crypto.js';
import { IntegrationExecutor } from './executor.js';
import { IntegrationManager } from './manager.js';
import type { IntegrationConfig, IntegrationCredentials, IntegrationPack } from './types.js';

const SECRET = 'test-api-key-1234567890';

const testConfig: IntegrationConfig = {
  endpoint: 'https://api.cloudflare.com/v4',
  headers: { 'X-Custom': 'value' },
};

const testCredentials: IntegrationCredentials = {
  packName: 'cloudflare',
  authMethod: 'api_key',
  credentials: { apiKey: 'cf-secret-key-123' },
};

function createTestPack(name = 'cloudflare'): IntegrationPack {
  return {
    manifest: {
      name,
      type: 'integration',
      version: '0.1.0',
      description: 'Test pack',
      requires: { groups: [], files: [], commands: [] },
      probes: [
        { name: 'zones.list', description: 'List zones', capability: 'observe', timeout: 5000 },
      ],
    },
    handlers: {
      'zones.list': vi.fn().mockResolvedValue({ zones: [] }),
    },
    testConnection: vi.fn().mockResolvedValue(true),
  };
}

function createTempDb(): SondeDb {
  const tmpDir = os.tmpdir();
  const dbPath = path.join(
    tmpDir,
    `sonde-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  return new SondeDb(dbPath);
}

describe('IntegrationManager', () => {
  let db: SondeDb;
  let executor: IntegrationExecutor;
  let manager: IntegrationManager;
  let catalog: Map<string, IntegrationPack>;

  beforeEach(() => {
    db = createTempDb();
    executor = new IntegrationExecutor(vi.fn());
    const testPack = createTestPack();
    catalog = new Map([['cloudflare', testPack]]);
    manager = new IntegrationManager(db, executor, SECRET, catalog);
  });

  it('creates an integration and stores encrypted config in DB', () => {
    const result = manager.create({
      type: 'cloudflare',
      name: 'my-cf',
      config: testConfig,
      credentials: testCredentials,
    });

    expect(result.id).toBeDefined();
    expect(result.type).toBe('cloudflare');
    expect(result.name).toBe('my-cf');
    expect(result.status).toBe('untested');

    // Verify the DB row has encrypted config
    const row = db.getIntegration(result.id);
    expect(row).toBeDefined();
    expect(row!.configEncrypted).toBeDefined();
    // Encrypted blob should not contain the plaintext secret
    expect(row!.configEncrypted).not.toContain('cf-secret-key-123');

    // Verify decryption works
    const decrypted = JSON.parse(decrypt(row!.configEncrypted, SECRET));
    expect(decrypted.config.endpoint).toBe('https://api.cloudflare.com/v4');
    expect(decrypted.credentials.credentials.apiKey).toBe('cf-secret-key-123');
  });

  it('lists integrations without credentials', () => {
    manager.create({
      type: 'cloudflare',
      name: 'cf-1',
      config: testConfig,
      credentials: testCredentials,
    });
    manager.create({
      type: 'datadog',
      name: 'dd-1',
      config: testConfig,
      credentials: testCredentials,
    });

    const list = manager.list();

    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('cf-1');
    expect(list[1]!.name).toBe('dd-1');
    // Ensure no credentials leak
    for (const item of list) {
      expect(item).not.toHaveProperty('configEncrypted');
      expect(item).not.toHaveProperty('credentials');
    }
  });

  it('gets a single integration without credentials', () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-get',
      config: testConfig,
      credentials: testCredentials,
    });

    const result = manager.get(created.id);

    expect(result).toBeDefined();
    expect(result!.id).toBe(created.id);
    expect(result!.name).toBe('cf-get');
    expect(result).not.toHaveProperty('configEncrypted');
  });

  it('returns undefined for non-existent integration', () => {
    expect(manager.get('non-existent-id')).toBeUndefined();
  });

  it('updates integration config and re-encrypts', () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-update',
      config: testConfig,
      credentials: testCredentials,
    });

    const newConfig: IntegrationConfig = { endpoint: 'https://api.new-endpoint.com' };
    const updated = manager.update(created.id, { config: newConfig });

    expect(updated).toBe(true);

    // Verify decrypted config has new endpoint but same credentials
    const decrypted = manager.getDecryptedConfig(created.id);
    expect(decrypted!.config.endpoint).toBe('https://api.new-endpoint.com');
    expect(decrypted!.credentials.credentials.apiKey).toBe('cf-secret-key-123');
  });

  it('updates integration credentials and re-encrypts', () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-creds',
      config: testConfig,
      credentials: testCredentials,
    });

    const newCreds: IntegrationCredentials = {
      packName: 'cloudflare',
      authMethod: 'api_key',
      credentials: { apiKey: 'new-secret-key' },
    };
    manager.update(created.id, { credentials: newCreds });

    const decrypted = manager.getDecryptedConfig(created.id);
    expect(decrypted!.credentials.credentials.apiKey).toBe('new-secret-key');
    expect(decrypted!.config.endpoint).toBe('https://api.cloudflare.com/v4');
  });

  it('returns false when updating non-existent integration', () => {
    expect(manager.update('non-existent', { config: testConfig })).toBe(false);
  });

  it('deletes integration from DB and unregisters from executor', () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-delete',
      config: testConfig,
      credentials: testCredentials,
    });

    // After create, the pack is registered on executor
    expect(executor.isIntegrationProbe('cloudflare.zones.list')).toBe(true);

    const deleted = manager.delete(created.id);

    expect(deleted).toBe(true);
    expect(db.getIntegration(created.id)).toBeUndefined();
  });

  it('returns false when deleting non-existent integration', () => {
    expect(manager.delete('non-existent')).toBe(false);
  });

  it('testConnection calls pack.testConnection with decrypted creds', async () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-test',
      config: testConfig,
      credentials: testCredentials,
    });

    const result = await manager.testConnection(created.id);

    expect(result.success).toBe(true);
    expect(result.testedAt).toBeDefined();

    // Verify DB was updated
    const row = db.getIntegration(created.id);
    expect(row!.lastTestedAt).toBeDefined();
    expect(row!.lastTestResult).toBe('ok');
  });

  it('testConnection handles pack test failure', async () => {
    (catalog.get('cloudflare')!.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
      false,
    );

    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-fail',
      config: testConfig,
      credentials: testCredentials,
    });

    const result = await manager.testConnection(created.id);

    expect(result.success).toBe(false);

    const row = db.getIntegration(created.id);
    expect(row!.lastTestResult).toBe('failed');
    expect(row!.status).toBe('error');
  });

  it('testConnection handles pack test exception', async () => {
    (catalog.get('cloudflare')!.testConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused'),
    );

    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-err',
      config: testConfig,
      credentials: testCredentials,
    });

    const result = await manager.testConnection(created.id);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Connection refused');
  });

  it('throws when testing non-existent integration', async () => {
    await expect(manager.testConnection('non-existent')).rejects.toThrow('Integration not found');
  });

  it('loadAll registers active integrations with executor', () => {
    // Create integrations in DB
    manager.create({
      type: 'cloudflare',
      name: 'cf-load-1',
      config: testConfig,
      credentials: testCredentials,
    });
    manager.create({
      type: 'cloudflare',
      name: 'cf-load-2',
      config: testConfig,
      credentials: testCredentials,
    });

    // Simulate restart: fresh executor with no registered packs
    const freshExecutor = new IntegrationExecutor(vi.fn());
    const freshManager = new IntegrationManager(db, freshExecutor, SECRET, catalog);
    freshManager.loadAll();

    // The executor should have the pack registered from loadAll via catalog lookup
    expect(freshExecutor.isIntegrationProbe('cloudflare.zones.list')).toBe(true);
  });

  it('logs a created event on create()', () => {
    const result = manager.create({
      type: 'cloudflare',
      name: 'cf-event',
      config: testConfig,
      credentials: testCredentials,
    });

    const events = db.getIntegrationEvents(result.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('created');
    expect(events[0]!.status).toBe('success');
  });

  it('logs test_connection success event', async () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-test-event',
      config: testConfig,
      credentials: testCredentials,
    });

    await manager.testConnection(created.id);

    const events = db.getIntegrationEvents(created.id);
    const testEvents = events.filter((e) => e.eventType === 'test_connection');
    expect(testEvents).toHaveLength(1);
    expect(testEvents[0]!.status).toBe('success');
  });

  it('logs test_connection error event on failure', async () => {
    (catalog.get('cloudflare')!.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
      false,
    );

    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-fail-event',
      config: testConfig,
      credentials: testCredentials,
    });

    await manager.testConnection(created.id);

    const events = db.getIntegrationEvents(created.id);
    const testEvents = events.filter((e) => e.eventType === 'test_connection');
    expect(testEvents).toHaveLength(1);
    expect(testEvents[0]!.status).toBe('error');
  });

  it('captures error.cause in detailJson on TypeError', async () => {
    const cause = new Error('getaddrinfo ENOTFOUND api.example.com');
    (cause as NodeJS.ErrnoException).code = 'ENOTFOUND';
    const fetchError = new TypeError('fetch failed', { cause });
    (catalog.get('cloudflare')!.testConnection as ReturnType<typeof vi.fn>).mockRejectedValue(
      fetchError,
    );

    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-cause-event',
      config: testConfig,
      credentials: testCredentials,
    });

    await manager.testConnection(created.id);

    const events = db.getIntegrationEvents(created.id);
    const testEvents = events.filter((e) => e.eventType === 'test_connection');
    expect(testEvents).toHaveLength(1);

    const detail = JSON.parse(testEvents[0]!.detailJson!);
    expect(detail.errorName).toBe('TypeError');
    expect(detail.causeName).toBe('Error');
    expect(detail.causeMessage).toContain('ENOTFOUND');
    expect(detail.causeCode).toBe('ENOTFOUND');
  });

  it('logs config_update and credentials_update events on update()', () => {
    const created = manager.create({
      type: 'cloudflare',
      name: 'cf-update-events',
      config: testConfig,
      credentials: testCredentials,
    });

    manager.update(created.id, {
      config: { endpoint: 'https://new.endpoint.com' },
      credentials: {
        packName: 'cloudflare',
        authMethod: 'api_key',
        credentials: { apiKey: 'new-key' },
      },
    });

    const events = db.getIntegrationEvents(created.id);
    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain('config_update');
    expect(eventTypes).toContain('credentials_update');
  });

  it('rejects duplicate names with 409', () => {
    manager.create({
      type: 'cloudflare',
      name: 'unique-name',
      config: testConfig,
      credentials: testCredentials,
    });

    expect(() =>
      manager.create({
        type: 'cloudflare',
        name: 'unique-name',
        config: testConfig,
        credentials: testCredentials,
      }),
    ).toThrow();
  });
});
