import type http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Pack } from '@sonde/packs';
import { z } from 'zod';
import { validateAuth } from '../auth.js';
import type { SondeDb } from '../db/index.js';
import type { AuthContext } from '../engine/policy.js';
import type { RunbookEngine } from '../engine/runbooks.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { ProbeRouter } from '../integrations/probe-router.js';
import type { SondeOAuthProvider } from '../oauth/provider.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import { handleAgentOverview } from './tools/agent-overview.js';
import { handleDiagnose } from './tools/diagnose.js';
import { handleHealthCheck } from './tools/health-check.js';
import { handleListAgents } from './tools/list-agents.js';
import { handleListCapabilities } from './tools/list-capabilities.js';
import { handleProbe } from './tools/probe.js';
import { handleQueryLogs } from './tools/query-logs.js';

/**
 * Creates an MCP HTTP handler using StreamableHTTPServerTransport.
 * Returns a request handler function for the /mcp path.
 */
export function createMcpHandler(
  probeRouter: ProbeRouter,
  dispatcher: AgentDispatcher,
  db: SondeDb,
  runbookEngine: RunbookEngine,
  integrationManager: IntegrationManager,
  packRegistry: ReadonlyMap<string, Pack>,
  oauthProvider?: SondeOAuthProvider,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const SESSION_MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes
  const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Per-session transports (sessionId → transport)
  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      auth: AuthContext;
      lastActivity: number;
    }
  >();

  // Periodically clean up idle MCP sessions
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastActivity > SESSION_MAX_IDLE_MS) {
        session.transport.close().catch(() => {});
        sessions.delete(sid);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  function createSessionServer(auth: AuthContext): {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  } {
    const server = new McpServer(
      { name: 'sonde-hub', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    server.registerTool(
      'probe',
      {
        description:
          'Run a single targeted probe for a specific measurement. Use for follow-up after diagnose reveals something worth investigating. For agent probes, specify the agent name/ID. For integration probes (external APIs), the agent parameter can be omitted.',
        inputSchema: z.object({
          agent: z
            .string()
            .optional()
            .describe('Agent name or ID (required for agent probes, omit for integration probes)'),
          probe: z.string().describe('Full probe name, e.g. "system.disk.usage"'),
          params: z.record(z.unknown()).optional().describe('Probe-specific parameters'),
        }),
      },
      async (args) => {
        return handleProbe(args, probeRouter, db, auth);
      },
    );

    server.registerTool(
      'diagnose',
      {
        description:
          'Deep investigation of a specific category on an agent or integration. Use after health_check flags an issue or when the user asks about a specific category (e.g. "check docker on server-1"). For agent categories (e.g. system, docker), specify the agent. For integration categories (e.g. proxmox-vm, proxmox-cluster), do NOT specify an agent — these run server-side via external APIs.',
        inputSchema: z.object({
          agent: z
            .string()
            .optional()
            .describe(
              'Agent name or ID (required for agent runbooks, omit for integration runbooks)',
            ),
          category: z
            .string()
            .describe(
              'Runbook category, e.g. "docker", "system", "proxmox-vm", "proxmox-cluster", "proxmox-storage"',
            ),
          description: z
            .string()
            .optional()
            .describe('Optional natural language problem description'),
          params: z
            .record(z.unknown())
            .optional()
            .describe('Runbook-specific parameters, e.g. { vmid: 100 }'),
        }),
      },
      async (args) => {
        const online = dispatcher.getOnlineAgents();
        const connectedAgents = [...online.map((a) => a.name), ...online.map((a) => a.id)];
        return handleDiagnose(args, probeRouter, runbookEngine, db, auth, connectedAgents);
      },
    );

    server.registerTool(
      'list_agents',
      {
        description:
          'List all registered agents with their status, packs, tags, and last seen time. Use when the user asks about their fleet or specific agents. For diagnostic workflows, prefer health_check (to run checks) or list_capabilities (to discover available probes). Optionally filter by tags (AND logic). IMPORTANT: Only apply tag filtering when the user explicitly uses #tagname syntax (e.g. "show #prod agents"). Do NOT infer tags from natural language.',
        inputSchema: z.object({
          tags: z
            .array(z.string())
            .optional()
            .describe(
              'Filter to agents matching ALL specified tags. Only use when user explicitly references #tagname. Pass tag names without the # prefix.',
            ),
        }),
      },
      async (args) => {
        return handleListAgents(db, dispatcher, auth, args.tags);
      },
    );

    server.registerTool(
      'agent_overview',
      {
        description:
          'Get detailed information about a single agent including pack details and status.',
        inputSchema: z.object({
          agent: z.string().describe('Agent name or ID'),
        }),
      },
      async (args) => {
        return handleAgentOverview(args, db, dispatcher, auth);
      },
    );

    server.registerTool(
      'list_capabilities',
      {
        description:
          'Discover available agents, integrations, their individual probes, and diagnostic categories. Use to find what specific probes you can run for follow-up after health_check reveals an issue. No probes executed — returns metadata only. Agents run probes on remote machines. Integrations run probes server-side via external APIs. Optionally filter by tags (AND logic). IMPORTANT: Only apply tag filtering when the user explicitly uses #tagname syntax (e.g. "check #prod #database"). Do NOT infer tags from natural language.',
        inputSchema: z.object({
          tags: z
            .array(z.string())
            .optional()
            .describe(
              'Filter agents and integrations to those matching ALL specified tags. Only use when user explicitly references #tagname. Pass tag names without the # prefix.',
            ),
        }),
      },
      (args) => {
        return handleListCapabilities(
          db,
          dispatcher,
          runbookEngine,
          integrationManager,
          packRegistry,
          auth,
          args.tags,
          probeRouter.getIntegrationPacks(),
        );
      },
    );

    server.registerTool(
      'health_check',
      {
        description:
          'Start here for broad "is something wrong?" questions. Runs all applicable diagnostics in parallel and returns unified findings sorted by severity (critical → warning → info). Use tags to scope to a group of agents/integrations (e.g. #prod, #storefront). For deeper investigation of a specific finding, follow up with diagnose for a full category runbook, probe for a single data point, or query_logs for root cause analysis. Skips categories that require user-provided parameters.',
        inputSchema: z.object({
          agent: z.string().optional().describe('Agent name or ID for agent-specific checks'),
          categories: z
            .array(z.string())
            .optional()
            .describe(
              'Optional filter: only run these diagnostic categories (default: all available)',
            ),
          tags: z
            .array(z.string())
            .optional()
            .describe(
              'Filter to agents and integrations matching ALL specified tags. Only use when user explicitly references #tagname. Pass tag names without the # prefix. Ignored when agent is specified.',
            ),
        }),
      },
      async (args) => {
        return handleHealthCheck(
          args,
          probeRouter,
          dispatcher,
          db,
          runbookEngine,
          integrationManager,
          packRegistry,
          auth,
        );
      },
    );

    server.registerTool(
      'query_logs',
      {
        description:
          "Investigate root cause by checking logs after diagnostics reveal an issue. For agent logs (systemd, docker, nginx), specify the agent. For audit logs, no agent is needed — this queries the hub's activity log.",
        inputSchema: z.object({
          source: z
            .enum(['systemd', 'docker', 'nginx', 'audit'])
            .describe(
              'Log source: systemd (journal), docker (container), nginx (access/error), audit (hub activity)',
            ),
          agent: z
            .string()
            .optional()
            .describe('Agent name or ID (required for systemd/docker/nginx, ignored for audit)'),
          params: z
            .record(z.unknown())
            .optional()
            .describe(
              'Source-specific params — systemd: { unit, lines? }; docker: { container, lines? }; nginx: { type?: "access"|"error", logPath?, lines? }; audit: { agentId?, startDate?, endDate?, limit? }',
            ),
        }),
      },
      async (args) => {
        const online = dispatcher.getOnlineAgents();
        const connectedAgents = [...online.map((a) => a.name), ...online.map((a) => a.id)];
        return handleQueryLogs(args, probeRouter, db, auth, connectedAgents);
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      // Prefer direct JSON responses over SSE streams for tool calls.
      // SSE streams are killed by reverse proxies (Traefik, nginx) when
      // idle, causing Claude Desktop to hang. JSON responses use normal
      // HTTP request/response which proxies handle correctly.
      enableJsonResponse: true,
      // If SSE is used (server-initiated notifications), hint the client
      // to reconnect quickly after a stream drop.
      retryInterval: 5_000,
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
      }
    };

    return { server, transport };
  }

  async function resolveAuth(req: http.IncomingMessage): Promise<AuthContext | undefined> {
    // Try API key auth first (scoped keys from DB)
    const apiKeyAuth = validateAuth(req, db);
    if (apiKeyAuth) return apiKeyAuth;

    // Try OAuth if provider is configured
    if (oauthProvider) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const authInfo = await oauthProvider.verifyAccessToken(token);
          return {
            type: 'oauth',
            keyId: authInfo.clientId,
            policy: {},
            scopes: authInfo.scopes,
          };
        } catch {
          // Invalid OAuth token
        }
      }
    }

    return undefined;
  }

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Ensure Accept header includes required MIME types for StreamableHTTP.
    // Some clients (e.g. mcp-remote) omit text/event-stream, causing the SDK
    // to reject with "Not Acceptable". Normalise it so all clients work.
    if (req.method === 'POST') {
      const accept = req.headers.accept ?? '';
      if (!accept.includes('text/event-stream')) {
        req.headers.accept = 'application/json, text/event-stream';
      }
    }

    // Authenticate
    const auth = await resolveAuth(req);
    if (!auth) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Read request body for POST (max 10 MB)
    const MAX_BODY_SIZE = 10 * 1024 * 1024;
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      for await (const chunk of req) {
        totalSize += (chunk as Buffer).length;
        if (totalSize > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
        chunks.push(chunk as Buffer);
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
    }

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }

    // For new sessions (no session ID or unknown session), handle initialization
    if (req.method === 'POST' || req.method === 'GET') {
      const { server, transport } = createSessionServer(auth);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);

      // Register session after handleRequest so the transport has its session ID
      const newSessionId = transport.sessionId;
      if (newSessionId) {
        sessions.set(newSessionId, {
          transport,
          auth,
          lastActivity: Date.now(),
        });
      }
      return;
    }

    if (req.method === 'DELETE') {
      // Session termination
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
          await session.transport.close();
          sessions.delete(sessionId);
        }
      }
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  };
}
