/**
 * Access group filtering — scopes agent/integration visibility per user.
 * Default-open: users with no access group assignments see everything.
 */
import type { SondeDb } from '../db/index.js';

/**
 * Simple glob matching: `*` matches any sequence of characters.
 * Same pattern as engine/policy.ts.
 */
function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

/**
 * Get all agent patterns the user is scoped to.
 * Returns null if user has no access group assignments (unrestricted).
 */
export function getVisibleAgentPatterns(db: SondeDb, userId: string): string[] | null {
  const groups = db.getAccessGroupsForUser(userId);
  if (groups.length === 0) return null; // unrestricted

  const patterns: string[] = [];
  for (const group of groups) {
    const agents = db.getAccessGroupAgents(group.id);
    patterns.push(...agents.map((a) => a.agentPattern));
  }
  return patterns;
}

/**
 * Get all integration IDs the user is scoped to.
 * Returns null if user has no access group assignments (unrestricted).
 */
export function getVisibleIntegrationIds(db: SondeDb, userId: string): string[] | null {
  const groups = db.getAccessGroupsForUser(userId);
  if (groups.length === 0) return null; // unrestricted

  const ids: string[] = [];
  for (const group of groups) {
    const integrations = db.getAccessGroupIntegrations(group.id);
    ids.push(...integrations.map((i) => i.integrationId));
  }
  return [...new Set(ids)];
}

/** Check if a specific agent is visible to the user. */
export function isAgentVisible(db: SondeDb, userId: string, agentName: string): boolean {
  const patterns = getVisibleAgentPatterns(db, userId);
  if (patterns === null) return true; // unrestricted
  return patterns.some((pattern) => globMatch(pattern, agentName));
}

/** Check if a specific integration is visible to the user. */
export function isIntegrationVisible(db: SondeDb, userId: string, integrationId: string): boolean {
  const ids = getVisibleIntegrationIds(db, userId);
  if (ids === null) return true; // unrestricted
  return ids.includes(integrationId);
}

/** Filter a list of agents by access group visibility. */
export function filterAgentsByAccess<T extends { name: string }>(
  db: SondeDb,
  userId: string,
  agents: T[],
): T[] {
  const patterns = getVisibleAgentPatterns(db, userId);
  if (patterns === null) return agents; // unrestricted
  return agents.filter((agent) => patterns.some((pattern) => globMatch(pattern, agent.name)));
}

/** Filter a list of integrations by access group visibility. */
export function filterIntegrationsByAccess<T extends { id: string }>(
  db: SondeDb,
  userId: string,
  integrations: T[],
): T[] {
  const ids = getVisibleIntegrationIds(db, userId);
  if (ids === null) return integrations; // unrestricted
  return integrations.filter((i) => ids.includes(i.id));
}
