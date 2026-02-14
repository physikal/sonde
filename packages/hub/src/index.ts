import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { getRequestListener } from '@hono/node-server';
import { packRegistry } from '@sonde/packs';
import { Hono } from 'hono';
import { hashApiKey } from './auth.js';
import { loadConfig } from './config.js';
import { generateCaCert } from './crypto/ca.js';
import { SondeDb } from './db/index.js';
import { RunbookEngine } from './engine/runbooks.js';
import { createMcpHandler } from './mcp/server.js';
import type { SondeOAuthProvider } from './oauth/provider.js';
import { AgentDispatcher } from './ws/dispatcher.js';
import { setupWsServer } from './ws/server.js';

const config = loadConfig();
const db = new SondeDb(config.dbPath);
const dispatcher = new AgentDispatcher();
const runbookEngine = new RunbookEngine();
runbookEngine.loadFromManifests([...packRegistry.values()].map((p) => p.manifest));

// Hono app for REST routes
const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    agents: dispatcher.getOnlineAgentIds().length,
  }),
);

// Enrollment token creation endpoint
app.post('/api/v1/enrollment-tokens', async (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.createEnrollmentToken(token, expiresAt);

  return c.json({ token, expiresAt });
});

// API key management endpoints (require legacy key auth)
app.post('/api/v1/api-keys', async (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{ name: string; policy?: Record<string, unknown> }>();
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }

  const id = crypto.randomUUID();
  const rawKey = crypto.randomUUID();
  const keyHash = hashApiKey(rawKey);
  const policyJson = JSON.stringify(body.policy ?? {});

  db.createApiKey(id, body.name, keyHash, policyJson);

  return c.json({ id, key: rawKey, name: body.name, policy: body.policy ?? {} }, 201);
});

app.get('/api/v1/api-keys', (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ keys: db.listApiKeys() });
});

app.delete('/api/v1/api-keys/:id', (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  db.revokeApiKey(c.req.param('id'));
  return c.json({ ok: true });
});

// Initialize CA if TLS is enabled
let ca: { certPem: string; keyPem: string } | undefined;
if (config.tlsEnabled) {
  ca = db.getCa();
  if (!ca) {
    console.log('Generating hub CA certificate...');
    ca = generateCaCert();
    db.storeCa(ca.certPem, ca.keyPem);
  }
}

// Set CA key on dispatcher for signing outgoing messages
if (ca) {
  dispatcher.setCaKeyPem(ca.keyPem);
}

// OAuth provider (only if hubUrl is configured)
let oauthProvider: SondeOAuthProvider | undefined;
let oauthApp: import('express').Express | undefined;

if (config.hubUrl) {
  // Dynamic imports to avoid loading express when not needed
  const [{ default: express }, { mcpAuthRouter }, { SondeOAuthProvider: OAuthProviderClass }] =
    await Promise.all([
      import('express'),
      import('@modelcontextprotocol/sdk/server/auth/router.js'),
      import('./oauth/provider.js'),
    ]);

  oauthProvider = new OAuthProviderClass(db);
  oauthApp = express();
  oauthApp.use(express.json());
  oauthApp.use(express.urlencoded({ extended: false }));
  oauthApp.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(config.hubUrl),
      scopesSupported: ['mcp:tools'],
      resourceName: 'Sonde Infrastructure Agent',
      resourceServerUrl: new URL(`${config.hubUrl}/mcp`),
    }),
  );
}

// MCP handler for /mcp/* routes
const mcpHandler = createMcpHandler(dispatcher, db, config.apiKey, runbookEngine, oauthProvider);

// Node HTTP server — routes /mcp to MCP handler, OAuth paths to Express, everything else to Hono
const honoListener = getRequestListener(app.fetch);

// OAuth route prefixes
const OAUTH_PATHS = ['/authorize', '/token', '/register', '/revoke', '/.well-known/'];

const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = req.url ?? '';

  if (url.startsWith('/mcp')) {
    await mcpHandler(req, res);
    return;
  }

  // Route OAuth paths to Express sub-app if available
  if (oauthApp && OAUTH_PATHS.some((p) => url.startsWith(p))) {
    oauthApp(req, res);
    return;
  }

  honoListener(req, res);
};

const server: http.Server =
  config.tlsEnabled && ca
    ? https.createServer(
        {
          cert: ca.certPem,
          key: ca.keyPem,
          ca: [ca.certPem],
          requestCert: true,
          rejectUnauthorized: false, // Allow connections without certs (MCP clients)
        },
        requestHandler,
      )
    : http.createServer(requestHandler);

// WebSocket server for agent connections
setupWsServer(server, dispatcher, db, (key) => key === config.apiKey, ca);

const protocol = config.tlsEnabled ? 'https' : 'http';
const wsProtocol = config.tlsEnabled ? 'wss' : 'ws';

server.listen(config.port, config.host, () => {
  console.log('Sonde Hub v0.1.0');
  console.log(`  HTTP:      ${protocol}://${config.host}:${config.port}`);
  console.log(`  MCP:       ${protocol}://${config.host}:${config.port}/mcp`);
  console.log(`  WebSocket: ${wsProtocol}://${config.host}:${config.port}/ws/agent`);
  console.log(`  Health:    ${protocol}://${config.host}:${config.port}/health`);
  console.log(`  Database:  ${config.dbPath}`);
  if (config.tlsEnabled) console.log('  TLS:       enabled (mTLS)');
  if (config.hubUrl) console.log(`  OAuth:     ${config.hubUrl}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  db.close();
  process.exit(0);
});

export { app, config, db, dispatcher };
