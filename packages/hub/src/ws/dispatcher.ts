import type { ProbeResponse } from '@sonde/shared';
import { DEFAULT_PROBE_TIMEOUT_MS, signPayload } from '@sonde/shared';
import type { WebSocket } from 'ws';

interface ConnectedAgent {
  id: string;
  name: string;
  ws: WebSocket;
}

interface PendingRequest {
  resolve: (response: ProbeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  agentId: string;
}

export class AgentDispatcher {
  /** agentId → connection info */
  private connections = new Map<string, ConnectedAgent>();
  /** agent name → agentId (for lookup by name) */
  private nameIndex = new Map<string, string>();
  /** requestId → pending probe request (supports concurrent probes per agent) */
  private pending = new Map<string, PendingRequest>();
  /** ws instance → agentId (for cleanup on disconnect) */
  private socketIndex = new Map<WebSocket, string>();
  /** Hub CA private key PEM for signing outgoing messages */
  private caKeyPem?: string;
  /** Dashboard WebSocket clients for real-time updates */
  private dashboardClients = new Set<WebSocket>();

  constructor(caKeyPem?: string) {
    this.caKeyPem = caKeyPem;
  }

  /** Set the CA private key for signing outgoing messages */
  setCaKeyPem(pem: string): void {
    this.caKeyPem = pem;
  }

  registerAgent(id: string, name: string, ws: WebSocket): void {
    // Clean up stale socket from a previous connection for the same agent,
    // so its delayed 'close' event won't remove the new live connection.
    const prev = this.connections.get(id);
    if (prev && prev.ws !== ws) {
      this.socketIndex.delete(prev.ws);
    }

    this.connections.set(id, { id, name, ws });
    this.nameIndex.set(name, id);
    this.socketIndex.set(ws, id);
    this.broadcastAgentStatus();
  }

  removeAgent(agentId: string): void {
    const conn = this.connections.get(agentId);
    if (!conn) return;

    this.connections.delete(agentId);
    this.nameIndex.delete(conn.name);
    this.socketIndex.delete(conn.ws);

    // Reject all pending requests for this agent
    for (const [requestId, req] of this.pending) {
      if (req.agentId === agentId) {
        clearTimeout(req.timer);
        this.pending.delete(requestId);
        req.reject(new Error(`Agent '${conn.name}' disconnected`));
      }
    }

    this.broadcastAgentStatus();
  }

  removeBySocket(ws: WebSocket): void {
    const agentId = this.socketIndex.get(ws);
    if (agentId) {
      this.removeAgent(agentId);
    }
  }

  isAgentOnline(nameOrId: string): boolean {
    return this.connections.has(nameOrId) || this.nameIndex.has(nameOrId);
  }

  getOnlineAgentIds(): string[] {
    return [...this.connections.keys()];
  }

  private resolveAgent(nameOrId: string): ConnectedAgent | undefined {
    const direct = this.connections.get(nameOrId);
    if (direct) return direct;

    const id = this.nameIndex.get(nameOrId);
    if (id) return this.connections.get(id);

    return undefined;
  }

  sendProbe(
    agentNameOrId: string,
    probe: string,
    params?: Record<string, unknown>,
  ): Promise<ProbeResponse> {
    return new Promise((resolve, reject) => {
      const agent = this.resolveAgent(agentNameOrId);
      if (!agent) {
        reject(new Error(`Agent '${agentNameOrId}' not found or offline`));
        return;
      }

      const requestId = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Probe '${probe}' timed out after ${DEFAULT_PROBE_TIMEOUT_MS}ms`));
      }, DEFAULT_PROBE_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, reject, timer, agentId: agent.id });

      const payload = {
        probe,
        params,
        timeout: DEFAULT_PROBE_TIMEOUT_MS,
        requestedBy: 'api',
        requestId,
      };

      const envelope = {
        id: requestId,
        type: 'probe.request' as const,
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        signature: this.caKeyPem ? signPayload(payload, this.caKeyPem) : '',
        payload,
      };

      agent.ws.send(JSON.stringify(envelope));
    });
  }

  /** Called when a probe.response or probe.error arrives from an agent */
  handleResponse(agentId: string, response: ProbeResponse): void {
    let req: PendingRequest | undefined;
    let key: string | undefined;

    // Prefer requestId correlation (concurrent probes)
    if (response.requestId) {
      req = this.pending.get(response.requestId);
      key = response.requestId;
    }

    // Fallback for old agents that don't echo requestId: find first pending for this agent
    if (!req) {
      for (const [k, v] of this.pending) {
        if (v.agentId === agentId) {
          req = v;
          key = k;
          break;
        }
      }
    }

    if (!req || !key) return;

    clearTimeout(req.timer);
    this.pending.delete(key);
    req.resolve(response);
  }

  // --- Dashboard WebSocket broadcast ---

  addDashboardClient(ws: WebSocket): void {
    this.dashboardClients.add(ws);
    // Send current state immediately
    this.sendAgentStatusTo(ws);
  }

  removeDashboardClient(ws: WebSocket): void {
    this.dashboardClients.delete(ws);
  }

  /** Returns online agent IDs and names for dashboard broadcast */
  getOnlineAgents(): Array<{ id: string; name: string }> {
    return [...this.connections.values()].map((c) => ({ id: c.id, name: c.name }));
  }

  private broadcastAgentStatus(): void {
    const msg = JSON.stringify({
      type: 'agent.status',
      onlineAgentIds: this.getOnlineAgentIds(),
      onlineAgents: this.getOnlineAgents(),
    });
    for (const client of this.dashboardClients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  private sendAgentStatusTo(ws: WebSocket): void {
    if (ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: 'agent.status',
          onlineAgentIds: this.getOnlineAgentIds(),
          onlineAgents: this.getOnlineAgents(),
        }),
      );
    }
  }
}
