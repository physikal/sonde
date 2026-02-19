import { describe, expect, it, vi } from 'vitest';
import type { SondeDb } from '../../db/index.js';
import type { AgentDispatcher } from '../../ws/dispatcher.js';
import { handleListAgents } from './list-agents.js';

function createMockDb(agents: Array<Record<string, unknown>> = []): SondeDb {
  return {
    getAllAgents: vi.fn().mockReturnValue(agents),
    getAllAgentTags: vi.fn().mockReturnValue(new Map()),
  } as unknown as SondeDb;
}

function createMockDispatcher(onlineIds: string[] = []): AgentDispatcher {
  return {
    getOnlineAgentIds: vi.fn().mockReturnValue(onlineIds),
  } as unknown as AgentDispatcher;
}

describe('handleListAgents', () => {
  it('returns all agents with status', () => {
    const db = createMockDb([
      {
        id: 'a1',
        name: 'server-1',
        status: 'offline',
        lastSeen: '2024-01-15T10:00:00.000Z',
        os: 'Linux',
        agentVersion: '0.1.0',
        packs: [{ name: 'system', version: '0.1.0', status: 'active' }],
      },
      {
        id: 'a2',
        name: 'server-2',
        status: 'offline',
        lastSeen: '2024-01-15T09:00:00.000Z',
        os: 'Linux',
        agentVersion: '0.1.0',
        packs: [],
      },
    ]);
    const dispatcher = createMockDispatcher(['a1']); // a1 is online

    const result = handleListAgents(db, dispatcher);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agents).toHaveLength(2);
    expect(parsed.agents[0].name).toBe('server-1');
    expect(parsed.agents[0].status).toBe('online'); // overridden because a1 is online
    expect(parsed.agents[1].status).toBe('offline'); // stays offline
  });

  it('returns empty array when no agents', () => {
    const result = handleListAgents(createMockDb([]), createMockDispatcher());

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agents).toHaveLength(0);
  });
});
