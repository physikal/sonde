import { describe, expect, it } from 'vitest';
import { type AuthContext, evaluateAgentAccess, evaluateProbeAccess } from './policy.js';

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    type: 'api_key',
    keyId: 'test-key',
    policy: {},
    ...overrides,
  };
}

describe('evaluateProbeAccess', () => {
  it('empty policy allows all', () => {
    const auth = makeAuth();
    const result = evaluateProbeAccess(auth, 'agent-1', 'system.disk.usage', 'observe');
    expect(result.allowed).toBe(true);
  });

  it('allowedAgents restricts to listed agents', () => {
    const auth = makeAuth({ policy: { allowedAgents: ['agent-a', 'agent-b'] } });

    expect(evaluateProbeAccess(auth, 'agent-a', 'system.disk.usage', 'observe').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'agent-c', 'system.disk.usage', 'observe').allowed).toBe(
      false,
    );
  });

  it('allowedProbes with exact match', () => {
    const auth = makeAuth({ policy: { allowedProbes: ['system.disk.usage'] } });

    expect(evaluateProbeAccess(auth, 'a', 'system.disk.usage', 'observe').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'system.memory.usage', 'observe').allowed).toBe(false);
  });

  it('allowedProbes with glob pattern', () => {
    const auth = makeAuth({ policy: { allowedProbes: ['system.*'] } });

    expect(evaluateProbeAccess(auth, 'a', 'system.disk.usage', 'observe').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'system.memory.usage', 'observe').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'docker.containers.list', 'observe').allowed).toBe(false);
  });

  it('maxCapabilityLevel observe blocks interact and manage', () => {
    const auth = makeAuth({ policy: { maxCapabilityLevel: 'observe' } });

    expect(evaluateProbeAccess(auth, 'a', 'p', 'observe').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'p', 'interact').allowed).toBe(false);
    expect(evaluateProbeAccess(auth, 'a', 'p', 'manage').allowed).toBe(false);
  });

  it('maxCapabilityLevel interact allows observe and interact', () => {
    const auth = makeAuth({ policy: { maxCapabilityLevel: 'interact' } });

    expect(evaluateProbeAccess(auth, 'a', 'p', 'observe').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'p', 'interact').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'p', 'manage').allowed).toBe(false);
  });

  it('combined constraints: all must pass', () => {
    const auth = makeAuth({
      policy: {
        allowedAgents: ['agent-1'],
        allowedProbes: ['system.*'],
        maxCapabilityLevel: 'observe',
      },
    });

    // All pass
    expect(evaluateProbeAccess(auth, 'agent-1', 'system.disk.usage', 'observe').allowed).toBe(true);
    // Wrong agent
    expect(evaluateProbeAccess(auth, 'agent-2', 'system.disk.usage', 'observe').allowed).toBe(
      false,
    );
    // Wrong probe
    expect(evaluateProbeAccess(auth, 'agent-1', 'docker.info', 'observe').allowed).toBe(false);
    // Wrong capability
    expect(evaluateProbeAccess(auth, 'agent-1', 'system.disk.usage', 'manage').allowed).toBe(false);
  });

  it('legacy key (empty policy) has full access', () => {
    const auth: AuthContext = { type: 'api_key', keyId: 'legacy', policy: {} };

    expect(evaluateProbeAccess(auth, 'any-agent', 'any.probe', 'manage').allowed).toBe(true);
  });

  it('denied result includes reason', () => {
    const auth = makeAuth({ policy: { allowedAgents: ['agent-1'] } });
    const result = evaluateProbeAccess(auth, 'agent-2', 'p', 'observe');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('agent-2');
  });
});

describe('evaluateAgentAccess', () => {
  it('empty policy allows all agents', () => {
    const auth = makeAuth();
    expect(evaluateAgentAccess(auth, 'any-agent').allowed).toBe(true);
  });

  it('restricts to allowed agents', () => {
    const auth = makeAuth({ policy: { allowedAgents: ['agent-1'] } });

    expect(evaluateAgentAccess(auth, 'agent-1').allowed).toBe(true);
    expect(evaluateAgentAccess(auth, 'agent-2').allowed).toBe(false);
  });
});
