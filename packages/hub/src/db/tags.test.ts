import { describe, expect, it } from 'vitest';
import { SondeDb } from './index.js';

function makeDb(): SondeDb {
  return new SondeDb(':memory:');
}

function createAgent(db: SondeDb, name: string): string {
  const id = `agent-${name}`;
  db.upsertAgent({
    id,
    name,
    status: 'online',
    lastSeen: new Date().toISOString(),
    os: 'linux',
    agentVersion: '1.0.0',
    packs: [],
  });
  return id;
}

function createIntegration(db: SondeDb, name: string): string {
  const id = `int-${name}`;
  db.createIntegration({
    id,
    type: 'httpbin',
    name,
    configEncrypted: 'enc-blob',
    status: 'untested',
    lastTestedAt: null,
    lastTestResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

describe('Agent tags', () => {
  it('returns empty array for agent with no tags', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');
    expect(db.getAgentTags(id)).toEqual([]);
    db.close();
  });

  it('sets and gets tags for an agent', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');

    db.setAgentTags(id, ['care', 'database', 'prod']);
    expect(db.getAgentTags(id)).toEqual(['care', 'database', 'prod']);
    db.close();
  });

  it('replaces all tags on setAgentTags', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');

    db.setAgentTags(id, ['old-tag']);
    db.setAgentTags(id, ['new-tag']);
    expect(db.getAgentTags(id)).toEqual(['new-tag']);
    db.close();
  });

  it('clears tags when setting empty array', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');

    db.setAgentTags(id, ['tag-a', 'tag-b']);
    db.setAgentTags(id, []);
    expect(db.getAgentTags(id)).toEqual([]);
    db.close();
  });

  it('bulk adds tags to multiple agents', () => {
    const db = makeDb();
    const id1 = createAgent(db, 'srv-01');
    const id2 = createAgent(db, 'srv-02');

    db.addAgentTags([id1, id2], ['care', 'prod']);
    expect(db.getAgentTags(id1)).toEqual(['care', 'prod']);
    expect(db.getAgentTags(id2)).toEqual(['care', 'prod']);
    db.close();
  });

  it('addAgentTags ignores duplicates', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');

    db.setAgentTags(id, ['existing']);
    db.addAgentTags([id], ['existing', 'new']);
    expect(db.getAgentTags(id)).toEqual(['existing', 'new']);
    db.close();
  });

  it('bulk removes tags from multiple agents', () => {
    const db = makeDb();
    const id1 = createAgent(db, 'srv-01');
    const id2 = createAgent(db, 'srv-02');

    db.setAgentTags(id1, ['care', 'prod', 'database']);
    db.setAgentTags(id2, ['care', 'staging']);

    db.removeAgentTags([id1, id2], ['care']);
    expect(db.getAgentTags(id1)).toEqual(['database', 'prod']);
    expect(db.getAgentTags(id2)).toEqual(['staging']);
    db.close();
  });

  it('removeAgentTags ignores non-existent tags', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');

    db.setAgentTags(id, ['keep']);
    db.removeAgentTags([id], ['nonexistent']);
    expect(db.getAgentTags(id)).toEqual(['keep']);
    db.close();
  });

  it('getAllAgentTags returns map of all agent tags', () => {
    const db = makeDb();
    const id1 = createAgent(db, 'srv-01');
    const id2 = createAgent(db, 'srv-02');
    createAgent(db, 'srv-03'); // no tags

    db.setAgentTags(id1, ['care', 'prod']);
    db.setAgentTags(id2, ['staging']);

    const allTags = db.getAllAgentTags();
    expect(allTags.get(id1)).toEqual(['care', 'prod']);
    expect(allTags.get(id2)).toEqual(['staging']);
    expect(allTags.has('agent-srv-03')).toBe(false);
    db.close();
  });

  it('tags are returned sorted alphabetically', () => {
    const db = makeDb();
    const id = createAgent(db, 'srv-01');

    db.setAgentTags(id, ['zebra', 'apple', 'mango']);
    expect(db.getAgentTags(id)).toEqual(['apple', 'mango', 'zebra']);
    db.close();
  });
});

describe('Integration tags', () => {
  it('returns empty array for integration with no tags', () => {
    const db = makeDb();
    const id = createIntegration(db, 'my-datadog');
    expect(db.getIntegrationTags(id)).toEqual([]);
    db.close();
  });

  it('sets and gets tags for an integration', () => {
    const db = makeDb();
    const id = createIntegration(db, 'my-datadog');

    db.setIntegrationTags(id, ['monitoring', 'prod']);
    expect(db.getIntegrationTags(id)).toEqual(['monitoring', 'prod']);
    db.close();
  });

  it('replaces all tags on setIntegrationTags', () => {
    const db = makeDb();
    const id = createIntegration(db, 'my-datadog');

    db.setIntegrationTags(id, ['old']);
    db.setIntegrationTags(id, ['new']);
    expect(db.getIntegrationTags(id)).toEqual(['new']);
    db.close();
  });

  it('bulk adds tags to multiple integrations', () => {
    const db = makeDb();
    const id1 = createIntegration(db, 'dd-prod');
    const id2 = createIntegration(db, 'dd-staging');

    db.addIntegrationTags([id1, id2], ['monitoring']);
    expect(db.getIntegrationTags(id1)).toEqual(['monitoring']);
    expect(db.getIntegrationTags(id2)).toEqual(['monitoring']);
    db.close();
  });

  it('bulk removes tags from multiple integrations', () => {
    const db = makeDb();
    const id1 = createIntegration(db, 'dd-prod');
    const id2 = createIntegration(db, 'dd-staging');

    db.setIntegrationTags(id1, ['monitoring', 'prod']);
    db.setIntegrationTags(id2, ['monitoring', 'staging']);

    db.removeIntegrationTags([id1, id2], ['monitoring']);
    expect(db.getIntegrationTags(id1)).toEqual(['prod']);
    expect(db.getIntegrationTags(id2)).toEqual(['staging']);
    db.close();
  });

  it('getAllIntegrationTags returns map of all integration tags', () => {
    const db = makeDb();
    const id1 = createIntegration(db, 'dd-prod');
    const id2 = createIntegration(db, 'dd-staging');

    db.setIntegrationTags(id1, ['monitoring', 'prod']);
    db.setIntegrationTags(id2, ['staging']);

    const allTags = db.getAllIntegrationTags();
    expect(allTags.get(id1)).toEqual(['monitoring', 'prod']);
    expect(allTags.get(id2)).toEqual(['staging']);
    db.close();
  });

  it('tags cascade on integration delete', () => {
    const db = makeDb();
    const id = createIntegration(db, 'my-datadog');
    db.setIntegrationTags(id, ['monitoring']);

    const deleted = db.deleteIntegration(id);
    expect(deleted).toBe(true);
    expect(db.getIntegrationTags(id)).toEqual([]);
    db.close();
  });
});
