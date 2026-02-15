import fs from 'node:fs';
import {
  HEARTBEAT_INTERVAL_MS,
  type MessageEnvelope,
  MessageEnvelope as MessageEnvelopeSchema,
  type ProbeRequest,
  ProbeRequest as ProbeRequestSchema,
  signPayload,
  verifyPayload,
} from '@sonde/shared';
import WebSocket from 'ws';
import type { AgentConfig } from '../config.js';
import { saveCerts } from '../config.js';
import { VERSION } from '../version.js';
import { generateAttestation } from './attestation.js';
import { AgentAuditLog } from './audit.js';
import type { ProbeExecutor } from './executor.js';

export interface ConnectionEvents {
  onConnected?: (agentId: string) => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onRegistered?: (agentId: string) => void;
  onProbeCompleted?: (probe: string, status: string, durationMs: number) => void;
}

/** Minimum/maximum reconnect delays */
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 60_000;

const ENROLL_TIMEOUT_MS = 10_000;

/**
 * One-shot enrollment: connect to hub, register, get agentId, disconnect.
 * If enrollmentToken is set in config, includes it in registration for cert-based enrollment.
 * Returns { agentId, certIssued } — certIssued is true if certs were saved.
 */
export function enrollWithHub(
  config: AgentConfig,
  executor: ProbeExecutor,
): Promise<{ agentId: string; certIssued: boolean; apiKey?: string }> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${config.hubUrl.replace(/^http/, 'ws')}/ws/agent`;

    // Use API key if available, otherwise use enrollment token for WS auth
    const bearerToken = config.apiKey || config.enrollmentToken || '';
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Enrollment timed out waiting for hub acknowledgement'));
    }, ENROLL_TIMEOUT_MS);

    ws.on('open', () => {
      const payload: Record<string, unknown> = {
        name: config.agentName,
        os: `${process.platform} ${process.arch}`,
        agentVersion: VERSION,
        packs: executor.getLoadedPacks(),
        attestation: generateAttestation(config, executor),
      };
      if (config.enrollmentToken) {
        payload.enrollmentToken = config.enrollmentToken;
      }

      ws.send(
        JSON.stringify({
          id: crypto.randomUUID(),
          type: 'agent.register',
          timestamp: new Date().toISOString(),
          signature: '',
          payload,
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
        const ackPayload = envelope.payload as {
          agentId?: string;
          error?: string;
          certPem?: string;
          keyPem?: string;
          caCertPem?: string;
          apiKey?: string;
        };

        ws.close();

        if (ackPayload.error) {
          reject(new Error(ackPayload.error));
          return;
        }

        const agentId = ackPayload.agentId;
        if (!agentId) {
          reject(new Error('Hub ack did not contain agentId'));
          return;
        }

        // If hub issued certs, save them
        let certIssued = false;
        if (ackPayload.certPem && ackPayload.keyPem && ackPayload.caCertPem) {
          saveCerts(config, ackPayload.certPem, ackPayload.keyPem, ackPayload.caCertPem);
          certIssued = true;
        }

        resolve({ agentId, certIssued, apiKey: ackPayload.apiKey });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Build WebSocket options, including TLS client cert if available. */
function buildWsOptions(config: AgentConfig): WebSocket.ClientOptions {
  const options: WebSocket.ClientOptions = {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  };

  if (config.certPath && config.keyPath && config.caCertPath) {
    try {
      options.cert = fs.readFileSync(config.certPath, 'utf-8');
      options.key = fs.readFileSync(config.keyPath, 'utf-8');
      options.ca = [fs.readFileSync(config.caCertPath, 'utf-8')];
      options.rejectUnauthorized = false; // Hub uses self-signed CA cert
    } catch {
      // Cert files missing or unreadable — fall back to API key only
    }
  }

  return options;
}

export class AgentConnection {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private agentId: string | undefined;
  private running = false;
  private privateKeyPem: string | undefined;
  private caCertPem: string | undefined;
  private auditLog = new AgentAuditLog();

  constructor(
    private config: AgentConfig,
    private executor: ProbeExecutor,
    private events: ConnectionEvents = {},
  ) {
    // Load private key for signing outbound messages
    if (config.keyPath) {
      try {
        this.privateKeyPem = fs.readFileSync(config.keyPath, 'utf-8');
      } catch {
        // Key not available — messages will be sent unsigned
      }
    }
    // Load CA cert for verifying hub messages
    if (config.caCertPath) {
      try {
        this.caCertPem = fs.readFileSync(config.caCertPath, 'utf-8');
      } catch {
        // CA cert not available — skip verification
      }
    }
  }

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
    const options = buildWsOptions(this.config);

    this.ws = new WebSocket(wsUrl, options);

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

    // Verify hub signature if we have a CA cert and the message is signed
    if (this.caCertPem && envelope.signature !== '') {
      const valid = verifyPayload(envelope.payload, envelope.signature, this.caCertPem);
      if (!valid) {
        this.events.onError?.(new Error(`Signature verification failed for ${envelope.type}`));
        return;
      }
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

    this.auditLog.log(request.probe, response.status, response.durationMs);
    this.events.onProbeCompleted?.(request.probe, response.status, response.durationMs);

    this.send({
      id: crypto.randomUUID(),
      type: response.status === 'success' ? 'probe.response' : 'probe.error',
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      signature: '',
      payload: response,
    });
  }

  /** Get the agent-side audit log (for testing/inspection) */
  getAuditLog(): AgentAuditLog {
    return this.auditLog;
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
        agentVersion: VERSION,
        packs: this.executor.getLoadedPacks(),
        attestation: generateAttestation(this.config, this.executor),
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
          agentVersion: VERSION,
          packName: 'unknown',
          packVersion: '0.0.0',
          capabilityLevel: 'observe',
        },
      },
    });
  }

  private send(envelope: MessageEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Sign the payload if we have a private key
      if (this.privateKeyPem && envelope.signature === '') {
        envelope.signature = signPayload(envelope.payload, this.privateKeyPem);
      }
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
