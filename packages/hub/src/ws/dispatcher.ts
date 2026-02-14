import type { ProbeResponse } from '@sonde/shared';
import { DEFAULT_PROBE_TIMEOUT_MS } from '@sonde/shared';
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
}

export class AgentDispatcher {
  /** agentId → connection info */
  private connections = new Map<string, ConnectedAgent>();
  /** agent name → agentId (for lookup by name) */
  private nameIndex = new Map<string, string>();
  /** agentId → pending probe request (MVP: one pending per agent) */
  private pending = new Map<string, PendingRequest>();
  /** ws instance → agentId (for cleanup on disconnect) */
  private socketIndex = new Map<WebSocket, string>();

  registerAgent(id: string, name: string, ws: WebSocket): void {
    this.connections.set(id, { id, name, ws });
    this.nameIndex.set(name, id);
    this.socketIndex.set(ws, id);
  }

  removeAgent(agentId: string): void {
    const conn = this.connections.get(agentId);
    if (!conn) return;

    this.connections.delete(agentId);
    this.nameIndex.delete(conn.name);
    this.socketIndex.delete(conn.ws);

    // Reject any pending request for this agent
    const req = this.pending.get(agentId);
    if (req) {
      clearTimeout(req.timer);
      this.pending.delete(agentId);
      req.reject(new Error(`Agent '${conn.name}' disconnected`));
    }
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
        this.pending.delete(agent.id);
        reject(new Error(`Probe '${probe}' timed out after ${DEFAULT_PROBE_TIMEOUT_MS}ms`));
      }, DEFAULT_PROBE_TIMEOUT_MS);

      this.pending.set(agent.id, { resolve, reject, timer });

      const envelope = {
        id: requestId,
        type: 'probe.request' as const,
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        signature: '',
        payload: {
          probe,
          params,
          timeout: DEFAULT_PROBE_TIMEOUT_MS,
          requestedBy: 'api',
        },
      };

      agent.ws.send(JSON.stringify(envelope));
    });
  }

  /** Called when a probe.response or probe.error arrives from an agent */
  handleResponse(agentId: string, response: ProbeResponse): void {
    const req = this.pending.get(agentId);
    if (!req) return;

    clearTimeout(req.timer);
    this.pending.delete(agentId);

    if (response.status === 'success') {
      req.resolve(response);
    } else {
      req.resolve(response); // Still resolve — caller inspects status
    }
  }
}
