import crypto from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SondeDb } from '../db/index.js';
import { encrypt } from '../integrations/crypto.js';
import { type FetchFn, createEntraRoutes } from './entra.js';
import { sessionMiddleware } from './session-middleware.js';
import { SessionManager } from './sessions.js';

// Mock jose so fake test JWTs pass verification
vi.mock('jose', () => ({
  createRemoteJWKSet: () => () => Promise.resolve({}),
  jwtVerify: async (token: string) => {
    const payloadB64 = token.split('.')[1] as string;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return { payload, protectedHeader: { alg: 'RS256' } };
  },
}));

const TEST_SECRET = 'test-secret-at-least-16-chars';
const TEST_HUB_URL = 'https://hub.example.com';
const TEST_TENANT = 'tenant-123';
const TEST_CLIENT_ID = 'client-456';
const TEST_CLIENT_SECRET = 'super-secret';

function createIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

function createTestApp(mockFetch?: FetchFn) {
  const db = new SondeDb(':memory:');
  const sm = new SessionManager(db);

  const app = new Hono();
  app.use('/auth/*', sessionMiddleware(sm));
  app.route(
    '/auth',
    createEntraRoutes(sm, db, { secret: TEST_SECRET, hubUrl: TEST_HUB_URL }, mockFetch),
  );

  return { app, db, sm };
}

function configureSso(db: SondeDb) {
  const clientSecretEnc = encrypt(TEST_CLIENT_SECRET, TEST_SECRET);
  db.upsertSsoConfig(TEST_TENANT, TEST_CLIENT_ID, clientSecretEnc, true);
}

/** Helper to get a valid state from the login redirect. */
async function getState(app: Hono) {
  const loginRes = await app.request('/auth/entra/login');
  const stateCookie = loginRes.headers.get('set-cookie') ?? '';
  const stateMatch = stateCookie.match(/entra_state=([^;]+)/);
  const stateValue = stateMatch?.[1] ?? '';
  const location = loginRes.headers.get('location') ?? '';
  const url = new URL(location);
  const state = url.searchParams.get('state') ?? '';
  return { stateValue, state, location };
}

/** Perform the callback with given state and cookies. */
function callbackRequest(app: Hono, state: string, stateValue: string) {
  return app.request(`/auth/entra/callback?code=auth-code-123&state=${state}`, {
    headers: { Cookie: `entra_state=${stateValue}` },
  });
}

describe('entra auth routes', () => {
  let db: SondeDb;
  let sm: SessionManager;

  afterEach(() => {
    sm?.stopCleanupLoop();
    db?.close();
    vi.restoreAllMocks();
  });

  describe('GET /auth/entra/login', () => {
    it('redirects to Entra authorize URL when SSO is configured', async () => {
      const ctx = createTestApp();
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);

      const res = await ctx.app.request('/auth/entra/login');

      expect(res.status).toBe(302);
      const location = res.headers.get('location') ?? '';
      expect(location).toContain(
        'https://login.microsoftonline.com/tenant-123/oauth2/v2.0/authorize',
      );
      expect(location).toContain(`client_id=${TEST_CLIENT_ID}`);
      expect(location).toContain('response_type=code');
      expect(location).toContain(encodeURIComponent(`${TEST_HUB_URL}/auth/entra/callback`));
      // No authorized_groups → basic scope
      expect(location).toContain('scope=openid+email+profile');
      expect(location).not.toContain('GroupMember');
    });

    it('includes GroupMember.Read.All scope when authorized_groups exist', async () => {
      const ctx = createTestApp();
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedGroup(crypto.randomUUID(), 'group-1', 'SG-Sonde', 'member');

      const res = await ctx.app.request('/auth/entra/login');
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('GroupMember.Read.All');
    });

    it('returns 404 when SSO is not configured', async () => {
      const ctx = createTestApp();
      db = ctx.db;
      sm = ctx.sm;

      const res = await ctx.app.request('/auth/entra/login');
      expect(res.status).toBe(404);
    });

    it('returns 404 when SSO is disabled', async () => {
      const ctx = createTestApp();
      db = ctx.db;
      sm = ctx.sm;

      const clientSecretEnc = encrypt(TEST_CLIENT_SECRET, TEST_SECRET);
      db.upsertSsoConfig(TEST_TENANT, TEST_CLIENT_ID, clientSecretEnc, false);

      const res = await ctx.app.request('/auth/entra/login');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /auth/entra/callback — individual user auth', () => {
    it('creates session for authorized user', async () => {
      const mockFetch = vi.fn<FetchFn>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'john@example.com',
              name: 'John Doe',
              oid: 'oid-john',
            }),
            access_token: 'at-123',
          }),
          { status: 200 },
        ),
      );

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedUser('user-1', 'john@example.com', 'admin');

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      expect(res.headers.get('set-cookie')).toContain('sonde_session=');
    });

    it('updates login audit on successful login', async () => {
      const mockFetch = vi.fn<FetchFn>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'john@example.com',
              name: 'John Updated',
              oid: 'oid-john',
            }),
            access_token: 'at-123',
          }),
          { status: 200 },
        ),
      );

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedUser('user-1', 'john@example.com', 'admin');

      const { state, stateValue } = await getState(ctx.app);
      await callbackRequest(ctx.app, state, stateValue);

      const user = db.getAuthorizedUserByEmail('john@example.com');
      expect(user?.lastLoginAt).toBeTruthy();
      expect(user?.loginCount).toBeGreaterThanOrEqual(1);
      expect(user?.entraObjectId).toBe('oid-john');
      expect(user?.displayName).toBe('John Updated');
    });

    it('disabled user treated as not found', async () => {
      const mockFetch = vi.fn<FetchFn>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'disabled@example.com',
              name: 'Disabled User',
              oid: 'oid-disabled',
            }),
            access_token: 'at-123',
          }),
          { status: 200 },
        ),
      );

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedUser('user-disabled', 'disabled@example.com', 'admin');
      db.updateAuthorizedUserEnabled('user-disabled', false);

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?error=unauthorized');
    });

    it('redirects to /login?error=unauthorized for unknown user', async () => {
      const mockFetch = vi.fn<FetchFn>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'stranger@example.com',
              name: 'Stranger',
              oid: 'oid-stranger',
            }),
            access_token: 'at-123',
          }),
          { status: 200 },
        ),
      );

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?error=unauthorized');
    });
  });

  describe('GET /auth/entra/callback — group auth', () => {
    it('authorizes user via group when no individual match', async () => {
      const mockFetch = vi.fn<FetchFn>().mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('graph.microsoft.com')) {
          return new Response(
            JSON.stringify({
              value: [
                { id: 'entra-group-123', displayName: 'SG-Sonde-Users' },
                { id: 'other-group', displayName: 'SG-Other' },
              ],
            }),
            { status: 200 },
          );
        }
        // Token exchange
        return new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'groupuser@example.com',
              name: 'Group User',
              oid: 'oid-group',
            }),
            access_token: 'at-group',
          }),
          { status: 200 },
        );
      });

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedGroup(crypto.randomUUID(), 'entra-group-123', 'SG-Sonde-Users', 'member');

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');

      // Should auto-create authorized_users row
      const autoUser = db.getAuthorizedUserByEmail('groupuser@example.com');
      expect(autoUser).toBeDefined();
      expect(autoUser?.createdBy).toBe('auto:entra_group');
      expect(autoUser?.roleId).toBe('member');
    });

    it('dual auth: takes highest role from individual + group', async () => {
      const mockFetch = vi.fn<FetchFn>().mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('graph.microsoft.com')) {
          return new Response(
            JSON.stringify({
              value: [{ id: 'admin-group-id', displayName: 'SG-Sonde-Admins' }],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'dualuser@example.com',
              name: 'Dual User',
              oid: 'oid-dual',
            }),
            access_token: 'at-dual',
          }),
          { status: 200 },
        );
      });

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);

      // Individual user as member
      db.createAuthorizedUser('user-dual', 'dualuser@example.com', 'member');
      // Group as admin
      db.createAuthorizedGroup(crypto.randomUUID(), 'admin-group-id', 'SG-Sonde-Admins', 'admin');

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');

      // Session role should be admin (highest of member + admin)
      const sessionCookie = res.headers.get('set-cookie') ?? '';
      const sessionMatch = sessionCookie.match(/sonde_session=([^;]+)/);
      const sessionId = sessionMatch?.[1] ?? '';
      const session = sm.getSession(sessionId);
      expect(session?.role).toBe('admin');
    });

    it('Graph API skipped when no groups configured', async () => {
      const mockFetch = vi.fn<FetchFn>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'solo@example.com',
              name: 'Solo User',
              oid: 'oid-solo',
            }),
            access_token: 'at-solo',
          }),
          { status: 200 },
        ),
      );

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedUser('user-solo', 'solo@example.com', 'admin');

      const { state, stateValue } = await getState(ctx.app);
      await callbackRequest(ctx.app, state, stateValue);

      // Only 1 fetch call (token exchange), no Graph API call
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const firstCallUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(firstCallUrl).toContain('login.microsoftonline.com');
    });

    it('Graph API failure is non-fatal for individually authorized user', async () => {
      const mockFetch = vi.fn<FetchFn>().mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('graph.microsoft.com')) {
          return new Response('Internal Server Error', { status: 500 });
        }
        return new Response(
          JSON.stringify({
            id_token: createIdToken({
              preferred_username: 'resilient@example.com',
              name: 'Resilient User',
              oid: 'oid-resilient',
            }),
            access_token: 'at-resilient',
          }),
          { status: 200 },
        );
      });

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);
      db.createAuthorizedUser('user-resilient', 'resilient@example.com', 'admin');
      db.createAuthorizedGroup(crypto.randomUUID(), 'some-group', 'Some Group', 'member');

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      // Should still succeed — individual auth is sufficient
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    });
  });

  describe('error handling', () => {
    it('redirects to /login?error=state_mismatch on state mismatch', async () => {
      const ctx = createTestApp();
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);

      const res = await ctx.app.request('/auth/entra/callback?code=auth-code&state=wrong', {
        headers: { Cookie: 'entra_state=different' },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?error=state_mismatch');
    });

    it('returns 404 when SSO not configured', async () => {
      const ctx = createTestApp();
      db = ctx.db;
      sm = ctx.sm;

      const res = await ctx.app.request('/auth/entra/callback?code=test&state=test', {
        headers: { Cookie: 'entra_state=test' },
      });

      expect(res.status).toBe(404);
    });

    it('redirects on token exchange failure', async () => {
      const mockFetch = vi
        .fn<FetchFn>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
        );

      const ctx = createTestApp(mockFetch);
      db = ctx.db;
      sm = ctx.sm;
      configureSso(db);

      const { state, stateValue } = await getState(ctx.app);
      const res = await callbackRequest(ctx.app, state, stateValue);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?error=token_exchange_failed');
    });
  });
});
