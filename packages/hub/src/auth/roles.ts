/**
 * Role engine — pure functions for role hierarchy and permission checks.
 * No DB dependency. Used by RBAC middleware and auth callbacks.
 */

export type RoleId = 'member' | 'admin' | 'owner';

export const ROLE_LEVELS: Record<RoleId, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export const ROLE_PERMISSIONS: Record<RoleId, ReadonlySet<string>> = {
  member: new Set(['probe:execute', 'agent:read', 'integration:read']),
  admin: new Set([
    // inherited from member
    'probe:execute',
    'agent:read',
    'integration:read',
    // admin-specific
    'agent:manage',
    'integration:manage',
    'user:read',
    'user:manage',
    'audit:read',
    'policy:manage',
    'enrollment:manage',
    'apikey:manage',
  ]),
  owner: new Set([
    // inherited from admin
    'probe:execute',
    'agent:read',
    'integration:read',
    'agent:manage',
    'integration:manage',
    'user:read',
    'user:manage',
    'audit:read',
    'policy:manage',
    'enrollment:manage',
    'apikey:manage',
    // owner-specific
    'sso:manage',
    'settings:manage',
    'role:manage',
  ]),
};

/** Get numeric level for a role. Unknown roles get level 0 (no access). */
export function getRoleLevel(role: string): number {
  return ROLE_LEVELS[role as RoleId] ?? 0;
}

/** Check if userRole meets or exceeds the minimumRole. */
export function hasMinimumRole(userRole: string, minimumRole: RoleId): boolean {
  return getRoleLevel(userRole) >= ROLE_LEVELS[minimumRole];
}

/** Check if a role has a specific permission. */
export function hasPermission(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role as RoleId];
  if (!perms) return false;
  return perms.has(permission);
}

/** Return the role with the higher level. If equal, returns role1. */
export function resolveHighestRole(
  role1: string | undefined,
  role2: string | undefined,
): string | undefined {
  if (!role1 && !role2) return undefined;
  if (!role1) return role2;
  if (!role2) return role1;
  return getRoleLevel(role1) >= getRoleLevel(role2) ? role1 : role2;
}
