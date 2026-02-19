/**
 * RBAC middleware factories for Hono.
 * Reads UserContext from c.get('user') set by session/apikey middleware.
 */
import type { MiddlewareHandler } from 'hono';
import { type RoleId, hasMinimumRole, hasPermission } from './roles.js';
import type { UserContext } from './sessions.js';

/** Require the user to have at least the given role. */
export function requireRole(minimumRole: RoleId): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as UserContext | undefined;
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!hasMinimumRole(user.role, minimumRole)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return next();
  };
}

/** Require the user to have a specific permission. */
export function requirePermission(permission: string): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as UserContext | undefined;
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!hasPermission(user.role, permission)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return next();
  };
}
