import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SondeDb } from './index.js';

function createTempDb(): SondeDb {
  const tmpDir = os.tmpdir();
  const dbPath = path.join(
    tmpDir,
    `sonde-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  return new SondeDb(dbPath);
}

function createIntegration(db: SondeDb): string {
  const id = `int-${Math.random().toString(36).slice(2)}`;
  db.createIntegration({
    id,
    type: 'httpbin',
    name: `test-${id}`,
    configEncrypted: 'enc-blob',
    status: 'untested',
    lastTestedAt: null,
    lastTestResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

describe('Integration Events', () => {
  let db: SondeDb;

  beforeEach(() => {
    db = createTempDb();
  });

  it('inserts and retrieves an event', () => {
    const integrationId = createIntegration(db);

    db.logIntegrationEvent({
      integrationId,
      eventType: 'created',
      status: 'success',
      message: 'Integration created',
    });

    const events = db.getIntegrationEvents(integrationId);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('created');
    expect(events[0]!.status).toBe('success');
    expect(events[0]!.message).toBe('Integration created');
    expect(events[0]!.integrationId).toBe(integrationId);
    expect(events[0]!.createdAt).toBeDefined();
  });

  it('stores and retrieves detailJson', () => {
    const integrationId = createIntegration(db);
    const detail = { errorName: 'TypeError', causeCode: 'ECONNREFUSED' };

    db.logIntegrationEvent({
      integrationId,
      eventType: 'test_connection',
      status: 'error',
      message: 'fetch failed',
      detailJson: JSON.stringify(detail),
    });

    const events = db.getIntegrationEvents(integrationId);
    expect(events[0]!.detailJson).toBe(JSON.stringify(detail));
  });

  it('returns events in reverse chronological order', () => {
    const integrationId = createIntegration(db);

    db.logIntegrationEvent({
      integrationId,
      eventType: 'created',
      message: 'first',
    });
    // Small delay to ensure different timestamps
    db.logIntegrationEvent({
      integrationId,
      eventType: 'test_connection',
      message: 'second',
    });
    db.logIntegrationEvent({
      integrationId,
      eventType: 'config_update',
      message: 'third',
    });

    const events = db.getIntegrationEvents(integrationId);
    expect(events).toHaveLength(3);
    // Most recent first
    expect(events[0]!.message).toBe('third');
    expect(events[2]!.message).toBe('first');
  });

  it('respects limit and offset pagination', () => {
    const integrationId = createIntegration(db);

    for (let i = 0; i < 10; i++) {
      db.logIntegrationEvent({
        integrationId,
        eventType: 'probe_execution',
        message: `event-${i}`,
      });
    }

    const page1 = db.getIntegrationEvents(integrationId, { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = db.getIntegrationEvents(integrationId, { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);

    // No overlap between pages
    const page1Ids = page1.map((e) => e.id);
    const page2Ids = page2.map((e) => e.id);
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
  });

  it('cascades delete when integration is deleted', () => {
    const integrationId = createIntegration(db);

    db.logIntegrationEvent({
      integrationId,
      eventType: 'created',
      message: 'will be deleted',
    });
    db.logIntegrationEvent({
      integrationId,
      eventType: 'test_connection',
      message: 'also deleted',
    });

    expect(db.getIntegrationEvents(integrationId)).toHaveLength(2);

    db.deleteIntegration(integrationId);

    expect(db.getIntegrationEvents(integrationId)).toHaveLength(0);
  });

  it('returns empty array for unknown integration', () => {
    const events = db.getIntegrationEvents('non-existent-id');
    expect(events).toHaveLength(0);
  });
});
