import type { ProbeRequest } from '@sonde/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../config.js';
import { AgentConnection, enrollWithHub } from './connection.js';
import { ProbeExecutor } from './executor.js';

// Mock WebSocket
const mockWsInstances: Array<{
  url: string;
  handlers: Record<string, (...args: unknown[]) => void>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}> = [];

vi.mock('ws', () => {
  const OPEN = 1;
  const CLOSED = 3;

  class MockWebSocket {
    url: string;
    readyState: number;
    send = vi.fn();
    close = vi.fn();
    private handlers: Record<string, (...args: unknown[]) => void> = {};

    constructor(url: string, _opts?: unknown) {
      this.url = url;
      this.readyState = OPEN;
      mockWsInstances.push({
        url,
        handlers: this.handlers,
        send: this.send,
        close: this.close,
        readyState: this.readyState,
      });
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers[event] = handler;
    }

    // Helper: simulate receiving events from tests
    _emit(event: string, ...args: unknown[]) {
      this.handlers[event]?.(...args);
    }
  }

  // Attach static constants
  (MockWebSocket as unknown as Record<string, number>).OPEN = OPEN;
  (MockWebSocket as unknown as Record<string, number>).CLOSED = CLOSED;

  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

function createConfig(): AgentConfig {
  return {
    hubUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    agentName: 'test-agent',
  };
}

function createExecutor(): ProbeExecutor {
  return new ProbeExecutor(new Map());
}

describe('AgentConnection', () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects to the correct WebSocket URL', () => {
    const conn = new AgentConnection(createConfig(), createExecutor());
    conn.start();

    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0]?.url).toBe('ws://localhost:3000/ws/agent');

    conn.stop();
  });

  it('converts https hub URL to wss', () => {
    const config = createConfig();
    config.hubUrl = 'https://hub.example.com';

    const conn = new AgentConnection(config, createExecutor());
    conn.start();

    expect(mockWsInstances[0]?.url).toBe('wss://hub.example.com/ws/agent');

    conn.stop();
  });

  it('sends register message on open', () => {
    const conn = new AgentConnection(createConfig(), createExecutor());
    conn.start();

    // Simulate WebSocket open
    const ws = mockWsInstances[0];
    ws?.handlers.open?.();

    expect(ws?.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws?.send.mock.calls[0]?.[0] as string);
    expect(sent.type).toBe('agent.register');
    expect(sent.payload.name).toBe('test-agent');

    conn.stop();
  });

  it('stores agentId from hub.ack', () => {
    const onRegistered = vi.fn();
    const conn = new AgentConnection(createConfig(), createExecutor(), { onRegistered });
    conn.start();

    const ws = mockWsInstances[0];
    ws?.handlers.open?.();

    // Simulate hub.ack
    ws?.handlers.message?.(
      JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        type: 'hub.ack',
        timestamp: new Date().toISOString(),
        agentId: 'assigned-id',
        signature: '',
        payload: { agentId: 'assigned-id' },
      }),
    );

    expect(onRegistered).toHaveBeenCalledWith('assigned-id');
    expect(conn.getAgentId()).toBe('assigned-id');

    conn.stop();
  });

  it('sends heartbeats on interval', () => {
    const conn = new AgentConnection(createConfig(), createExecutor());
    conn.start();

    const ws = mockWsInstances[0];
    ws?.handlers.open?.();

    // Simulate hub.ack to set agentId
    ws?.handlers.message?.(
      JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        type: 'hub.ack',
        timestamp: new Date().toISOString(),
        agentId: 'agent-1',
        signature: '',
        payload: { agentId: 'agent-1' },
      }),
    );

    // Register sends one message, ack handler sends another (onConnected)
    const callsBeforeHeartbeat = ws?.send.mock.calls.length ?? 0;

    // Advance time by 30 seconds (HEARTBEAT_INTERVAL_MS)
    vi.advanceTimersByTime(30_000);

    const heartbeatCalls = (ws?.send.mock.calls.length ?? 0) - callsBeforeHeartbeat;
    expect(heartbeatCalls).toBe(1);

    const lastCall = ws?.send.mock.calls.at(-1)?.[0] as string;
    const msg = JSON.parse(lastCall);
    expect(msg.type).toBe('agent.heartbeat');
    expect(msg.agentId).toBe('agent-1');

    conn.stop();
  });

  it('schedules reconnect with exponential backoff on close', () => {
    const onDisconnected = vi.fn();
    const conn = new AgentConnection(createConfig(), createExecutor(), { onDisconnected });
    conn.start();

    const ws = mockWsInstances[0];

    // First disconnect
    ws?.handlers.close?.();
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(mockWsInstances).toHaveLength(1); // Not reconnected yet

    // Advance past first reconnect delay (1s)
    vi.advanceTimersByTime(1_000);
    expect(mockWsInstances).toHaveLength(2); // Reconnected

    // Second disconnect
    mockWsInstances[1]?.handlers.close?.();

    // Advance 1s — should NOT reconnect yet (backoff is 2s)
    vi.advanceTimersByTime(1_000);
    expect(mockWsInstances).toHaveLength(2);

    // Advance another 1s (total 2s) — should reconnect
    vi.advanceTimersByTime(1_000);
    expect(mockWsInstances).toHaveLength(3);

    conn.stop();
  });

  it('does not reconnect after stop()', () => {
    const conn = new AgentConnection(createConfig(), createExecutor());
    conn.start();

    conn.stop();

    const ws = mockWsInstances[0];
    ws?.handlers.close?.();

    vi.advanceTimersByTime(60_000);
    expect(mockWsInstances).toHaveLength(1); // No reconnect
  });
});

describe('enrollWithHub', () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects to correct URL and sends register', () => {
    const promise = enrollWithHub(createConfig(), createExecutor());

    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0]?.url).toBe('ws://localhost:3000/ws/agent');

    const ws = mockWsInstances[0];
    ws?.handlers.open?.();

    expect(ws?.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws?.send.mock.calls[0]?.[0] as string);
    expect(sent.type).toBe('agent.register');
    expect(sent.payload.name).toBe('test-agent');

    // Send ack to resolve and avoid dangling promise
    ws?.handlers.message?.(
      JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        type: 'hub.ack',
        timestamp: new Date().toISOString(),
        agentId: 'enrolled-id',
        signature: '',
        payload: { agentId: 'enrolled-id' },
      }),
    );

    return promise;
  });

  it('returns agentId from hub.ack', async () => {
    const promise = enrollWithHub(createConfig(), createExecutor());

    const ws = mockWsInstances[0];
    ws?.handlers.open?.();

    ws?.handlers.message?.(
      JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        type: 'hub.ack',
        timestamp: new Date().toISOString(),
        agentId: 'enrolled-id',
        signature: '',
        payload: { agentId: 'enrolled-id' },
      }),
    );

    await expect(promise).resolves.toBe('enrolled-id');
  });

  it('rejects on timeout when no ack received', async () => {
    const promise = enrollWithHub(createConfig(), createExecutor());

    const ws = mockWsInstances[0];
    ws?.handlers.open?.();

    // Advance past the 10s timeout
    vi.advanceTimersByTime(10_000);

    await expect(promise).rejects.toThrow('Enrollment timed out');
  });

  it('rejects on WebSocket error', async () => {
    const promise = enrollWithHub(createConfig(), createExecutor());

    const ws = mockWsInstances[0];
    ws?.handlers.error?.(new Error('Connection refused'));

    await expect(promise).rejects.toThrow('Connection refused');
  });
});
