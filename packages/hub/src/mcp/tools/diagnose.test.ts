import { describe, expect, it, vi } from 'vitest';
import type { SondeDb } from '../../db/index.js';
import type { RunbookEngine } from '../../engine/runbooks.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';
import { handleDiagnose } from './diagnose.js';

function createMockProbeRouter(): ProbeRouter {
  return {
    execute: vi.fn(),
  } as unknown as ProbeRouter;
}

function createMockDb(): SondeDb {
  return { logAudit: vi.fn() } as unknown as SondeDb;
}

function createMockEngine(overrides: Partial<RunbookEngine> = {}): RunbookEngine {
  return {
    loadFromManifests: vi.fn(),
    getRunbook: vi.fn().mockReturnValue({ packName: 'docker', definition: {} }),
    getDiagnosticRunbook: vi.fn().mockReturnValue(undefined),
    getCategories: vi.fn().mockReturnValue(['docker', 'system']),
    execute: vi.fn().mockResolvedValue({
      category: 'docker',
      findings: {
        'docker.containers.list': {
          probe: 'docker.containers.list',
          status: 'success',
          data: {},
          durationMs: 10,
        },
      },
      summary: { probesRun: 1, probesSucceeded: 1, probesFailed: 0, durationMs: 15 },
    }),
    ...overrides,
  } as unknown as RunbookEngine;
}

describe('handleDiagnose', () => {
  it('executes runbook and returns consolidated output', async () => {
    const probeRouter = createMockProbeRouter();
    const db = createMockDb();
    const engine = createMockEngine();

    const result = await handleDiagnose(
      { agent: 'test-agent', category: 'docker' },
      probeRouter,
      engine,
      db,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agent).toBe('test-agent');
    expect(parsed.category).toBe('docker');
    expect(parsed.summary.probesRun).toBe(1);
    expect(parsed.findings['docker.containers.list'].status).toBe('success');
  });

  it('logs audit entries for each probe result', async () => {
    const db = createMockDb();
    const engine = createMockEngine();

    await handleDiagnose({ agent: 'srv1', category: 'docker' }, createMockProbeRouter(), engine, db);

    expect(db.logAudit).toHaveBeenCalledOnce();
    const auditCall = (db.logAudit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(auditCall.probe).toBe('docker.containers.list');
    expect(auditCall.status).toBe('success');
  });

  it('returns error when category has no runbook', async () => {
    const engine = createMockEngine({
      getRunbook: vi.fn().mockReturnValue(undefined),
      getCategories: vi.fn().mockReturnValue(['docker']),
    });

    const result = await handleDiagnose(
      { agent: 'srv1', category: 'unknown' },
      createMockProbeRouter(),
      engine,
      createMockDb(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No runbook for category "unknown"');
    expect(result.content[0]?.text).toContain('docker');
  });

  it('returns error when engine throws', async () => {
    const engine = createMockEngine({
      execute: vi.fn().mockRejectedValue(new Error("Agent 'ghost' not found or offline")),
    });

    const result = await handleDiagnose(
      { agent: 'ghost', category: 'docker' },
      createMockProbeRouter(),
      engine,
      createMockDb(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });

  it('works without agent for integration probes', async () => {
    const probeRouter = createMockProbeRouter();
    const db = createMockDb();
    const engine = createMockEngine();

    const result = await handleDiagnose(
      { category: 'docker' },
      probeRouter,
      engine,
      db,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.agent).toBe('docker');

    expect(engine.execute).toHaveBeenCalledWith('docker', undefined, probeRouter);
  });
});
