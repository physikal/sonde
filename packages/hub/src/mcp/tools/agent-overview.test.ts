import { describe, expect, it, vi } from 'vitest';
import type { SondeDb } from '../../db/index.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';
import { handleAgentOverview } from './agent-overview.js';

function createMockDb(agent?: Record<string, unknown>): SondeDb {
  return {
    getAgent: vi.fn().mockReturnValue(agent),
  } as unknown as SondeDb;
}

function createMockDispatcher(online = false): AgentDispatcher {
  return {
    isAgentOnline: vi.fn().mockReturnValue(online),
  } as unknown as AgentDispatcher;
}

const SAMPLE_AGENT = {
  id: 'a1',
  name: 'server-1',
  status: 'offline',
  lastSeen: '2024-01-15T10:00:00.000Z',
  os: 'Ubuntu 22.04',
  agentVersion: '0.1.0',
  packs: [
    { name: 'system', version: '0.1.0', status: 'active' },
    { name: 'docker', version: '0.1.0', status: 'active' },
  ],
};

describe('handleAgentOverview', () => {
  it('returns agent details with online status', () => {
    const result = handleAgentOverview(
      { agent: 'server-1' },
      createMockDb(SAMPLE_AGENT),
      createMockDispatcher(true),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.name).toBe('server-1');
    expect(parsed.status).toBe('online');
    expect(parsed.packs).toHaveLength(2);
    expect(parsed.os).toBe('Ubuntu 22.04');
  });

  it('returns offline status when agent is not connected', () => {
    const result = handleAgentOverview(
      { agent: 'server-1' },
      createMockDb(SAMPLE_AGENT),
      createMockDispatcher(false),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.status).toBe('offline');
  });

  it('returns error when agent not found', () => {
    const result = handleAgentOverview(
      { agent: 'ghost' },
      createMockDb(undefined),
      createMockDispatcher(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Agent "ghost" not found');
  });
});
