import type http from 'node:http';
import { MessageEnvelope, ProbeResponse } from '@sonde/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import { extractApiKey } from '../auth.js';
import type { SondeDb } from '../db/index.js';
import type { AgentDispatcher } from './dispatcher.js';

interface RegisterPayload {
  name: string;
  os: string;
  agentVersion: string;
  packs: Array<{ name: string; version: string; status: string }>;
}

export function setupWsServer(
  httpServer: http.Server,
  dispatcher: AgentDispatcher,
  db: SondeDb,
  validateKey: (key: string) => boolean,
): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/agent') {
      socket.destroy();
      return;
    }

    const key = extractApiKey(req);
    if (!validateKey(key)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    console.log('Agent connected');

    ws.on('message', (data) => {
      try {
        const raw: unknown = JSON.parse(data.toString());
        const envelope = MessageEnvelope.parse(raw);
        handleMessage(ws, envelope, dispatcher, db);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`WebSocket message error: ${message}`);
        ws.send(JSON.stringify({ error: message }));
      }
    });

    ws.on('close', () => {
      dispatcher.removeBySocket(ws);
    });
  });
}

function handleMessage(
  ws: WebSocket,
  envelope: MessageEnvelope,
  dispatcher: AgentDispatcher,
  db: SondeDb,
): void {
  switch (envelope.type) {
    case 'agent.register':
      handleRegister(ws, envelope, dispatcher, db);
      break;
    case 'agent.heartbeat':
      handleHeartbeat(envelope, dispatcher, db);
      break;
    case 'probe.response':
    case 'probe.error':
      handleProbeResponse(envelope, dispatcher, db);
      break;
    default:
      break;
  }
}

function handleRegister(
  ws: WebSocket,
  envelope: MessageEnvelope,
  dispatcher: AgentDispatcher,
  db: SondeDb,
): void {
  const payload = envelope.payload as RegisterPayload;
  const agentId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.upsertAgent({
    id: agentId,
    name: payload.name,
    status: 'online',
    lastSeen: now,
    os: payload.os,
    agentVersion: payload.agentVersion,
    packs: payload.packs,
  });

  dispatcher.registerAgent(agentId, payload.name, ws);

  const ack = {
    id: crypto.randomUUID(),
    type: 'hub.ack' as const,
    timestamp: now,
    agentId,
    signature: '',
    payload: { agentId },
  };

  ws.send(JSON.stringify(ack));
  console.log(`Agent registered: ${payload.name} (${agentId})`);
}

function handleHeartbeat(
  envelope: MessageEnvelope,
  _dispatcher: AgentDispatcher,
  db: SondeDb,
): void {
  if (envelope.agentId) {
    db.updateAgentStatus(envelope.agentId, 'online', new Date().toISOString());
  }
}

function handleProbeResponse(
  envelope: MessageEnvelope,
  dispatcher: AgentDispatcher,
  db: SondeDb,
): void {
  if (!envelope.agentId) return;

  const parsed = ProbeResponse.safeParse(envelope.payload);
  if (!parsed.success) return;

  const response = parsed.data;

  db.logAudit({
    agentId: envelope.agentId,
    probe: response.probe,
    status: response.status,
    durationMs: response.durationMs,
    responseJson: JSON.stringify(response.data),
  });

  dispatcher.handleResponse(envelope.agentId, response);
}
