import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { SessionManager, UserContext } from './sessions.js';

export const SESSION_COOKIE = 'sonde_session';

/**
 * Session middleware for Hono.
 *
 * Reads the session cookie, validates it, and attaches user context.
 * If no valid session is found, falls through (does NOT reject).
 * Other auth methods (API key, OAuth) can catch the request downstream.
 */
export function sessionMiddleware(sessionManager: SessionManager): MiddlewareHandler {
  return async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      const user = sessionManager.getSession(sessionId);
      if (user) {
        c.set('user', user);
        // Sliding window: extend session on each valid request
        sessionManager.touchSession(sessionId);
      }
    }
    await next();
  };
}

/** Helper to read user context from Hono request, or null if not authenticated */
export function getUser(c: Context): UserContext | null {
  return (c.get('user') as UserContext) ?? null;
}
