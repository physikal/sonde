import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { packRegistry } from '@sonde/packs';
import { Hono } from 'hono';
import { hashApiKey } from './auth.js';
import { loadConfig } from './config.js';
import { generateCaCert } from './crypto/ca.js';
import { SondeDb } from './db/index.js';
import { RunbookEngine } from './engine/runbooks.js';
import { createMcpHandler } from './mcp/server.js';
import { handleDiagnose } from './mcp/tools/diagnose.js';
import { handleProbe } from './mcp/tools/probe.js';
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

app.get('/api/v1/enrollment-tokens', (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ tokens: db.listEnrollmentTokens() });
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

app.put('/api/v1/api-keys/:id/policy', async (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{ policy: Record<string, unknown> }>();
  const updated = db.updateApiKeyPolicy(c.req.param('id'), JSON.stringify(body.policy ?? {}));
  if (!updated) {
    return c.json({ error: 'API key not found' }, 404);
  }
  return c.json({ ok: true });
});

// Agent list endpoint (unauthenticated — dashboard needs it)
app.get('/api/v1/agents', (c) => {
  const agents = db.getAllAgents().map((a) => ({
    ...a,
    status: dispatcher.isAgentOnline(a.id)
      ? 'online'
      : a.status === 'degraded'
        ? 'degraded'
        : 'offline',
  }));
  return c.json({ agents });
});

// Agent detail endpoint
app.get('/api/v1/agents/:id', (c) => {
  const agent = db.getAgent(c.req.param('id'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  return c.json({
    ...agent,
    status: dispatcher.isAgentOnline(agent.id)
      ? 'online'
      : agent.status === 'degraded'
        ? 'degraded'
        : 'offline',
  });
});

// Agent audit log
app.get('/api/v1/agents/:id/audit', (c) => {
  const agent = db.getAgent(c.req.param('id'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  const limit = Number(c.req.query('limit')) || 50;
  const apiKeyId = c.req.query('apiKeyId') || undefined;
  const startDate = c.req.query('startDate') || undefined;
  const endDate = c.req.query('endDate') || undefined;
  const entries = db.getAuditEntries({ agentId: agent.id, apiKeyId, startDate, endDate, limit });
  return c.json({ entries });
});

// Global audit log
app.get('/api/v1/audit', (c) => {
  const limit = Number(c.req.query('limit')) || 50;
  const apiKeyId = c.req.query('apiKeyId') || undefined;
  const startDate = c.req.query('startDate') || undefined;
  const endDate = c.req.query('endDate') || undefined;
  const entries = db.getAuditEntries({ apiKeyId, startDate, endDate, limit });
  return c.json({ entries });
});

// Audit chain integrity check
app.get('/api/v1/audit/verify', (c) => {
  const result = db.verifyAuditChain();
  return c.json(result);
});

// Pack manifests (unauthenticated — dashboard needs probe metadata for Try It)
app.get('/api/v1/packs', (c) => {
  const packs = [...packRegistry.values()].map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    probes: p.manifest.probes.map((probe) => ({
      name: probe.name,
      description: probe.description,
      capability: probe.capability,
      params: probe.params,
      timeout: probe.timeout,
    })),
    runbook: p.manifest.runbook
      ? {
          category: p.manifest.runbook.category,
          probes: p.manifest.runbook.probes,
          parallel: p.manifest.runbook.parallel,
        }
      : null,
  }));
  return c.json({ packs });
});

// Execute single probe via REST (authenticated — used by Try It page)
app.post('/api/v1/probe', async (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    agent: string;
    probe: string;
    params?: Record<string, unknown>;
  }>();
  if (!body.agent || !body.probe) {
    return c.json({ error: 'agent and probe are required' }, 400);
  }

  const auth = { type: 'api_key' as const, keyId: 'legacy', policy: {} };
  const result = await handleProbe(body, dispatcher, db, auth);
  const text = result.content[0]?.text ?? '';

  if (result.isError) {
    return c.json({ error: text }, 400);
  }

  try {
    return c.json(JSON.parse(text));
  } catch {
    return c.json({ raw: text });
  }
});

// Execute diagnostic runbook via REST (authenticated — used by Try It page)
app.post('/api/v1/diagnose', async (c) => {
  const authHeader = c.req.header('Authorization');
  const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (key !== config.apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{ agent: string; category: string }>();
  if (!body.agent || !body.category) {
    return c.json({ error: 'agent and category are required' }, 400);
  }

  const auth = { type: 'api_key' as const, keyId: 'legacy', policy: {} };
  const result = await handleDiagnose(body, dispatcher, runbookEngine, db, auth);
  const text = result.content[0]?.text ?? '';

  if (result.isError) {
    return c.json({ error: text }, 400);
  }

  try {
    return c.json(JSON.parse(text));
  } catch {
    return c.json({ raw: text });
  }
});

// Setup status (unauthenticated — needed for first-boot wizard)
app.get('/api/v1/setup/status', (c) => {
  const setupComplete = db.getSetupValue('setup_complete') === 'true';
  const apiKeys = db.listApiKeys();
  const agents = db.getAllAgents();

  return c.json({
    setupComplete,
    steps: {
      admin_created: setupComplete,
      api_key_exists: apiKeys.length > 0,
      agent_enrolled: agents.length > 0,
    },
  });
});

// Mark setup complete (one-time, no auth for first boot)
app.post('/api/v1/setup/complete', (c) => {
  if (db.getSetupValue('setup_complete') === 'true') {
    return c.json({ error: 'Setup already completed' }, 409);
  }
  db.setSetupValue('setup_complete', 'true');
  return c.json({ ok: true });
});

// Static file serving for dashboard SPA
const dashboardDist = path.resolve(process.cwd(), 'packages/dashboard/dist');
const dashboardExists = fs.existsSync(dashboardDist);

if (dashboardExists) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), dashboardDist) }));
  app.get('/*', (c) => {
    const indexPath = path.join(dashboardDist, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf-8');
    return c.html(html);
  });
} else {
  app.get('/', (c) => c.text('Sonde Hub running. Dashboard not built.'));
}

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
