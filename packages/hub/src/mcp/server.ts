import type http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { extractApiKey } from '../auth.js';
import type { SondeDb } from '../db/index.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import { handleProbe } from './tools/probe.js';

/**
 * Creates an MCP HTTP handler using StreamableHTTPServerTransport.
 * Returns a request handler function for the /mcp path.
 */
export function createMcpHandler(
  dispatcher: AgentDispatcher,
  db: SondeDb,
  apiKey: string,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  // Per-session transports (sessionId → transport)
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  function createSessionServer(): { server: McpServer; transport: StreamableHTTPServerTransport } {
    const server = new McpServer(
      { name: 'sonde-hub', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    server.registerTool(
      'probe',
      {
        description:
          'Execute a probe on a connected agent. Returns structured data from the agent.',
        inputSchema: z.object({
          agent: z.string().describe('Agent name or ID'),
          probe: z.string().describe('Full probe name, e.g. "system.disk.usage"'),
          params: z.record(z.unknown()).optional().describe('Probe-specific parameters'),
        }),
      },
      async (args) => {
        return handleProbe(args, dispatcher, db);
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    // Track session
    const sessionId = transport.sessionId;
    if (sessionId) {
      sessions.set(sessionId, transport);
    }

    transport.onclose = () => {
      if (sessionId) {
        sessions.delete(sessionId);
      }
    };

    return { server, transport };
  }

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Validate API key
    const key = extractApiKey(req);
    if (key !== apiKey) {
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
      const transport = sessions.get(sessionId);
      await transport?.handleRequest(req, res, body);
      return;
    }

    // For new sessions (no session ID or unknown session), handle initialization
    if (req.method === 'POST' || req.method === 'GET') {
      const { server, transport } = createSessionServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'DELETE') {
      // Session termination
      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (transport) {
          await transport.close();
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
