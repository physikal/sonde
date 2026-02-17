import type http from 'node:http';
import {
  AttestationData,
  MessageEnvelope,
  ProbeResponse,
  signPayload,
  verifyPayload,
} from '@sonde/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import { extractApiKey, hashApiKey } from '../auth.js';
import { getCertFingerprint, issueAgentCert } from '../crypto/ca.js';
import type { SondeDb } from '../db/index.js';
import { semverLt } from '../version-check.js';
import type { AgentDispatcher } from './dispatcher.js';

interface RegisterPayload {
  name: string;
  os: string;
  agentVersion: string;
  packs: Array<{ name: string; version: string; status: string }>;
  enrollmentToken?: string;
  attestation?: unknown;
}

interface CaContext {
  certPem: string;
  keyPem: string;
}

export function setupWsServer(
  httpServer: http.Server,
  dispatcher: AgentDispatcher,
  db: SondeDb,
  validateKey: (key: string) => boolean,
  ca?: CaContext,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const dashboardWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';

    // Dashboard WebSocket — no auth required (same origin)
    if (url === '/ws/dashboard' || url.startsWith('/ws/dashboard?')) {
      dashboardWss.handleUpgrade(req, socket, head, (ws) => {
        dashboardWss.emit('connection', ws);
      });
      return;
    }

    if (url !== '/ws/agent' && !url.startsWith('/ws/agent?')) {
      socket.destroy();
      return;
    }

    // If TLS is enabled, check for valid client cert first
    const tlsSocket = req.socket as import('node:tls').TLSSocket;
    if (ca && typeof tlsSocket.getPeerCertificate === 'function') {
      const peerCert = tlsSocket.getPeerCertificate();
      if (peerCert?.raw) {
        // Client presented a cert — verify it against CA
        // Certificate is verified during TLS handshake; allow through
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
        return;
      }
    }

    // Fall back to API key or enrollment token auth
    const key = extractApiKey(req);
    if (!validateKey(key) && !db.isValidEnrollmentToken(key)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  // Dashboard WebSocket connections
  dashboardWss.on('connection', (ws) => {
    dispatcher.addDashboardClient(ws);
    ws.on('close', () => {
      dispatcher.removeDashboardClient(ws);
    });
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    console.log('Agent connected');
    const bearerToken = extractApiKey(req);

    ws.on('message', (data) => {
      try {
        const raw: unknown = JSON.parse(data.toString());
        const envelope = MessageEnvelope.parse(raw);
        handleMessage(ws, envelope, dispatcher, db, ca, bearerToken);
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
  ca?: CaContext,
  bearerToken?: string,
): void {
  // Verify signature if present (non-empty) and agent has a stored cert
  if (envelope.signature !== '' && envelope.agentId) {
    const certPem = db.getAgentCertPem(envelope.agentId);
    if (certPem) {
      const valid = verifyPayload(envelope.payload, envelope.signature, certPem);
      if (!valid) {
        console.warn(`Signature verification failed for agent ${envelope.agentId}`);
        ws.send(JSON.stringify({ error: 'Signature verification failed' }));
        return;
      }
    }
  }

  switch (envelope.type) {
    case 'agent.register':
      handleRegister(ws, envelope, dispatcher, db, ca, bearerToken);
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
  ca?: CaContext,
  bearerToken?: string,
): void {
  const payload = envelope.payload as RegisterPayload;
  // Reuse existing agent ID if same name re-registers (stable identity)
  const existing = db.getAgent(payload.name);
  const agentId = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  // Resolve enrollment token: explicit in payload (CLI --token) or auto-detect from bearer (TUI)
  const enrollmentToken =
    payload.enrollmentToken ||
    (bearerToken && db.isValidEnrollmentToken(bearerToken) ? bearerToken : undefined);

  // If enrollment token is present, validate and consume it
  let certData: { certPem: string; keyPem: string; caCertPem: string } | undefined;
  let mintedApiKey: string | undefined;

  if (enrollmentToken) {
    const result = db.consumeEnrollmentToken(enrollmentToken, payload.name);
    if (!result.valid) {
      ws.send(
        JSON.stringify({
          id: crypto.randomUUID(),
          type: 'hub.ack' as const,
          timestamp: now,
          signature: '',
          payload: { error: `Enrollment token rejected: ${result.reason}` },
        }),
      );
      ws.close();
      return;
    }

    // Issue TLS cert if CA is available
    if (ca) {
      const agentCert = issueAgentCert(ca.certPem, ca.keyPem, payload.name);
      const fingerprint = getCertFingerprint(agentCert.certPem);

      certData = {
        certPem: agentCert.certPem,
        keyPem: agentCert.keyPem,
        caCertPem: ca.certPem,
      };

      db.upsertAgent({
        id: agentId,
        name: payload.name,
        status: 'online',
        lastSeen: now,
        os: payload.os,
        agentVersion: payload.agentVersion,
        packs: payload.packs,
      });
      db.updateAgentCertFingerprint(agentId, fingerprint);
      db.updateAgentCertPem(agentId, agentCert.certPem);
    } else {
      db.upsertAgent({
        id: agentId,
        name: payload.name,
        status: 'online',
        lastSeen: now,
        os: payload.os,
        agentVersion: payload.agentVersion,
        packs: payload.packs,
      });
    }

    // Mint a scoped API key so the agent can reconnect without the consumed token
    const keyId = crypto.randomUUID();
    mintedApiKey = crypto.randomUUID();
    const keyHash = hashApiKey(mintedApiKey);
    db.createApiKey(keyId, `agent:${payload.name}`, keyHash, '{}');
  } else {
    db.upsertAgent({
      id: agentId,
      name: payload.name,
      status: 'online',
      lastSeen: now,
      os: payload.os,
      agentVersion: payload.agentVersion,
      packs: payload.packs,
    });
  }

  dispatcher.registerAgent(agentId, payload.name, ws);

  // Handle attestation data
  if (payload.attestation) {
    const parsed = AttestationData.safeParse(payload.attestation);
    if (parsed.success) {
      const newJson = JSON.stringify(parsed.data);
      // Check for mismatch on re-registration (existing agent by name)
      const existingAgent = db.getAgent(payload.name);
      const storedJson = existingAgent?.attestationJson;
      // Accept new attestation baseline if agent version changed (expected after self-update)
      const versionChanged =
        existingAgent?.agentVersion &&
        existingAgent.agentVersion !== payload.agentVersion;
      const mismatch = !!(
        storedJson &&
        storedJson !== '{}' &&
        storedJson !== newJson &&
        !versionChanged
      );
      if (mismatch) {
        db.updateAgentStatus(agentId, 'degraded', now);
        console.warn(`Attestation mismatch for agent ${payload.name} (${agentId})`);
      }
      db.updateAgentAttestation(agentId, newJson, mismatch);
    }
  }

  const ackPayload: Record<string, unknown> = { agentId };
  if (certData) {
    ackPayload.certPem = certData.certPem;
    ackPayload.keyPem = certData.keyPem;
    ackPayload.caCertPem = certData.caCertPem;
  }
  if (mintedApiKey) {
    ackPayload.apiKey = mintedApiKey;
  }

  const ack = {
    id: crypto.randomUUID(),
    type: 'hub.ack' as const,
    timestamp: now,
    agentId,
    signature: ca ? signPayload(ackPayload, ca.keyPem) : '',
    payload: ackPayload,
  };

  ws.send(JSON.stringify(ack));
  const authMethod = certData
    ? 'mTLS cert issued'
    : mintedApiKey
      ? 'token → API key minted'
      : 'API key';
  console.log(`Agent registered: ${payload.name} (${agentId}) [${authMethod}]`);

  // Send update notification if agent is outdated
  const latestVersion = db.getHubSetting('latest_agent_version');
  if (latestVersion && payload.agentVersion && semverLt(payload.agentVersion, latestVersion)) {
    const updateMsg = {
      id: crypto.randomUUID(),
      type: 'hub.update_available' as const,
      timestamp: now,
      agentId,
      signature: '',
      payload: {
        latestVersion,
        currentVersion: payload.agentVersion,
      },
    };
    ws.send(JSON.stringify(updateMsg));
  }
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
