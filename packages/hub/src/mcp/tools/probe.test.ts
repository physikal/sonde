import { describe, expect, it, vi } from 'vitest';
import type { SondeDb } from '../../db/index.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';
import { handleProbe } from './probe.js';

function createMockProbeRouter(overrides: Partial<ProbeRouter> = {}): ProbeRouter {
  return {
    execute: vi.fn(),
    ...overrides,
  } as unknown as ProbeRouter;
}

function createMockDb(): SondeDb {
  return {
    logAudit: vi.fn(),
    updateApiKeyLastUsed: vi.fn(),
    getAgent: vi.fn().mockReturnValue(undefined),
  } as unknown as SondeDb;
}

describe('handleProbe', () => {
  it('dispatches probe and returns formatted result', async () => {
    const mockResponse = {
      probe: 'system.disk.usage',
      status: 'success' as const,
      data: { filesystems: [{ filesystem: '/dev/sda1', usePct: 65 }] },
      durationMs: 42,
      metadata: {
        agentVersion: '0.1.0',
        packName: 'system',
        packVersion: '0.1.0',
        capabilityLevel: 'observe' as const,
      },
    };

    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockResolvedValue(mockResponse),
    });
    const db = createMockDb();

    const result = await handleProbe(
      { agent: 'test-agent', probe: 'system.disk.usage' },
      probeRouter,
      db,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');

    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.status).toBe('success');
    expect(parsed.data.filesystems).toHaveLength(1);

    expect(probeRouter.execute).toHaveBeenCalledWith('system.disk.usage', undefined, 'test-agent');
  });

  it('logs audit entry on success', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockResolvedValue({
        probe: 'system.cpu.usage',
        status: 'success',
        data: {},
        durationMs: 10,
        metadata: {
          agentVersion: '0.1.0',
          packName: 'system',
          packVersion: '0.1.0',
          capabilityLevel: 'observe',
        },
      }),
    });
    const db = createMockDb();

    await handleProbe({ agent: 'srv1', probe: 'system.cpu.usage' }, probeRouter, db);

    expect(db.logAudit).toHaveBeenCalledOnce();
    const auditCall = (db.logAudit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(auditCall.probe).toBe('system.cpu.usage');
    expect(auditCall.status).toBe('success');
  });

  it('returns error when agent not found', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockRejectedValue(new Error("Agent 'unknown' not found or offline")),
    });
    const db = createMockDb();

    const result = await handleProbe(
      { agent: 'unknown', probe: 'system.disk.usage' },
      probeRouter,
      db,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
    expect(result.content[0]?.text).toContain('Check that the agent is running');
  });

  it('includes last-seen time when offline agent is registered', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockRejectedValue(new Error("Agent 'srv1' not found or offline")),
    });
    const db = createMockDb();
    (db.getAgent as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'abc-123',
      name: 'srv1',
      status: 'offline',
      lastSeen: '2026-02-18T10:00:00Z',
    });

    const result = await handleProbe(
      { agent: 'srv1', probe: 'system.disk.usage' },
      probeRouter,
      db,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('registered but offline');
    expect(result.content[0]?.text).toContain('2026-02-18T10:00:00Z');
  });

  it('returns error on timeout', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockRejectedValue(new Error('Probe timed out')),
    });
    const db = createMockDb();

    const result = await handleProbe(
      { agent: 'srv1', probe: 'system.disk.usage' },
      probeRouter,
      db,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('timed out');
  });

  it('handles integration probe without agent', async () => {
    const mockResponse = {
      probe: 'cloudflare.zones.list',
      status: 'success' as const,
      data: { zones: [] },
      durationMs: 100,
      metadata: {
        agentVersion: 'hub',
        packName: 'cloudflare',
        packVersion: '0.1.0',
        capabilityLevel: 'observe' as const,
      },
    };

    const probeRouter = createMockProbeRouter({
      execute: vi.fn().mockResolvedValue(mockResponse),
    });
    const db = createMockDb();

    const result = await handleProbe({ probe: 'cloudflare.zones.list' }, probeRouter, db);

    expect(result.isError).toBeUndefined();
    expect(probeRouter.execute).toHaveBeenCalledWith('cloudflare.zones.list', undefined, undefined);

    const auditCall = (db.logAudit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(auditCall.agentId).toBe('cloudflare');
  });

  it('returns error for agent probe without agent', async () => {
    const probeRouter = createMockProbeRouter({
      execute: vi
        .fn()
        .mockRejectedValue(
          new Error("Agent name or ID is required for agent probe 'system.disk.usage'"),
        ),
    });
    const db = createMockDb();

    const result = await handleProbe({ probe: 'system.disk.usage' }, probeRouter, db);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('required');
  });
});
