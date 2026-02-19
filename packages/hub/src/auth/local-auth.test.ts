import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { SondeDb } from '../db/index.js';
import { createAuthRoutes } from './local-auth.js';
import { sessionMiddleware } from './session-middleware.js';
import { SessionManager } from './sessions.js';

function createTestApp() {
  const db = new SondeDb(':memory:');
  const sm = new SessionManager(db);
  const config = { adminUser: 'admin', adminPassword: 'secretpass123' };

  const app = new Hono();
  app.use('/auth/*', sessionMiddleware(sm));
  app.route('/auth', createAuthRoutes(sm, config));

  return { app, db, sm };
}

describe('local-auth routes', () => {
  let db: SondeDb;
  let sm: SessionManager;

  afterEach(() => {
    sm?.stopCleanupLoop();
    db?.close();
  });

  it('POST /auth/local/login succeeds with correct credentials', async () => {
    const ctx = createTestApp();
    db = ctx.db;
    sm = ctx.sm;

    const res = await ctx.app.request('/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secretpass123' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; displayName: string; role: string };
    expect(body.success).toBe(true);
    expect(body.displayName).toBe('Admin');
    expect(body.role).toBe('owner');

    // Should set cookie
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('sonde_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST /auth/local/login rejects wrong password', async () => {
    const ctx = createTestApp();
    db = ctx.db;
    sm = ctx.sm;

    const res = await ctx.app.request('/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid credentials');
  });

  it('POST /auth/local/login rejects wrong username', async () => {
    const ctx = createTestApp();
    db = ctx.db;
    sm = ctx.sm;

    const res = await ctx.app.request('/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hacker', password: 'secretpass123' }),
    });

    expect(res.status).toBe(401);
  });

  it('GET /auth/status returns unauthenticated without cookie', async () => {
    const ctx = createTestApp();
    db = ctx.db;
    sm = ctx.sm;

    const res = await ctx.app.request('/auth/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it('GET /auth/status returns user context with valid session cookie', async () => {
    const ctx = createTestApp();
    db = ctx.db;
    sm = ctx.sm;

    // Login first
    const loginRes = await ctx.app.request('/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secretpass123' }),
    });
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    // Extract the cookie value
    const cookieMatch = setCookie.match(/sonde_session=([^;]+)/);
    expect(cookieMatch).not.toBeNull();
    const sessionCookie = cookieMatch?.[1];

    // Check status with cookie
    const res = await ctx.app.request('/auth/status', {
      headers: { Cookie: `sonde_session=${sessionCookie}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      user: { id: string; displayName: string; role: string; authMethod: string };
    };
    expect(body.authenticated).toBe(true);
    expect(body.user.displayName).toBe('Admin');
    expect(body.user.role).toBe('owner');
    expect(body.user.authMethod).toBe('local');
  });

  it('DELETE /auth/session clears the session', async () => {
    const ctx = createTestApp();
    db = ctx.db;
    sm = ctx.sm;

    // Login
    const loginRes = await ctx.app.request('/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secretpass123' }),
    });
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/sonde_session=([^;]+)/);
    const sessionCookie = cookieMatch?.[1];

    // Logout
    const logoutRes = await ctx.app.request('/auth/session', {
      method: 'DELETE',
      headers: { Cookie: `sonde_session=${sessionCookie}` },
    });
    expect(logoutRes.status).toBe(200);

    // Status should now be unauthenticated
    const statusRes = await ctx.app.request('/auth/status', {
      headers: { Cookie: `sonde_session=${sessionCookie}` },
    });
    const body = (await statusRes.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it('rejects login when no admin credentials are configured', async () => {
    const noDB = new SondeDb(':memory:');
    const noSm = new SessionManager(noDB);
    const noConfigApp = new Hono();
    noConfigApp.use('/auth/*', sessionMiddleware(noSm));
    noConfigApp.route('/auth', createAuthRoutes(noSm, {}));

    const res = await noConfigApp.request('/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'anything' }),
    });

    expect(res.status).toBe(401);

    noSm.stopCleanupLoop();
    noDB.close();
  });
});
