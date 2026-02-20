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
import { buildMcpInstructions } from './instructions.js';
import { handleAgentOverview } from './tools/agent-overview.js';
import { handleCheckCriticalPath } from './tools/check-critical-path.js';
import { handleDiagnose } from './tools/diagnose.js';
import { handleHealthCheck } from './tools/health-check.js';
import { handleListAgents } from './tools/list-agents.js';
import { handleListCapabilities } from './tools/list-capabilities.js';
import { handleProbe } from './tools/probe.js';
import { handleQueryLogs } from './tools/query-logs.js';
import { handleTrendingSummary } from './tools/trending.js';

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
  const SESSION_MAX_IDLE_MS = 8 * 60 * 60 * 1000; // 8 hours (matches dashboard sessions)
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
    const instructions = buildMcpInstructions(db, integrationManager, probeRouter);

    const server = new McpServer(
      { name: 'sonde-hub', version: '0.1.0' },
      { capabilities: { tools: {} }, instructions },
    );

    server.registerTool(
      'probe',
      {
        description:
          'Run a single targeted probe. Requires an exact probe name from list_capabilities (e.g. "system.disk-usage") — call list_capabilities first if you do not already have probe names. For agent probes, specify the agent name/ID. For integration probes, omit the agent parameter.',
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
          'Investigate a specific diagnostic category on an agent or integration. Use after health_check flags an issue, or directly when the user asks about a known category (e.g. "check docker on server-1"). For agent categories (system, docker, systemd), specify the agent. For integration categories (proxmox-vm, proxmox-cluster), omit the agent — these run server-side via external APIs.',
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
          'List all registered agents with their status, packs, tags, and last seen time. Use when the user asks about their fleet or specific agents. For diagnostic workflows, prefer health_check instead. Optionally filter by tags (AND logic). IMPORTANT: Only apply tag filtering when the user explicitly uses #tagname syntax (e.g. "show #prod agents"). Do NOT infer tags from natural language.',
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
          'Discover available agents, integrations, their exact probe names, diagnostic categories, and critical paths. Call this when you need specific probe names for the probe tool, or to discover what categories and paths are available. No probes executed — returns metadata only. Optionally filter by tags (AND logic). IMPORTANT: Only apply tag filtering when the user explicitly uses #tagname syntax (e.g. "check #prod #database"). Do NOT infer tags from natural language.',
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
          'Best starting point for diagnostics. Use for "what\'s wrong?", "how is X doing?", or any broad diagnostic question. Runs all applicable diagnostics in parallel across agents and integrations, returns unified findings sorted by severity (critical → warning → info). Specify an agent name for one machine, use tags to scope to a group (e.g. #prod, #storefront), or omit both to check everything. For deeper investigation, follow up with diagnose (category drill-down), probe (single measurement via list_capabilities), or query_logs (root cause).',
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

    server.registerTool(
      'check_critical_path',
      {
        description:
          'Execute a predefined critical path — an ordered chain of infrastructure checkpoints (e.g. load balancer → web server → app server → database). All steps execute in parallel, returning pass/fail per hop with timing. Call list_capabilities to discover available path names.',
        inputSchema: z.object({
          path: z.string().describe('Critical path name (e.g. "storefront")'),
        }),
      },
      async (args) => {
        return handleCheckCriticalPath(args, probeRouter, db, auth);
      },
    );

    server.registerTool(
      'trending_summary',
      {
        description:
          'Show aggregate probe trends from the last 24 hours. Surfaces failure rates, error patterns, and which agents or probes are struggling. Use during outages to see what others have been investigating and where failures concentrate.',
        inputSchema: z.object({
          hours: z
            .number()
            .min(1)
            .max(24)
            .default(24)
            .describe('How many hours to look back (default: 24, max: 24)'),
          probe: z
            .string()
            .optional()
            .describe('Filter to a specific probe name (e.g. "system.disk-usage")'),
          agent: z.string().optional().describe('Filter to a specific agent or integration source'),
        }),
      },
      async (args) => {
        return handleTrendingSummary(args, db);
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

    // Stale session: client sent a session ID we don't recognize (evicted
    // or server restarted). Return 404 per MCP spec so the client
    // re-initializes instead of hanging on a dead session.
    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session expired' }));
      return;
    }

    // For new sessions (no session ID), handle initialization
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
