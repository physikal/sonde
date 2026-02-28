import crypto from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SondeDb } from '../db/index.js';
import { verifyPassword } from './password.js';
import { SESSION_COOKIE, getUser } from './session-middleware.js';
import type { SessionManager } from './sessions.js';

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;

interface LoginAttempt {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// Prune stale entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now >= entry.resetAt) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60_000).unref();

interface LocalAuthConfig {
  adminUser?: string;
  adminPassword?: string;
}

export function createAuthRoutes(
  sessionManager: SessionManager,
  config: LocalAuthConfig,
  db: SondeDb,
): Hono {
  const auth = new Hono();

  // POST /auth/local/login
  auth.post('/local/login', async (c) => {
    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';

    if (isRateLimited(clientIp)) {
      return c.json(
        { error: 'Too many login attempts. Try again in 1 minute.' },
        429,
      );
    }

    const body = await c.req.json<{ username?: string; password?: string }>();

    if (!body.username || !body.password) {
      recordFailedLogin(clientIp);
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Check DB admin first
    const dbAdmin = db.getLocalAdminByUsername(body.username);
    if (dbAdmin) {
      const valid = await verifyPassword(
        body.password,
        dbAdmin.passwordHash,
        dbAdmin.salt,
      );
      if (valid) {
        clearLoginAttempts(clientIp);
        const sessionId = sessionManager.createSession({
          authMethod: 'local',
          userId: `local:${dbAdmin.id}`,
          displayName: dbAdmin.username,
          role: 'owner',
        });

        setCookie(c, SESSION_COOKIE, sessionId, {
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          path: '/',
          maxAge: 8 * 60 * 60,
        });

        return c.json({
          success: true,
          displayName: dbAdmin.username,
          role: 'owner',
        });
      }
    }

    // Fall back to env var credentials
    if (
      config.adminUser !== undefined &&
      config.adminPassword !== undefined &&
      timingSafeEqual(body.username, config.adminUser) &&
      timingSafeEqual(body.password, config.adminPassword)
    ) {
      clearLoginAttempts(clientIp);
      const sessionId = sessionManager.createSession({
        authMethod: 'local',
        userId: 'local:admin',
        displayName: 'Admin',
        role: 'owner',
      });

      setCookie(c, SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 8 * 60 * 60,
      });

      return c.json({
        success: true,
        displayName: 'Admin',
        role: 'owner',
      });
    }

    recordFailedLogin(clientIp);
    return c.json({ error: 'Invalid credentials' }, 401);
  });

  // GET /auth/status
  auth.get('/status', (c) => {
    const user = getUser(c);
    if (!user) {
      return c.json({ authenticated: false });
    }
    return c.json({
      authenticated: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
        authMethod: user.authMethod,
      },
    });
  });

  // DELETE /auth/session
  auth.delete('/session', (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      sessionManager.deleteSession(sessionId);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ success: true });
  });

  return auth;
}
