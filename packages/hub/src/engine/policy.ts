export interface ApiKeyPolicy {
  allowedAgents?: string[];
  allowedProbes?: string[];
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
