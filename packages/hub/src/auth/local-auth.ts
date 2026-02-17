import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, getUser } from './session-middleware.js';
import type { SessionManager } from './sessions.js';

interface LocalAuthConfig {
  adminUser?: string;
  adminPassword?: string;
}

export function createAuthRoutes(sessionManager: SessionManager, config: LocalAuthConfig): Hono {
  const auth = new Hono();

  // POST /auth/local/login
  auth.post('/local/login', async (c) => {
    const body = await c.req.json<{ username?: string; password?: string }>();

    if (
      config.adminUser === undefined ||
      config.adminPassword === undefined ||
      body.username !== config.adminUser ||
      body.password !== config.adminPassword
    ) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

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
      maxAge: 8 * 60 * 60, // 8 hours in seconds
    });

    return c.json({
      success: true,
      displayName: 'Admin',
      role: 'owner',
    });
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
