import type http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { validateAuth } from '../auth.js';
import type { SondeDb } from '../db/index.js';
import type { AuthContext } from '../engine/policy.js';
import type { RunbookEngine } from '../engine/runbooks.js';
import type { ProbeRouter } from '../integrations/probe-router.js';
import type { SondeOAuthProvider } from '../oauth/provider.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import { handleAgentOverview } from './tools/agent-overview.js';
import { handleDiagnose } from './tools/diagnose.js';
import { handleListAgents } from './tools/list-agents.js';
import { handleProbe } from './tools/probe.js';

/**
 * Creates an MCP HTTP handler using StreamableHTTPServerTransport.
 * Returns a request handler function for the /mcp path.
 */
export function createMcpHandler(
  probeRouter: ProbeRouter,
  dispatcher: AgentDispatcher,
  db: SondeDb,
  runbookEngine: RunbookEngine,
  oauthProvider?: SondeOAuthProvider,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  // Per-session transports (sessionId → transport)
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; auth: AuthContext }
  >();

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
          'Execute a probe on a connected agent or integration. For agent probes, specify the agent name/ID. For integration probes (external APIs), the agent parameter can be omitted.',
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
          'Run a diagnostic runbook. For agent runbooks, specify the agent. For integration runbooks, the agent can be omitted.',
        inputSchema: z.object({
          agent: z
            .string()
            .optional()
            .describe(
              'Agent name or ID (required for agent runbooks, omit for integration runbooks)',
            ),
          category: z.string().describe('Runbook category, e.g. "docker", "system", "systemd"'),
          description: z
            .string()
            .optional()
            .describe('Optional natural language problem description'),
        }),
      },
      async (args) => {
        return handleDiagnose(args, probeRouter, runbookEngine, db, auth);
      },
    );

    server.registerTool(
      'list_agents',
      {
        description: 'List all registered agents with their status, packs, and last seen time.',
        inputSchema: z.object({}),
      },
      async () => {
        return handleListAgents(db, dispatcher, auth);
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

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
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

    // Read request body for POST
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
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
      const session = sessions.get(sessionId);
      await session?.transport.handleRequest(req, res, body);
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
        sessions.set(newSessionId, { transport, auth });
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
