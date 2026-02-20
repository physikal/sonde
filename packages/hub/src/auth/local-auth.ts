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
    const body = await c.req.json<{ username?: string; password?: string }>();

    if (!body.username || !body.password) {
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
