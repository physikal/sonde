import { describe, expect, it, vi } from 'vitest';
import type { SondeDb } from '../../db/index.js';
import type { ProbeRouter } from '../../integrations/probe-router.js';
import { handleQueryLogs } from './query-logs.js';

function createMockProbeRouter(
  overrides: Partial<ProbeRouter> = {},
): ProbeRouter {
  return {
    execute: vi.fn().mockResolvedValue({
      probe: 'mock.probe',
      status: 'success',
      data: { lines: ['line1', 'line2'], lineCount: 2 },
      durationMs: 50,
    }),
    ...overrides,
  } as unknown as ProbeRouter;
}

function createMockDb(): SondeDb {
  return {
    logAudit: vi.fn(),
    getAgent: vi.fn().mockReturnValue(undefined),
    getAuditEntries: vi.fn().mockReturnValue([
      { id: 1, timestamp: '2026-02-18T10:00:00Z', probe: 'test', status: 'success' },
    ]),
  } as unknown as SondeDb;
}

describe('handleQueryLogs', () => {
  describe('systemd source', () => {
    it('routes to systemd.journal.query via probeRouter', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      const result = await handleQueryLogs(
        { source: 'systemd', agent: 'srv1', params: { unit: 'nginx' } },
        probeRouter,
        db,
      );

      expect(result.isError).toBeUndefined();
      expect(probeRouter.execute).toHaveBeenCalledWith(
        'systemd.journal.query',
        { lines: 50, unit: 'nginx' },
        'srv1',
      );

      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.source).toBe('systemd');
      expect(parsed.agent).toBe('srv1');
      expect(parsed.probe).toBe('systemd.journal.query');
    });

    it('applies default lines=50', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'systemd', agent: 'srv1', params: { unit: 'sshd' } },
        probeRouter,
        db,
      );

      const callParams = (probeRouter.execute as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[1];
      expect(callParams.lines).toBe(50);
    });

    it('allows overriding default lines', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'systemd', agent: 'srv1', params: { unit: 'sshd', lines: 200 } },
        probeRouter,
        db,
      );

      const callParams = (probeRouter.execute as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[1];
      expect(callParams.lines).toBe(200);
    });
  });

  describe('docker source', () => {
    it('routes to docker.logs.tail via probeRouter', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      const result = await handleQueryLogs(
        { source: 'docker', agent: 'srv1', params: { container: 'nginx' } },
        probeRouter,
        db,
      );

      expect(result.isError).toBeUndefined();
      expect(probeRouter.execute).toHaveBeenCalledWith(
        'docker.logs.tail',
        { lines: 100, container: 'nginx' },
        'srv1',
      );

      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.source).toBe('docker');
      expect(parsed.probe).toBe('docker.logs.tail');
    });
  });

  describe('nginx source', () => {
    it('routes to nginx.access.log.tail by default', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      const result = await handleQueryLogs(
        { source: 'nginx', agent: 'srv1' },
        probeRouter,
        db,
      );

      expect(result.isError).toBeUndefined();
      expect(probeRouter.execute).toHaveBeenCalledWith(
        'nginx.access.log.tail',
        { lines: 100 },
        'srv1',
      );

      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.probe).toBe('nginx.access.log.tail');
    });

    it('routes to nginx.error.log.tail when type=error', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      const result = await handleQueryLogs(
        { source: 'nginx', agent: 'srv1', params: { type: 'error' } },
        probeRouter,
        db,
      );

      expect(result.isError).toBeUndefined();
      expect(probeRouter.execute).toHaveBeenCalledWith(
        'nginx.error.log.tail',
        { lines: 100, type: 'error' },
        'srv1',
      );

      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.probe).toBe('nginx.error.log.tail');
    });
  });

  describe('audit source', () => {
    it('calls db.getAuditEntries with correct filters', async () => {
      const probeRouter = createMockProbeRouter();
      const db = createMockDb();

      const result = await handleQueryLogs(
        { source: 'audit', params: { limit: 10 } },
        probeRouter,
        db,
      );

      expect(result.isError).toBeUndefined();
      expect(db.getAuditEntries).toHaveBeenCalledWith({ limit: 10 });

      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.source).toBe('audit');
      expect(parsed.count).toBe(1);
      expect(parsed.entries).toHaveLength(1);
    });

    it('defaults limit to 50 when not specified', async () => {
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'audit' },
        createMockProbeRouter(),
        db,
      );

      expect(db.getAuditEntries).toHaveBeenCalledWith({ limit: 50 });
    });

    it('passes date range filters', async () => {
      const db = createMockDb();

      await handleQueryLogs(
        {
          source: 'audit',
          params: {
            startDate: '2026-02-01',
            endDate: '2026-02-18',
            agentId: 'srv1',
          },
        },
        createMockProbeRouter(),
        db,
      );

      expect(db.getAuditEntries).toHaveBeenCalledWith({
        agentId: 'srv1',
        startDate: '2026-02-01',
        endDate: '2026-02-18',
        limit: 50,
      });
    });

    it('scopes audit results to caller key for scoped keys', async () => {
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'audit' },
        createMockProbeRouter(),
        db,
        { type: 'api_key', keyId: 'agent:srv1', policy: {} },
      );

      expect(db.getAuditEntries).toHaveBeenCalledWith({
        limit: 50,
        apiKeyId: 'agent:srv1',
      });
    });

    it('does not scope audit results for legacy keys', async () => {
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'audit' },
        createMockProbeRouter(),
        db,
        { type: 'api_key', keyId: 'legacy', policy: {} },
      );

      expect(db.getAuditEntries).toHaveBeenCalledWith({ limit: 50 });
    });

    it('does not require agent param', async () => {
      const db = createMockDb();

      const result = await handleQueryLogs(
        { source: 'audit', agent: 'ignored' },
        createMockProbeRouter(),
        db,
      );

      expect(result.isError).toBeUndefined();
      // Agent param should be ignored for audit
      expect(db.getAuditEntries).toHaveBeenCalled();
    });
  });

  describe('error cases', () => {
    it('returns error when agent missing for agent source', async () => {
      const result = await handleQueryLogs(
        { source: 'systemd' },
        createMockProbeRouter(),
        createMockDb(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        'agent is required for systemd logs',
      );
    });

    it('returns error when agent missing for docker source', async () => {
      const result = await handleQueryLogs(
        { source: 'docker' },
        createMockProbeRouter(),
        createMockDb(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        'agent is required for docker logs',
      );
    });

    it('returns error when agent is offline', async () => {
      const db = createMockDb();
      (db.getAgent as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'abc-123',
        name: 'srv1',
        lastSeen: '2026-02-18T09:00:00Z',
      });

      const result = await handleQueryLogs(
        { source: 'docker', agent: 'srv1', params: { container: 'nginx' } },
        createMockProbeRouter(),
        db,
        undefined,
        ['other-agent'],
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('offline');
      expect(result.content[0]?.text).toContain('2026-02-18T09:00:00Z');
    });

    it('returns error when agent is not registered', async () => {
      const result = await handleQueryLogs(
        { source: 'docker', agent: 'ghost', params: { container: 'nginx' } },
        createMockProbeRouter(),
        createMockDb(),
        undefined,
        ['other-agent'],
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not registered');
    });

    it('returns error when agent access denied', async () => {
      const auth = {
        type: 'api_key' as const,
        keyId: 'restricted',
        policy: { allowedAgents: ['allowed-only'] },
      };

      const result = await handleQueryLogs(
        { source: 'docker', agent: 'srv1', params: { container: 'nginx' } },
        createMockProbeRouter(),
        createMockDb(),
        auth,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Access denied');
    });

    it('returns error when probe throws', async () => {
      const probeRouter = createMockProbeRouter({
        execute: vi.fn().mockRejectedValue(
          new Error('Missing required param: unit'),
        ),
      });

      const result = await handleQueryLogs(
        { source: 'systemd', agent: 'srv1' },
        probeRouter,
        createMockDb(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required param');
    });
  });

  describe('audit logging', () => {
    it('logs audit entry for agent source probes', async () => {
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'docker', agent: 'srv1', params: { container: 'app' } },
        createMockProbeRouter(),
        db,
        { type: 'api_key', keyId: 'key-1', policy: {} },
      );

      expect(db.logAudit).toHaveBeenCalledOnce();
      const auditCall = (db.logAudit as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[0];
      expect(auditCall.probe).toBe('docker.logs.tail');
      expect(auditCall.agentId).toBe('srv1');
      expect(auditCall.apiKeyId).toBe('key-1');
    });

    it('does not log audit entry for audit source', async () => {
      const db = createMockDb();

      await handleQueryLogs(
        { source: 'audit' },
        createMockProbeRouter(),
        db,
      );

      expect(db.logAudit).not.toHaveBeenCalled();
    });
  });
});
