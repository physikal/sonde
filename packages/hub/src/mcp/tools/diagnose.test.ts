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
    expect(parsed.meta.target).toBe('test-agent');
    expect(parsed.meta.source).toBe('agent');
    expect(parsed.meta.category).toBe('docker');
    expect(parsed.meta.probesRun).toBe(1);
    expect(parsed.probes['docker.containers.list'].status).toBe('success');
  });

  it('logs audit entries for each probe result', async () => {
    const db = createMockDb();
    const engine = createMockEngine();

    await handleDiagnose(
      { agent: 'srv1', category: 'docker' },
      createMockProbeRouter(),
      engine,
      db,
    );

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

  it('returns diagnostic runbook output with meta/probes/findings', async () => {
    const engine = createMockEngine({
      getDiagnosticRunbook: vi.fn().mockReturnValue({ category: 'nutanix' }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'nutanix',
        findings: [
          {
            severity: 'warning',
            title: 'High CPU',
            detail: 'CPU at 92%',
            relatedProbes: ['nutanix.vm.stats'],
          },
        ],
        probeResults: {
          'nutanix.vm.stats': {
            probe: 'nutanix.vm.stats',
            status: 'success',
            data: { cpu: 92 },
            durationMs: 200,
          },
        },
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          findingsCount: { info: 0, warning: 1, critical: 0 },
          durationMs: 250,
          summaryText: 'Found 1 warning',
        },
        truncated: false,
        timedOut: false,
      }),
    });

    const result = await handleDiagnose(
      { agent: 'nutanix-cluster', category: 'nutanix' },
      createMockProbeRouter(),
      engine,
      createMockDb(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    // Diagnostic runbooks are integration probes — agent param is ignored
    expect(parsed.meta.target).toBe('nutanix');
    expect(parsed.meta.source).toBe('integration');
    expect(parsed.meta.probesRun).toBe(1);
    expect(parsed.meta.truncated).toBe(false);
    expect(parsed.meta.timedOut).toBe(false);
    expect(parsed.probes['nutanix.vm.stats'].data).toEqual({ cpu: 92 });
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe('warning');
  });

  it('passes truncated and timedOut flags from diagnostic runbook to meta', async () => {
    const engine = createMockEngine({
      getDiagnosticRunbook: vi.fn().mockReturnValue({ category: 'slow' }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'slow',
        findings: [],
        probeResults: {
          'slow.check': {
            probe: 'slow.check',
            status: 'success',
            data: { _truncated: true, _originalSize: 20000, _maxSize: 10240 },
            durationMs: 100,
          },
        },
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 45000,
          summaryText: 'Runbook timed out',
        },
        truncated: true,
        timedOut: true,
      }),
    });

    const result = await handleDiagnose(
      { category: 'slow' },
      createMockProbeRouter(),
      engine,
      createMockDb(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.truncated).toBe(true);
    expect(parsed.meta.timedOut).toBe(true);
  });

  it('returns simple runbook output with meta/probes (no findings)', async () => {
    const engine = createMockEngine();

    const result = await handleDiagnose(
      { agent: 'srv1', category: 'docker' },
      createMockProbeRouter(),
      engine,
      createMockDb(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta).toBeDefined();
    expect(parsed.probes).toBeDefined();
    expect(parsed.findings).toBeUndefined();
    expect(parsed.meta.probesRun).toBe(1);
  });

  it('works without agent for simple runbooks', async () => {
    const probeRouter = createMockProbeRouter();
    const db = createMockDb();
    const engine = createMockEngine();

    const result = await handleDiagnose({ category: 'docker' }, probeRouter, engine, db);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.meta.target).toBe('docker');
    expect(parsed.meta.source).toBe('agent');

    expect(engine.execute).toHaveBeenCalledWith('docker', undefined, probeRouter);
  });

  it('ignores agent param for diagnostic runbooks (integration probes)', async () => {
    const engine = createMockEngine({
      getDiagnosticRunbook: vi.fn().mockReturnValue({ category: 'proxmox-cluster' }),
      executeDiagnostic: vi.fn().mockResolvedValue({
        category: 'proxmox-cluster',
        findings: [],
        probeResults: {},
        summary: {
          probesRun: 1,
          probesSucceeded: 1,
          probesFailed: 0,
          findingsCount: { info: 0, warning: 0, critical: 0 },
          durationMs: 100,
          summaryText: '',
        },
        truncated: false,
        timedOut: false,
      }),
    });

    const result = await handleDiagnose(
      { agent: 'gmtek01', category: 'proxmox-cluster' },
      createMockProbeRouter(),
      engine,
      createMockDb(),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    // Agent param is ignored — target is the category, source is integration
    expect(parsed.meta.target).toBe('proxmox-cluster');
    expect(parsed.meta.source).toBe('integration');
  });
});
