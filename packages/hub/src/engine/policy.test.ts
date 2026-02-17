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
    const result = evaluateProbeAccess(auth, 'agent-1', 'system.disk.usage');
    expect(result.allowed).toBe(true);
  });

  it('allowedAgents restricts to listed agents', () => {
    const auth = makeAuth({ policy: { allowedAgents: ['agent-a', 'agent-b'] } });

    expect(evaluateProbeAccess(auth, 'agent-a', 'system.disk.usage').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'agent-c', 'system.disk.usage').allowed).toBe(false);
  });

  it('allowedProbes with exact match', () => {
    const auth = makeAuth({ policy: { allowedProbes: ['system.disk.usage'] } });

    expect(evaluateProbeAccess(auth, 'a', 'system.disk.usage').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'system.memory.usage').allowed).toBe(false);
  });

  it('allowedProbes with glob pattern', () => {
    const auth = makeAuth({ policy: { allowedProbes: ['system.*'] } });

    expect(evaluateProbeAccess(auth, 'a', 'system.disk.usage').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'system.memory.usage').allowed).toBe(true);
    expect(evaluateProbeAccess(auth, 'a', 'docker.containers.list').allowed).toBe(false);
  });

  it('combined constraints: all must pass', () => {
    const auth = makeAuth({
      policy: {
        allowedAgents: ['agent-1'],
        allowedProbes: ['system.*'],
      },
    });

    // All pass
    expect(evaluateProbeAccess(auth, 'agent-1', 'system.disk.usage').allowed).toBe(true);
    // Wrong agent
    expect(evaluateProbeAccess(auth, 'agent-2', 'system.disk.usage').allowed).toBe(false);
    // Wrong probe
    expect(evaluateProbeAccess(auth, 'agent-1', 'docker.info').allowed).toBe(false);
  });

  it('empty policy key has full access', () => {
    const auth: AuthContext = { type: 'api_key', keyId: 'default', policy: {} };

    expect(evaluateProbeAccess(auth, 'any-agent', 'any.probe').allowed).toBe(true);
  });

  it('denied result includes reason', () => {
    const auth = makeAuth({ policy: { allowedAgents: ['agent-1'] } });
    const result = evaluateProbeAccess(auth, 'agent-2', 'p');

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
