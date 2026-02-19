import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  citrixPack,
  datadogPack,
  graphPack,
  httpbinPack,
  jiraPack,
  lokiPack,
  nutanixDiagnosticRunbooks,
  nutanixPack,
  packRegistry,
  pagerdutyPack,
  proxmoxDiagnosticRunbooks,
  proxmoxPack,
  servicenowPack,
  splunkPack,
  vcenterPack,
} from '@sonde/packs';
import { DiagnoseInput, type IntegrationPack, ProbeInput } from '@sonde/shared';
import { Hono } from 'hono';
import { hashApiKey } from './auth.js';
import {
  filterAgentsByAccess,
  filterIntegrationsByAccess,
  isAgentVisible,
} from './auth/access-groups.js';
import { createEntraRoutes, getDecryptedSSOConfig } from './auth/entra.js';
import { createAuthRoutes } from './auth/local-auth.js';
import { requireRole } from './auth/rbac.js';
import { exceedsRole } from './auth/roles.js';
import { getUser, sessionMiddleware } from './auth/session-middleware.js';
import { SessionManager } from './auth/sessions.js';
import type { UserContext } from './auth/sessions.js';
import { loadConfig } from './config.js';
import { generateCaCert } from './crypto/ca.js';
import { SondeDb } from './db/index.js';
import { RunbookEngine } from './engine/runbooks.js';
import { encrypt } from './integrations/crypto.js';
import { IntegrationExecutor } from './integrations/executor.js';
import { IntegrationManager } from './integrations/manager.js';
import { ProbeRouter } from './integrations/probe-router.js';
import { logger } from './logger.js';
import { createMcpHandler } from './mcp/server.js';
import { handleDiagnose } from './mcp/tools/diagnose.js';
import { handleProbe } from './mcp/tools/probe.js';
import type { SondeOAuthProvider } from './oauth/provider.js';
import {
  AccessGroupAgentBody,
  AccessGroupIntegrationBody,
  AccessGroupUserBody,
  ActivateGraphBody,
  BulkTagsBody,
  CreateAccessGroupBody,
  CreateApiKeyBody,
  CreateAuthorizedGroupBody,
  CreateAuthorizedUserBody,
  CreateIntegrationBody,
  CreateSsoBody,
  SetTagsBody,
  TagImportBody,
  UpdateAccessGroupBody,
  UpdateApiKeyPolicyBody,
  UpdateAuthorizedGroupBody,
  UpdateAuthorizedUserBody,
  UpdateIntegrationBody,
  UpdateSsoBody,
  parseBody,
} from './schemas.js';
import { semverLt, startVersionCheckLoop } from './version-check.js';
import { AgentDispatcher } from './ws/dispatcher.js';
import { setupWsServer } from './ws/server.js';

const config = loadConfig();
const db = new SondeDb(config.dbPath);
const sessionManager = new SessionManager(db);
sessionManager.startCleanupLoop();
const dispatcher = new AgentDispatcher();
const integrationExecutor = new IntegrationExecutor();
const probeRouter = new ProbeRouter(dispatcher, integrationExecutor, db, (packName) => {
  const integration = db.listIntegrations().find((i) => i.type === packName);
  return integration?.id;
});
const runbookEngine = new RunbookEngine();

const integrationCatalog: ReadonlyMap<string, IntegrationPack> = new Map([
  [httpbinPack.manifest.name, httpbinPack],
  [servicenowPack.manifest.name, servicenowPack],
  [citrixPack.manifest.name, citrixPack],
  [graphPack.manifest.name, graphPack],
  [splunkPack.manifest.name, splunkPack],
  [proxmoxPack.manifest.name, proxmoxPack],
  [nutanixPack.manifest.name, nutanixPack],
  [vcenterPack.manifest.name, vcenterPack],
  [datadogPack.manifest.name, datadogPack],
  [lokiPack.manifest.name, lokiPack],
  [jiraPack.manifest.name, jiraPack],
  [pagerdutyPack.manifest.name, pagerdutyPack],
]);
const integrationManager = new IntegrationManager(
  db,
  integrationExecutor,
  config.secret,
  integrationCatalog,
);
integrationManager.loadAll();

// Start periodic version check for agent updates
startVersionCheckLoop(db);
runbookEngine.loadFromManifests([...packRegistry.values()].map((p) => p.manifest));
for (const runbook of proxmoxDiagnosticRunbooks) {
  runbookEngine.registerDiagnostic(runbook);
}
for (const runbook of nutanixDiagnosticRunbooks) {
  runbookEngine.registerDiagnostic(runbook);
}

function generateInstallScript(hubUrl: string): string {
  return `#!/bin/sh
set -eu

# --- Sonde Agent Installer ---
# Bootstraps Node.js 22 + @sonde/agent, then hands off to the interactive TUI.
# Usage: curl -fsSL ${hubUrl}/install | bash

RED='\\033[0;31m'
GREEN='\\033[0;32m'
CYAN='\\033[0;36m'
BOLD='\\033[1m'
RESET='\\033[0m'

info()  { printf "\${CYAN}[sonde]\${RESET} %s\\n" "$1"; }
ok()    { printf "\${GREEN}[sonde]\${RESET} %s\\n" "$1"; }
fail()  { printf "\${RED}[sonde]\${RESET} %s\\n" "$1" >&2; exit 1; }

# --- OS / arch detection ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  ;;
  Darwin) ;;
  *)      fail "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64)  ;;
  arm64|aarch64) ;;
  *)             fail "Unsupported architecture: $ARCH" ;;
esac

info "Detected $OS ($ARCH)"

# --- Node.js >= 22 check / install ---
needs_node=0
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$NODE_VER" -ge 22 ] 2>/dev/null; then
    ok "Node.js v$(node -v | sed 's/^v//') found"
  else
    info "Node.js v$(node -v | sed 's/^v//') found (need >= 22)"
    needs_node=1
  fi
else
  info "Node.js not found"
  needs_node=1
fi

if [ "$needs_node" -eq 1 ]; then
  info "Installing Node.js 22..."
  case "$OS" in
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
      elif command -v dnf >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
        sudo dnf install -y nodejs
      elif command -v yum >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
        sudo yum install -y nodejs
      else
        fail "No supported package manager found (need apt-get, dnf, or yum)"
      fi
      ;;
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install node@22
        brew link --overwrite node@22
      else
        fail "Homebrew is required to install Node.js on macOS. Install it from https://brew.sh"
      fi
      ;;
  esac

  # Verify installation
  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js installation failed"
  fi
  ok "Node.js v$(node -v | sed 's/^v//') installed"
fi

# --- Install @sonde/agent ---
info "Installing @sonde/agent..."
npm install -g @sonde/agent
ok "@sonde/agent installed"

# --- Launch interactive installer TUI ---
info "Launching Sonde installer..."
printf "\\n"
exec sonde install --hub ${hubUrl}
`;
}

// Hono app for REST routes
type Env = { Variables: { user: UserContext } };
const app = new Hono<Env>();

// Security headers middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '0');
  if (config.tlsEnabled) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// Session middleware on dashboard and API routes
app.use('/api/*', sessionMiddleware(sessionManager));
app.use('/auth/*', sessionMiddleware(sessionManager));
app.use('/docs/*', sessionMiddleware(sessionManager));

// Auth routes (login/logout/status)
app.route(
  '/auth',
  createAuthRoutes(sessionManager, {
    adminUser: config.adminUser,
    adminPassword: config.adminPassword,
  }),
);

// Entra ID SSO routes (/auth/entra/login, /auth/entra/callback)
app.route(
  '/auth',
  createEntraRoutes(sessionManager, db, {
    secret: config.secret,
    hubUrl: config.hubUrl ?? `http://localhost:${config.port}`,
  }),
);

// Public API endpoints that don't require auth
const PUBLIC_API_PATHS = new Set([
  '/api/v1/setup/status',
  '/api/v1/setup/complete',
  '/api/v1/sso/status',
]);

/**
 * API key auth middleware for /api/v1/* routes.
 * If a session already authenticated the user, skip.
 * Otherwise check Bearer token for legacy API key or scoped key.
 * Public endpoints pass through without auth.
 */
app.use('/api/v1/*', async (c, next) => {
  // Public endpoints pass through
  if (PUBLIC_API_PATHS.has(c.req.path)) return next();

  // Already authenticated by session middleware?
  if (getUser(c)) return next();

  // Check Bearer token
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  // DB key lookup
  const keyHash = hashApiKey(token);
  const record = db.getApiKeyByHash(keyHash);
  if (!record || record.revokedAt) return c.json({ error: 'Unauthorized' }, 401);
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', {
    id: `apikey:${record.id}`,
    displayName: record.name,
    role: record.roleId,
    authMethod: 'apikey',
  });
  return next();
});

// --- RBAC guards ---
app.use('/api/v1/enrollment-tokens/*', requireRole('admin'));
app.use('/api/v1/api-keys/*', requireRole('admin'));
app.use('/api/v1/authorized-users/*', requireRole('admin'));
app.use('/api/v1/authorized-groups/*', requireRole('admin'));
app.use('/api/v1/access-groups/*', requireRole('admin'));
app.use('/api/v1/audit/*', requireRole('admin'));
app.use('/api/v1/integrations/*', requireRole('admin'));
app.use('/api/v1/sso/entra', requireRole('owner'));

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    agents: dispatcher.getOnlineAgentIds().length,
  }),
);

// Enrollment token creation endpoint
app.post('/api/v1/enrollment-tokens', async (c) => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.createEnrollmentToken(token, expiresAt);

  return c.json({ token, expiresAt });
});

app.get('/api/v1/enrollment-tokens', (c) => {
  return c.json({ tokens: db.listEnrollmentTokens() });
});

// API key management endpoints (require legacy key auth)
app.post('/api/v1/api-keys', async (c) => {
  const parsed = parseBody(CreateApiKeyBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const role = body.role;
  const caller = getUser(c);
  if (caller && exceedsRole(caller.role, role)) {
    return c.json({ error: 'Cannot create key with role higher than your own' }, 403);
  }

  const id = crypto.randomUUID();
  const rawKey = crypto.randomUUID();
  const keyHash = hashApiKey(rawKey);
  const policyJson = JSON.stringify({ ...body.policy, role });

  db.createApiKey(id, body.name, keyHash, policyJson, role, 'mcp');

  return c.json({ id, key: rawKey, name: body.name, policy: { ...body.policy, role } }, 201);
});

app.get('/api/v1/api-keys', (c) => {
  const keys = db.listApiKeys().map((k) => {
    let role = 'member';
    try {
      const parsed = JSON.parse(k.policyJson);
      if (parsed.role) role = parsed.role;
    } catch {}
    return { ...k, role, keyType: k.keyType };
  });
  return c.json({ keys });
});

app.delete('/api/v1/api-keys/:id', (c) => {
  db.revokeApiKey(c.req.param('id'));
  return c.json({ ok: true });
});

app.post('/api/v1/api-keys/:id/rotate', (c) => {
  const id = c.req.param('id');
  const rawKey = crypto.randomBytes(32).toString('hex');
  const newKeyHash = hashApiKey(rawKey);
  const rotated = db.rotateApiKey(id, newKeyHash);
  if (!rotated) {
    return c.json({ error: 'API key not found or already revoked' }, 404);
  }
  return c.json({ id, key: rawKey });
});

app.put('/api/v1/api-keys/:id/policy', async (c) => {
  const parsed = parseBody(UpdateApiKeyPolicyBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const updated = db.updateApiKeyPolicy(c.req.param('id'), JSON.stringify(parsed.data.policy));
  if (!updated) {
    return c.json({ error: 'API key not found' }, 404);
  }
  return c.json({ ok: true });
});

// --- SSO configuration endpoints ---

// Public: check if SSO is enabled (needed by login page)
app.get('/api/v1/sso/status', (c) => {
  const ssoConfig = db.getSsoConfig();
  return c.json({
    configured: !!ssoConfig,
    enabled: ssoConfig?.enabled ?? false,
  });
});

// Admin: get SSO config (without decrypted secret)
app.get('/api/v1/sso/entra', (c) => {
  const ssoConfig = db.getSsoConfig();
  if (!ssoConfig) {
    return c.json({ error: 'SSO not configured' }, 404);
  }
  return c.json({
    tenantId: ssoConfig.tenantId,
    clientId: ssoConfig.clientId,
    enabled: ssoConfig.enabled,
  });
});

// Admin: create/update SSO config
app.post('/api/v1/sso/entra', async (c) => {
  const parsed = parseBody(CreateSsoBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const clientSecretEnc = encrypt(body.clientSecret, config.secret);
  db.upsertSsoConfig(body.tenantId, body.clientId, clientSecretEnc, body.enabled);
  syncGraphIntegrationCredentials();
  return c.json({ ok: true });
});

// Admin: update SSO config
app.put('/api/v1/sso/entra', async (c) => {
  const parsed = parseBody(UpdateSsoBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const existing = db.getSsoConfig();
  if (!existing) {
    return c.json({ error: 'SSO not configured. Use POST to create.' }, 404);
  }

  const tenantId = body.tenantId ?? existing.tenantId;
  const clientId = body.clientId ?? existing.clientId;
  const clientSecretEnc = body.clientSecret
    ? encrypt(body.clientSecret, config.secret)
    : existing.clientSecretEnc;
  const enabled = body.enabled ?? existing.enabled;

  db.upsertSsoConfig(tenantId, clientId, clientSecretEnc, enabled);
  syncGraphIntegrationCredentials();
  return c.json({ ok: true });
});

// --- Authorized users endpoints ---

app.get('/api/v1/authorized-users', (c) => {
  return c.json({ users: db.listAuthorizedUsers() });
});

app.post('/api/v1/authorized-users', async (c) => {
  const parsed = parseBody(CreateAuthorizedUserBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const id = crypto.randomUUID();
  const role = body.role;
  const caller = getUser(c);
  if (caller && exceedsRole(caller.role, role)) {
    return c.json({ error: 'Cannot assign role higher than your own' }, 403);
  }

  try {
    db.createAuthorizedUser(id, body.email, role);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'User with this email already exists' }, 409);
    }
    throw error;
  }

  return c.json({ id, email: body.email, roleId: role }, 201);
});

app.put('/api/v1/authorized-users/:id', async (c) => {
  const parsed = parseBody(UpdateAuthorizedUserBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;
  const caller2 = getUser(c);
  if (body.role && caller2 && exceedsRole(caller2.role, body.role)) {
    return c.json({ error: 'Cannot assign role higher than your own' }, 403);
  }

  const id = c.req.param('id');
  let updated = false;
  if (body.role) {
    updated = db.updateAuthorizedUserRole(id, body.role) || updated;
  }
  if (body.enabled !== undefined) {
    updated = db.updateAuthorizedUserEnabled(id, body.enabled) || updated;
  }
  if (!updated) {
    return c.json({ error: 'Authorized user not found' }, 404);
  }
  return c.json({ ok: true });
});

app.delete('/api/v1/authorized-users/:id', (c) => {
  const deleted = db.deleteAuthorizedUser(c.req.param('id'));
  if (!deleted) {
    return c.json({ error: 'Authorized user not found' }, 404);
  }
  return c.json({ ok: true });
});

// --- Authorized groups endpoints ---

app.get('/api/v1/authorized-groups', (c) => {
  return c.json({ groups: db.listAuthorizedGroups() });
});

app.post('/api/v1/authorized-groups', async (c) => {
  const parsed = parseBody(CreateAuthorizedGroupBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const id = crypto.randomUUID();
  const role = body.role;
  const caller3 = getUser(c);
  if (caller3 && exceedsRole(caller3.role, role)) {
    return c.json({ error: 'Cannot assign role higher than your own' }, 403);
  }

  try {
    db.createAuthorizedGroup(id, body.entraGroupId, body.entraGroupName, role);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Group with this Entra group ID already exists' }, 409);
    }
    throw error;
  }

  return c.json({ id, entraGroupId: body.entraGroupId, roleId: role }, 201);
});

app.put('/api/v1/authorized-groups/:id', async (c) => {
  const parsed = parseBody(UpdateAuthorizedGroupBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const caller4 = getUser(c);
  if (caller4 && exceedsRole(caller4.role, body.role)) {
    return c.json({ error: 'Cannot assign role higher than your own' }, 403);
  }

  const updated = db.updateAuthorizedGroupRole(c.req.param('id'), body.role);
  if (!updated) {
    return c.json({ error: 'Authorized group not found' }, 404);
  }
  return c.json({ ok: true });
});

app.delete('/api/v1/authorized-groups/:id', (c) => {
  const deleted = db.deleteAuthorizedGroup(c.req.param('id'));
  if (!deleted) {
    return c.json({ error: 'Authorized group not found' }, 404);
  }
  return c.json({ ok: true });
});

// --- Access groups endpoints ---

app.get('/api/v1/access-groups', (c) => {
  const groups = db.listAccessGroups().map((g) => ({
    ...g,
    agents: db.getAccessGroupAgents(g.id),
    integrations: db.getAccessGroupIntegrations(g.id),
    users: db.getAccessGroupUsers(g.id),
  }));
  return c.json({ groups });
});

app.post('/api/v1/access-groups', async (c) => {
  const parsed = parseBody(CreateAccessGroupBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const id = crypto.randomUUID();
  try {
    db.createAccessGroup(id, body.name, body.description);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Access group with this name already exists' }, 409);
    }
    throw error;
  }

  return c.json({ id, name: body.name }, 201);
});

app.put('/api/v1/access-groups/:id', async (c) => {
  const parsed = parseBody(UpdateAccessGroupBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const updated = db.updateAccessGroup(c.req.param('id'), parsed.data);
  if (!updated) {
    return c.json({ error: 'Access group not found' }, 404);
  }
  return c.json({ ok: true });
});

app.delete('/api/v1/access-groups/:id', (c) => {
  const deleted = db.deleteAccessGroup(c.req.param('id'));
  if (!deleted) {
    return c.json({ error: 'Access group not found' }, 404);
  }
  return c.json({ ok: true });
});

// Access group sub-resources: agents
app.post('/api/v1/access-groups/:id/agents', async (c) => {
  const group = db.getAccessGroup(c.req.param('id'));
  if (!group) return c.json({ error: 'Access group not found' }, 404);

  const parsed = parseBody(AccessGroupAgentBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  db.addAccessGroupAgent(group.id, parsed.data.pattern);
  return c.json({ ok: true }, 201);
});

app.delete('/api/v1/access-groups/:id/agents', async (c) => {
  const parsed = parseBody(AccessGroupAgentBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const deleted = db.removeAccessGroupAgent(c.req.param('id'), parsed.data.pattern);
  if (!deleted) return c.json({ error: 'Pattern not found in access group' }, 404);
  return c.json({ ok: true });
});

// Access group sub-resources: integrations
app.post('/api/v1/access-groups/:id/integrations', async (c) => {
  const group = db.getAccessGroup(c.req.param('id'));
  if (!group) return c.json({ error: 'Access group not found' }, 404);

  const parsed = parseBody(AccessGroupIntegrationBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  db.addAccessGroupIntegration(group.id, parsed.data.integrationId);
  return c.json({ ok: true }, 201);
});

app.delete('/api/v1/access-groups/:id/integrations', async (c) => {
  const parsed = parseBody(AccessGroupIntegrationBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const deleted = db.removeAccessGroupIntegration(c.req.param('id'), parsed.data.integrationId);
  if (!deleted) return c.json({ error: 'Integration not found in access group' }, 404);
  return c.json({ ok: true });
});

// Access group sub-resources: users
app.post('/api/v1/access-groups/:id/users', async (c) => {
  const group = db.getAccessGroup(c.req.param('id'));
  if (!group) return c.json({ error: 'Access group not found' }, 404);

  const parsed = parseBody(AccessGroupUserBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  db.addAccessGroupUser(group.id, parsed.data.userId);
  return c.json({ ok: true }, 201);
});

app.delete('/api/v1/access-groups/:id/users', async (c) => {
  const parsed = parseBody(AccessGroupUserBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const deleted = db.removeAccessGroupUser(c.req.param('id'), parsed.data.userId);
  if (!deleted) return c.json({ error: 'User not found in access group' }, 404);
  return c.json({ ok: true });
});

// --- Graph integration activation endpoint ---

/** Sync Graph integration credentials when SSO config changes */
function syncGraphIntegrationCredentials(): void {
  const ssoConfig = getDecryptedSSOConfig(db, config.secret);
  if (!ssoConfig) return;

  const existing = integrationManager.list().find((i) => i.type === 'graph');
  if (!existing) return;

  integrationManager.update(existing.id, {
    credentials: {
      packName: 'graph',
      authMethod: 'oauth2',
      credentials: {
        tenantId: ssoConfig.tenantId,
        clientId: ssoConfig.clientId,
        clientSecret: ssoConfig.clientSecret,
      },
    },
  });
}

app.post('/api/v1/integrations/graph/activate', async (c) => {
  const parsed = parseBody(ActivateGraphBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const ssoConfig = getDecryptedSSOConfig(db, config.secret);
  if (!ssoConfig) {
    return c.json({ error: 'Entra SSO is not configured or not enabled' }, 400);
  }

  const existing = integrationManager.list().find((i) => i.type === 'graph');
  if (existing) {
    return c.json({ error: 'A Graph integration already exists' }, 409);
  }

  try {
    const result = integrationManager.create({
      type: 'graph',
      name: body.name,
      config: { endpoint: 'https://graph.microsoft.com/v1.0' },
      credentials: {
        packName: 'graph',
        authMethod: 'oauth2',
        credentials: {
          tenantId: ssoConfig.tenantId,
          clientId: ssoConfig.clientId,
          clientSecret: ssoConfig.clientSecret,
        },
      },
    });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Integration with this name already exists' }, 409);
    }
    throw error;
  }
});

// --- Integration management endpoints (require master API key) ---

app.post('/api/v1/integrations', async (c) => {
  const parsed = parseBody(CreateIntegrationBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  try {
    const result = integrationManager.create({
      type: body.type,
      name: body.name,
      config: body.config,
      credentials: body.credentials,
    });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Integration with this name already exists' }, 409);
    }
    throw error;
  }
});

app.get('/api/v1/integrations', (c) => {
  let integrations = integrationManager.list();

  const user = getUser(c);
  if (user) {
    integrations = filterIntegrationsByAccess(db, user.id, integrations);
  }

  const allTags = db.getAllIntegrationTags();
  const withTags = integrations.map((i) => ({
    ...i,
    tags: allTags.get(i.id) ?? [],
  }));

  return c.json({ integrations: withTags });
});

app.get('/api/v1/integrations/:id', (c) => {
  const integration = integrationManager.get(c.req.param('id'));
  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }
  return c.json(integration);
});

app.put('/api/v1/integrations/:id', async (c) => {
  const parsed = parseBody(UpdateIntegrationBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const updated = integrationManager.update(c.req.param('id'), parsed.data);

  if (!updated) {
    return c.json({ error: 'Integration not found' }, 404);
  }
  return c.json({ ok: true });
});

app.delete('/api/v1/integrations/:id', (c) => {
  integrationManager.delete(c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/v1/integrations/:id/config', (c) => {
  const config = integrationManager.getConfig(c.req.param('id'));
  if (!config) {
    return c.json({ error: 'Integration not found' }, 404);
  }
  return c.json({ config });
});

app.post('/api/v1/integrations/:id/test', async (c) => {
  const integration = integrationManager.get(c.req.param('id'));
  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const result = await integrationManager.testConnection(c.req.param('id'));
  return c.json(result);
});

app.get('/api/v1/integrations/:id/events', (c) => {
  const integration = integrationManager.get(c.req.param('id'));
  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const offset = Number(c.req.query('offset')) || 0;
  const events = db.getIntegrationEvents(c.req.param('id'), { limit, offset });
  return c.json({ events });
});

// --- Tag management endpoints ---

app.put('/api/v1/agents/:id/tags', requireRole('admin'), async (c) => {
  const parsed = parseBody(SetTagsBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const agent = db.getAgent(c.req.param('id'));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  db.setAgentTags(agent.id, parsed.data.tags);
  return c.json({ ok: true });
});

app.patch('/api/v1/agents/tags', requireRole('admin'), async (c) => {
  const parsed = parseBody(BulkTagsBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  if (parsed.data.add) db.addAgentTags(parsed.data.ids, parsed.data.add);
  if (parsed.data.remove) db.removeAgentTags(parsed.data.ids, parsed.data.remove);
  return c.json({ ok: true });
});

app.put('/api/v1/integrations/:id/tags', requireRole('admin'), async (c) => {
  const parsed = parseBody(SetTagsBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const integration = integrationManager.get(c.req.param('id'));
  if (!integration) return c.json({ error: 'Integration not found' }, 404);

  db.setIntegrationTags(c.req.param('id'), parsed.data.tags);
  return c.json({ ok: true });
});

app.patch('/api/v1/integrations/tags', requireRole('admin'), async (c) => {
  const parsed = parseBody(BulkTagsBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  if (parsed.data.add) db.addIntegrationTags(parsed.data.ids, parsed.data.add);
  if (parsed.data.remove) db.removeIntegrationTags(parsed.data.ids, parsed.data.remove);
  return c.json({ ok: true });
});

app.post('/api/v1/tags/import', requireRole('admin'), async (c) => {
  const parsed = parseBody(TagImportBody, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const notFound: string[] = [];
  let updated = 0;

  for (const entry of parsed.data.entries) {
    if (parsed.data.type === 'agent') {
      const agent = db.getAgent(entry.name);
      if (!agent) {
        notFound.push(entry.name);
        continue;
      }
      db.setAgentTags(agent.id, entry.tags);
      updated++;
    } else {
      const integration = db
        .listIntegrations()
        .find((i) => i.name === entry.name);
      if (!integration) {
        notFound.push(entry.name);
        continue;
      }
      db.setIntegrationTags(integration.id, entry.tags);
      updated++;
    }
  }

  return c.json({ updated, notFound });
});

// Agent list endpoint (unauthenticated — dashboard needs it, filtered by access groups if user context exists)
app.get('/api/v1/agents', (c) => {
  const allTags = db.getAllAgentTags();
  let agents = db.getAllAgents().map((a) => ({
    ...a,
    tags: allTags.get(a.id) ?? [],
    status: dispatcher.isAgentOnline(a.id)
      ? 'online'
      : a.status === 'degraded'
        ? 'degraded'
        : 'offline',
  }));

  const user = getUser(c);
  if (user) {
    agents = filterAgentsByAccess(db, user.id, agents);
  }

  return c.json({ agents });
});

// Agent detail endpoint
app.get('/api/v1/agents/:id', (c) => {
  const agent = db.getAgent(c.req.param('id'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  // Access group filtering — return 404 if user can't see this agent
  const user = getUser(c);
  if (user && !isAgentVisible(db, user.id, agent.name)) {
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

// Outdated agents endpoint
app.get('/api/v1/agents/outdated', (c) => {
  const latestVersion = db.getHubSetting('latest_agent_version');
  if (!latestVersion) {
    return c.json({ latestVersion: null, outdated: [] });
  }
  const agents = db.getAllAgents();
  const outdated = agents
    .filter((a) => a.agentVersion && semverLt(a.agentVersion, latestVersion))
    .map((a) => ({
      id: a.id,
      name: a.name,
      currentVersion: a.agentVersion,
      latestVersion,
    }));
  return c.json({ latestVersion, outdated });
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
  const mapManifest = (manifest: {
    name: string;
    type?: string;
    version: string;
    description: string;
    probes: Array<{
      name: string;
      description: string;
      capability: string;
      params?: Record<string, unknown>;
      timeout: number;
    }>;
    runbook?: { category: string; probes: string[]; parallel: boolean };
  }) => ({
    name: manifest.name,
    type: manifest.type ?? 'agent',
    version: manifest.version,
    description: manifest.description,
    probes: manifest.probes.map((probe) => ({
      name: probe.name,
      description: probe.description,
      capability: probe.capability,
      params: probe.params,
      timeout: probe.timeout,
    })),
    runbook: manifest.runbook
      ? {
          category: manifest.runbook.category,
          probes: manifest.runbook.probes,
          parallel: manifest.runbook.parallel,
        }
      : null,
  });

  const agentPacks = [...packRegistry.values()].map((p) => mapManifest(p.manifest));
  const integrationPacks = integrationExecutor
    .getRegisteredPacks()
    .map((p) => mapManifest(p.manifest));

  return c.json({ packs: [...agentPacks, ...integrationPacks] });
});

// Execute single probe via REST (authenticated — used by Try It page)
app.post('/api/v1/probe', async (c) => {
  const parsed = parseBody(ProbeInput, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  // Access group check: if targeting a specific agent, verify visibility
  const user = getUser(c);
  if (user && body.agent) {
    if (!isAgentVisible(db, user.id, body.agent)) {
      return c.json({ error: 'Agent not accessible' }, 403);
    }
  }

  const auth = { type: 'api_key' as const, keyId: 'legacy', policy: {} };
  const result = await handleProbe(body, probeRouter, db, auth);
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
  const parsed = parseBody(DiagnoseInput, await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const auth = { type: 'api_key' as const, keyId: 'legacy', policy: {} };
  const connectedAgents = dispatcher.getOnlineAgents().map((a) => a.name);
  const result = await handleDiagnose(body, probeRouter, runbookEngine, db, auth, connectedAgents);
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

  // Auto-generate a default admin API key if none exist
  let apiKey: string | undefined;
  if (db.countApiKeys() === 0) {
    const id = crypto.randomUUID();
    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    db.createApiKey(id, 'default', keyHash, '{}', 'admin');
    apiKey = rawKey;
  }

  return c.json({ ok: true, ...(apiKey ? { apiKey } : {}) });
});

// Agent installer script (curl -fsSL https://hub.example.com/install | bash)
app.get('/install', (c) => {
  if (!config.hubUrl) {
    return c.text('SONDE_HUB_URL must be configured to serve the install script', 500);
  }
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(generateInstallScript(config.hubUrl));
});

// Static file serving for docs (Starlight)
const docsDist = path.resolve(
  process.cwd(),
  'packages/docs/dist',
);
const docsExists = fs.existsSync(docsDist);

if (docsExists) {
  // Require authenticated session for docs
  app.use('/docs/*', async (c, next) => {
    const user = getUser(c);
    if (!user) return c.redirect('/login');
    await next();
  });

  // Serve static assets (CSS, JS, images, fonts)
  app.use(
    '/docs/*',
    serveStatic({
      root: path.relative(process.cwd(), docsDist),
      rewriteRequestPath: (p) => p.replace(/^\/docs/, ''),
    }),
  );
  app.get('/docs', (c) => c.redirect('/docs/'));
  // Fallback for HTML pages (serveStatic doesn't resolve
  // directory paths to index.html with rewriteRequestPath)
  app.get('/docs/*', (c) => {
    const subPath = c.req.path.replace(/^\/docs/, '') || '/';
    const candidates = [
      path.join(docsDist, subPath, 'index.html'),
      path.join(docsDist, subPath),
    ];
    for (const candidate of candidates) {
      if (
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        return c.html(fs.readFileSync(candidate, 'utf-8'));
      }
    }
    const notFound = path.join(docsDist, '404.html');
    if (fs.existsSync(notFound)) {
      return c.html(fs.readFileSync(notFound, 'utf-8'), 404);
    }
    return c.notFound();
  });
}

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
  ca = db.getCa(config.secret);
  if (!ca) {
    logger.info('Generating hub CA certificate');
    ca = generateCaCert();
    db.storeCa(ca.certPem, ca.keyPem, config.secret);
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
const mcpHandler = createMcpHandler(
  probeRouter,
  dispatcher,
  db,
  runbookEngine,
  integrationManager,
  packRegistry,
  oauthProvider,
);

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
setupWsServer(
  server,
  dispatcher,
  db,
  (key) => {
    const record = db.getApiKeyByHash(hashApiKey(key));
    return !!record && !record.revokedAt;
  },
  ca,
  sessionManager,
);

// MCP diagnostics can fan out to many probes — allow up to 5 minutes
// before the HTTP socket is destroyed. Default is 120s which silently
// kills long-running tool calls like proxmox-cluster.
server.timeout = 300_000;
// Keep idle TCP connections alive between requests (default 5s is too
// aggressive — forces a new TCP handshake + TLS negotiation per tool call).
server.keepAliveTimeout = 300_000;

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
  if (config.adminUser) console.log('  Admin auth: enabled');
  if (config.hubUrl) console.log(`  OAuth:     ${config.hubUrl}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  sessionManager.stopCleanupLoop();
  server.close();
  db.close();
  process.exit(0);
});

export {
  app,
  config,
  db,
  dispatcher,
  integrationExecutor,
  integrationManager,
  probeRouter,
  sessionManager,
};
