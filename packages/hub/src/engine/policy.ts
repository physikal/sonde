import type { CapabilityLevel } from '@sonde/shared';

export interface ApiKeyPolicy {
  allowedAgents?: string[];
  allowedProbes?: string[];
  maxCapabilityLevel?: CapabilityLevel;
  agentCapabilities?: Record<string, CapabilityLevel>;
  allowedClients?: string[];
}

export interface AuthContext {
  type: 'api_key' | 'oauth';
  keyId: string;
  policy: ApiKeyPolicy;
  scopes?: string[];
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

/** Capability level ordering: observe < interact < manage */
const CAPABILITY_ORDER: Record<string, number> = {
  observe: 0,
  interact: 1,
  manage: 2,
};

/**
 * Simple glob matching: `*` matches any sequence of characters including dots.
 * `system.*` matches `system.disk.usage`, `system.memory.usage`, etc.
 */
function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function evaluateProbeAccess(
  auth: AuthContext,
  agentNameOrId: string,
  probe: string,
  capabilityLevel: CapabilityLevel,
): PolicyDecision {
  const { policy } = auth;

  // Check agent restriction
  if (policy.allowedAgents && policy.allowedAgents.length > 0) {
    if (!policy.allowedAgents.includes(agentNameOrId)) {
      return { allowed: false, reason: `Agent "${agentNameOrId}" not in allowed agents` };
    }
  }

  // Check probe restriction
  if (policy.allowedProbes && policy.allowedProbes.length > 0) {
    const matches = policy.allowedProbes.some((pattern) => globMatch(pattern, probe));
    if (!matches) {
      return { allowed: false, reason: `Probe "${probe}" not in allowed probes` };
    }
  }

  // Check capability level (global ceiling)
  if (policy.maxCapabilityLevel) {
    const maxLevel = CAPABILITY_ORDER[policy.maxCapabilityLevel] ?? 0;
    const requestedLevel = CAPABILITY_ORDER[capabilityLevel] ?? 0;
    if (requestedLevel > maxLevel) {
      return {
        allowed: false,
        reason: `Capability level "${capabilityLevel}" exceeds max "${policy.maxCapabilityLevel}"`,
      };
    }
  }

  // Check per-agent capability ceiling (further restricts beyond global cap)
  if (policy.agentCapabilities) {
    const agentCap = policy.agentCapabilities[agentNameOrId];
    if (agentCap) {
      const agentMaxLevel = CAPABILITY_ORDER[agentCap] ?? 0;
      const requestedLevel = CAPABILITY_ORDER[capabilityLevel] ?? 0;
      if (requestedLevel > agentMaxLevel) {
        return {
          allowed: false,
          reason: `Capability level "${capabilityLevel}" exceeds agent "${agentNameOrId}" cap "${agentCap}"`,
        };
      }
    }
  }

  return { allowed: true };
}

export function evaluateAgentAccess(auth: AuthContext, agentNameOrId: string): PolicyDecision {
  const { policy } = auth;

  if (policy.allowedAgents && policy.allowedAgents.length > 0) {
    if (!policy.allowedAgents.includes(agentNameOrId)) {
      return { allowed: false, reason: `Agent "${agentNameOrId}" not in allowed agents` };
    }
  }

  return { allowed: true };
}
