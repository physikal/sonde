import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { AgentDispatcher } from './dispatcher.js';

function createMockWs(): WebSocket {
  return {
    send: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  } as unknown as WebSocket;
}

describe('AgentDispatcher', () => {
  it('registers agent and allows lookup by name', () => {
    const dispatcher = new AgentDispatcher();
    const ws = createMockWs();

    dispatcher.registerAgent('agent-1', 'server-1', ws);

    expect(dispatcher.isAgentOnline('server-1')).toBe(true);
    expect(dispatcher.isAgentOnline('agent-1')).toBe(true);
    expect(dispatcher.isAgentOnline('unknown')).toBe(false);
  });

  it('tracks online agent IDs', () => {
    const dispatcher = new AgentDispatcher();

    dispatcher.registerAgent('a1', 'srv1', createMockWs());
    dispatcher.registerAgent('a2', 'srv2', createMockWs());

    expect(dispatcher.getOnlineAgentIds()).toEqual(['a1', 'a2']);
  });

  it('removes agent by ID', () => {
    const dispatcher = new AgentDispatcher();
    const ws = createMockWs();

    dispatcher.registerAgent('agent-1', 'server-1', ws);
    dispatcher.removeAgent('agent-1');

    expect(dispatcher.isAgentOnline('server-1')).toBe(false);
    expect(dispatcher.getOnlineAgentIds()).toEqual([]);
  });

  it('removes agent by socket', () => {
    const dispatcher = new AgentDispatcher();
    const ws = createMockWs();

    dispatcher.registerAgent('agent-1', 'server-1', ws);
    dispatcher.removeBySocket(ws);

    expect(dispatcher.isAgentOnline('server-1')).toBe(false);
  });

  it('stale socket close does not evict re-registered agent', () => {
    const dispatcher = new AgentDispatcher();
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    // Agent registers with ws1
    dispatcher.registerAgent('agent-1', 'server-1', ws1);
    expect(dispatcher.getOnlineAgentIds()).toEqual(['agent-1']);

    // Agent reconnects with ws2 (ws1 hasn't closed yet)
    dispatcher.registerAgent('agent-1', 'server-1', ws2);
    expect(dispatcher.getOnlineAgentIds()).toEqual(['agent-1']);

    // Old ws1 finally closes — must NOT remove the live ws2 connection
    dispatcher.removeBySocket(ws1);
    expect(dispatcher.getOnlineAgentIds()).toEqual(['agent-1']);
    expect(dispatcher.isAgentOnline('server-1')).toBe(true);
  });

  it('rejects probe for unknown agent', async () => {
    const dispatcher = new AgentDispatcher();

    await expect(dispatcher.sendProbe('unknown', 'system.disk.usage')).rejects.toThrow('not found');
  });

  it('sends probe request to agent WebSocket', async () => {
    const dispatcher = new AgentDispatcher();
    const ws = createMockWs();
    dispatcher.registerAgent('agent-1', 'server-1', ws);

    // Start probe but don't await — simulate async
    const probePromise = dispatcher.sendProbe('server-1', 'system.disk.usage', { all: true });

    // Verify message was sent
    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string);
    expect(sent.type).toBe('probe.request');
    expect(sent.payload.probe).toBe('system.disk.usage');
    expect(sent.payload.params).toEqual({ all: true });

    // Simulate response
    dispatcher.handleResponse('agent-1', {
      probe: 'system.disk.usage',
      status: 'success',
      data: { filesystems: [] },
      durationMs: 42,
      metadata: {
        agentVersion: '0.1.0',
        packName: 'system',
        packVersion: '0.1.0',
        capabilityLevel: 'observe',
      },
    });

    const result = await probePromise;
    expect(result.status).toBe('success');
    expect(result.durationMs).toBe(42);
  });

  it('rejects pending probe when agent disconnects', async () => {
    const dispatcher = new AgentDispatcher();
    const ws = createMockWs();
    dispatcher.registerAgent('agent-1', 'server-1', ws);

    const probePromise = dispatcher.sendProbe('server-1', 'system.cpu.usage');

    // Agent disconnects
    dispatcher.removeAgent('agent-1');

    await expect(probePromise).rejects.toThrow('disconnected');
  });
});
