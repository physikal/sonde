import {
  HEARTBEAT_INTERVAL_MS,
  type MessageEnvelope,
  MessageEnvelope as MessageEnvelopeSchema,
  type ProbeRequest,
  ProbeRequest as ProbeRequestSchema,
} from '@sonde/shared';
import WebSocket from 'ws';
import type { AgentConfig } from '../config.js';
import type { ProbeExecutor } from './executor.js';

export interface ConnectionEvents {
  onConnected?: (agentId: string) => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onRegistered?: (agentId: string) => void;
}

/** Minimum/maximum reconnect delays */
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 60_000;

const ENROLL_TIMEOUT_MS = 10_000;

/**
 * One-shot enrollment: connect to hub, register, get agentId, disconnect.
 * Validates the hub URL and API key at enrollment time.
 */
export function enrollWithHub(config: AgentConfig, executor: ProbeExecutor): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${config.hubUrl.replace(/^http/, 'ws')}/ws/agent`;

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Enrollment timed out waiting for hub acknowledgement'));
    }, ENROLL_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          id: crypto.randomUUID(),
          type: 'agent.register',
          timestamp: new Date().toISOString(),
          signature: '',
          payload: {
            name: config.agentName,
            os: `${process.platform} ${process.arch}`,
            agentVersion: '0.1.0',
            packs: executor.getLoadedPacks(),
          },
        }),
      );
    });

    ws.on('message', (data) => {
      let envelope: MessageEnvelope;
      try {
        envelope = MessageEnvelopeSchema.parse(JSON.parse(data.toString()));
      } catch {
        return;
      }

      if (envelope.type === 'hub.ack') {
        clearTimeout(timeout);
        const payload = envelope.payload as { agentId?: string };
        const agentId = payload.agentId;
        ws.close();
        if (agentId) {
          resolve(agentId);
        } else {
          reject(new Error('Hub ack did not contain agentId'));
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export class AgentConnection {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private agentId: string | undefined;
  private running = false;

  constructor(
    private config: AgentConfig,
    private executor: ProbeExecutor,
    private events: ConnectionEvents = {},
  ) {}

  /** Start the connection (connect + auto-reconnect loop) */
  start(): void {
    this.running = true;
    this.connect();
  }

  /** Stop the connection cleanly */
  stop(): void {
    this.running = false;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
      this.ws = null;
    }
  }

  /** Whether we're currently connected */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Get the assigned agent ID (set after registration) */
  getAgentId(): string | undefined {
    return this.agentId;
  }

  private connect(): void {
    const wsUrl = `${this.config.hubUrl.replace(/^http/, 'ws')}/ws/agent`;

    this.ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.sendRegister();
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('close', () => {
      this.clearTimers();
      this.events.onDisconnected?.();
      if (this.running) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.events.onError?.(err);
    });
  }

  private handleMessage(raw: string): void {
    let envelope: MessageEnvelope;
    try {
      envelope = MessageEnvelopeSchema.parse(JSON.parse(raw));
    } catch {
      return; // Invalid message, ignore
    }

    switch (envelope.type) {
      case 'hub.ack':
        this.handleAck(envelope);
        break;
      case 'probe.request':
        this.handleProbeRequest(envelope);
        break;
      default:
        break;
    }
  }

  private handleAck(envelope: MessageEnvelope): void {
    const payload = envelope.payload as { agentId?: string };
    if (payload.agentId) {
      this.agentId = payload.agentId;
      this.events.onRegistered?.(this.agentId);
    }
    this.events.onConnected?.(this.agentId ?? '');
  }

  private async handleProbeRequest(envelope: MessageEnvelope): Promise<void> {
    if (!this.agentId) return;

    let request: ProbeRequest;
    try {
      request = ProbeRequestSchema.parse(envelope.payload);
    } catch {
      this.sendError(envelope.id, 'Invalid probe request payload');
      return;
    }

    const response = await this.executor.execute(request);

    this.send({
      id: crypto.randomUUID(),
      type: response.status === 'success' ? 'probe.response' : 'probe.error',
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      signature: '',
      payload: response,
    });
  }

  private sendRegister(): void {
    this.send({
      id: crypto.randomUUID(),
      type: 'agent.register',
      timestamp: new Date().toISOString(),
      signature: '',
      payload: {
        name: this.config.agentName,
        os: `${process.platform} ${process.arch}`,
        agentVersion: '0.1.0',
        packs: this.executor.getLoadedPacks(),
      },
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.agentId) return;
      this.send({
        id: crypto.randomUUID(),
        type: 'agent.heartbeat',
        timestamp: new Date().toISOString(),
        agentId: this.agentId,
        signature: '',
        payload: {},
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private sendError(requestId: string, message: string): void {
    if (!this.agentId) return;
    this.send({
      id: crypto.randomUUID(),
      type: 'probe.error',
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      signature: '',
      payload: {
        probe: 'unknown',
        status: 'error',
        data: { error: message },
        durationMs: 0,
        metadata: {
          agentVersion: '0.1.0',
          packName: 'unknown',
          packVersion: '0.0.0',
          capabilityLevel: 'observe',
        },
      },
    });
  }

  private send(envelope: MessageEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(MIN_RECONNECT_MS * 2 ** this.reconnectAttempts, MAX_RECONNECT_MS);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (this.running) {
        this.connect();
      }
    }, delay);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
