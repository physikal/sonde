import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requirePermission, requireRole } from './rbac.js';
import {
  ROLE_LEVELS,
  ROLE_PERMISSIONS,
  getRoleLevel,
  hasMinimumRole,
  hasPermission,
  resolveHighestRole,
} from './roles.js';
import type { UserContext } from './sessions.js';

describe('role engine', () => {
  it('role hierarchy: member < admin < owner', () => {
    expect(ROLE_LEVELS.member).toBeLessThan(ROLE_LEVELS.admin);
    expect(ROLE_LEVELS.admin).toBeLessThan(ROLE_LEVELS.owner);
  });

  it('getRoleLevel returns 0 for unknown roles', () => {
    expect(getRoleLevel('unknown')).toBe(0);
  });

  it('hasMinimumRole checks level correctly', () => {
    expect(hasMinimumRole('member', 'member')).toBe(true);
    expect(hasMinimumRole('member', 'admin')).toBe(false);
    expect(hasMinimumRole('admin', 'member')).toBe(true);
    expect(hasMinimumRole('admin', 'admin')).toBe(true);
    expect(hasMinimumRole('admin', 'owner')).toBe(false);
    expect(hasMinimumRole('owner', 'member')).toBe(true);
    expect(hasMinimumRole('owner', 'admin')).toBe(true);
    expect(hasMinimumRole('owner', 'owner')).toBe(true);
  });

  it('permission inheritance: admin has all member permissions', () => {
    for (const perm of ROLE_PERMISSIONS.member) {
      expect(hasPermission('admin', perm)).toBe(true);
    }
  });

  it('permission inheritance: owner has all admin permissions', () => {
    for (const perm of ROLE_PERMISSIONS.admin) {
      expect(hasPermission('owner', perm)).toBe(true);
    }
  });

  it('member lacks admin-only permissions', () => {
    expect(hasPermission('member', 'user:manage')).toBe(false);
    expect(hasPermission('member', 'agent:manage')).toBe(false);
    expect(hasPermission('member', 'sso:manage')).toBe(false);
  });

  it('admin lacks owner-only permissions', () => {
    expect(hasPermission('admin', 'sso:manage')).toBe(false);
    expect(hasPermission('admin', 'settings:manage')).toBe(false);
    expect(hasPermission('admin', 'role:manage')).toBe(false);
  });

  it('owner has owner-specific permissions', () => {
    expect(hasPermission('owner', 'sso:manage')).toBe(true);
    expect(hasPermission('owner', 'settings:manage')).toBe(true);
    expect(hasPermission('owner', 'role:manage')).toBe(true);
  });

  it('resolveHighestRole returns the higher role', () => {
    expect(resolveHighestRole('member', 'admin')).toBe('admin');
    expect(resolveHighestRole('admin', 'member')).toBe('admin');
    expect(resolveHighestRole('admin', 'owner')).toBe('owner');
    expect(resolveHighestRole('owner', 'admin')).toBe('owner');
  });

  it('resolveHighestRole handles undefined inputs', () => {
    expect(resolveHighestRole(undefined, 'admin')).toBe('admin');
    expect(resolveHighestRole('member', undefined)).toBe('member');
    expect(resolveHighestRole(undefined, undefined)).toBeUndefined();
  });
});

describe('RBAC middleware', () => {
  function createApp(
    middleware: ReturnType<typeof requireRole> | ReturnType<typeof requirePermission>,
    user?: UserContext,
  ) {
    type Env = { Variables: { user: UserContext } };
    const app = new Hono<Env>();

    // Inject user context
    if (user) {
      app.use('*', async (c, next) => {
        c.set('user', user);
        await next();
      });
    }

    app.use('/protected/*', middleware);
    app.get('/protected/resource', (c) => c.json({ ok: true }));
    return app;
  }

  it('requireRole returns 401 when no user', async () => {
    const app = createApp(requireRole('admin'));
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(401);
  });

  it('requireRole returns 403 when insufficient role', async () => {
    const user: UserContext = {
      id: 'u1',
      displayName: 'Test',
      role: 'member',
      authMethod: 'local',
    };
    const app = createApp(requireRole('admin'), user);
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(403);
  });

  it('requireRole returns 200 when role is sufficient', async () => {
    const user: UserContext = {
      id: 'u1',
      displayName: 'Test',
      role: 'admin',
      authMethod: 'local',
    };
    const app = createApp(requireRole('admin'), user);
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(200);
  });

  it('requireRole returns 200 when role exceeds minimum', async () => {
    const user: UserContext = {
      id: 'u1',
      displayName: 'Test',
      role: 'owner',
      authMethod: 'local',
    };
    const app = createApp(requireRole('admin'), user);
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(200);
  });

  it('requirePermission returns 401 when no user', async () => {
    const app = createApp(requirePermission('sso:manage'));
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(401);
  });

  it('requirePermission returns 403 when permission missing', async () => {
    const user: UserContext = {
      id: 'u1',
      displayName: 'Test',
      role: 'admin',
      authMethod: 'local',
    };
    const app = createApp(requirePermission('sso:manage'), user);
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(403);
  });

  it('requirePermission returns 200 when permission exists', async () => {
    const user: UserContext = {
      id: 'u1',
      displayName: 'Test',
      role: 'owner',
      authMethod: 'local',
    };
    const app = createApp(requirePermission('sso:manage'), user);
    const res = await app.request('/protected/resource');
    expect(res.status).toBe(200);
  });
});
