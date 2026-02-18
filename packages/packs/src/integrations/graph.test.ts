import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearTokenCache, ensureGraphToken, graphFetch, graphPack } from './graph.js';

const graphConfig: IntegrationConfig = {
  endpoint: 'https://graph.microsoft.com/v1.0',
};

const graphCreds: IntegrationCredentials = {
  packName: 'graph',
  authMethod: 'oauth2',
  credentials: {
    tenantId: 'tenant-123',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  },
};

const handler = (name: string) => {
  const h = graphPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

/** Mock fetch that returns a token response on first call, then Graph API responses */
function mockGraphFetch(graphValue: unknown[] = [], nextLink?: string) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'graph-token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const body: Record<string, unknown> = { value: graphValue };
    if (nextLink) body['@odata.nextLink'] = nextLink;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

/** Mock fetch returning paginated Graph responses (token first, then pages) */
function mockGraphPaginated(pages: unknown[][]) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'graph-token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const pageIdx = callCount - 2;
    const value = pages[pageIdx] ?? [];
    const nextLink =
      pageIdx < pages.length - 1
        ? `https://graph.microsoft.com/v1.0/next?$skip=${(pageIdx + 1) * 100}`
        : undefined;
    const body: Record<string, unknown> = { value };
    if (nextLink) body['@odata.nextLink'] = nextLink;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue(new Response('Error', { status, statusText: 'Error' }));
}

/** Mock fetch: token first, then specific status for API call */
function mockGraphWithApiStatus(apiStatus: number) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'graph-token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(new Response('Error', { status: apiStatus, statusText: 'Forbidden' }));
  });
}

afterEach(() => {
  clearTokenCache();
});

describe('graph pack', () => {
  describe('token acquisition', () => {
    it('acquires token via client_credentials grant', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const token = await ensureGraphToken(graphCreds, fetchFn);
      expect(token).toBe('tok-abc');

      const [url, init] = callArgs(fetchFn, 0);
      expect(url).toContain('login.microsoftonline.com/tenant-123/oauth2/v2.0/token');
      expect((init as { method: string }).method).toBe('POST');
      const body = (init as { body: string }).body;
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
      expect(body).toContain('client_id=client-id');
    });

    it('caches token and reuses on subsequent calls', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'tok-cached', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const t1 = await ensureGraphToken(graphCreds, fetchFn);
      const t2 = await ensureGraphToken(graphCreds, fetchFn);
      expect(t1).toBe('tok-cached');
      expect(t2).toBe('tok-cached');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('throws on token request failure', async () => {
      const fetchFn = mockFetchError(401);
      await expect(ensureGraphToken(graphCreds, fetchFn)).rejects.toThrow(
        'Graph token request failed: 401',
      );
    });
  });

  describe('pagination', () => {
    it('fetches a single page when no nextLink', async () => {
      const fetchFn = mockGraphFetch([{ id: '1' }, { id: '2' }]);
      const results = await graphFetch('/users', graphConfig, graphCreds, fetchFn);
      expect(results).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('follows nextLink across multiple pages', async () => {
      const fetchFn = mockGraphPaginated([[{ id: '1' }], [{ id: '2' }], [{ id: '3' }]]);
      const results = await graphFetch('/users', graphConfig, graphCreds, fetchFn);
      expect(results).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    });

    it('caps at maxPages', async () => {
      const fetchFn = mockGraphPaginated([[{ id: '1' }], [{ id: '2' }], [{ id: '3' }]]);
      const results = await graphFetch('/users', graphConfig, graphCreds, fetchFn, undefined, 2);
      expect(results).toEqual([{ id: '1' }, { id: '2' }]);
    });
  });

  describe('testConnection', () => {
    it('returns true on 200', async () => {
      const fetchFn = mockGraphFetch([{ id: 'org-1' }]);
      const result = await graphPack.testConnection(graphConfig, graphCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/organization');
      expect(url).toContain('$select=id');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockGraphWithApiStatus(403);
      const result = await graphPack.testConnection(graphConfig, graphCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await graphPack.testConnection(graphConfig, graphCreds, fetchFn);
      expect(result).toBe(false);
    });
  });

  describe('user.lookup', () => {
    it('searches users by query with correct filter', async () => {
      const users = [
        { id: 'u1', displayName: 'Alice', mail: 'alice@corp.com', accountEnabled: true },
      ];
      const fetchFn = mockGraphFetch(users);
      const result = (await handler('user.lookup')(
        { q: 'alice@corp.com' },
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { users: unknown[]; count: number };

      expect(result.count).toBe(1);
      expect(result.users).toEqual(users);

      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/users');
      expect(url).toContain('alice%40corp.com');
    });

    it('throws when q is missing', async () => {
      const fetchFn = mockGraphFetch([]);
      await expect(handler('user.lookup')({}, graphConfig, graphCreds, fetchFn)).rejects.toThrow(
        'q parameter is required',
      );
    });
  });

  describe('user.groups', () => {
    it('returns group memberships filtered to groups', async () => {
      const memberOf = [
        {
          '@odata.type': '#microsoft.graph.group',
          id: 'g1',
          displayName: 'SG-Sonde-Users',
        },
        {
          '@odata.type': '#microsoft.graph.directoryRole',
          id: 'r1',
          displayName: 'Global Admin',
        },
      ];
      const fetchFn = mockGraphFetch(memberOf);
      const result = (await handler('user.groups')(
        { id: 'u1' },
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { groups: Array<{ id: string; displayName: string }>; count: number };

      expect(result.count).toBe(1);
      expect(result.groups[0]?.displayName).toBe('SG-Sonde-Users');

      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/users/u1/memberOf');
    });

    it('throws when id is missing', async () => {
      const fetchFn = mockGraphFetch([]);
      await expect(handler('user.groups')({}, graphConfig, graphCreds, fetchFn)).rejects.toThrow(
        'id parameter is required',
      );
    });
  });

  describe('signin.recent', () => {
    it('fetches sign-in logs for a user', async () => {
      const signIns = [
        {
          createdDateTime: '2026-01-01T12:00:00Z',
          appDisplayName: 'Outlook',
          ipAddress: '10.0.0.1',
        },
      ];
      const fetchFn = mockGraphFetch(signIns);
      const result = (await handler('signin.recent')(
        { user: 'alice@corp.com', hours: 12 },
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { signIns: unknown[]; count: number; periodHours: number };

      expect(result.count).toBe(1);
      expect(result.periodHours).toBe(12);

      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/auditLogs/signIns');
      expect(url).toContain('alice%40corp.com');
    });

    it('throws when user is missing', async () => {
      const fetchFn = mockGraphFetch([]);
      await expect(handler('signin.recent')({}, graphConfig, graphCreds, fetchFn)).rejects.toThrow(
        'user parameter is required',
      );
    });
  });

  describe('users.risky', () => {
    it('fetches risky users at specified level', async () => {
      const risky = [{ id: 'u1', userDisplayName: 'Bob', riskLevel: 'high', riskState: 'atRisk' }];
      const fetchFn = mockGraphFetch(risky);
      const result = (await handler('users.risky')(
        { level: 'medium' },
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { riskyUsers: unknown[]; count: number; riskLevel: string };

      expect(result.count).toBe(1);
      expect(result.riskLevel).toBe('medium');

      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/identityProtection/riskyUsers');
      expect(url).toContain('medium');
    });

    it('defaults to high risk level', async () => {
      const fetchFn = mockGraphFetch([]);
      const result = (await handler('users.risky')({}, graphConfig, graphCreds, fetchFn)) as {
        riskLevel: string;
      };

      expect(result.riskLevel).toBe('high');
      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('high');
    });
  });

  describe('intune.devices.compliance', () => {
    it('fetches managed devices with optional user filter', async () => {
      const devices = [
        {
          id: 'd1',
          deviceName: 'LAPTOP-01',
          complianceState: 'compliant',
          userPrincipalName: 'alice@corp.com',
        },
      ];
      const fetchFn = mockGraphFetch(devices);
      const result = (await handler('intune.devices.compliance')(
        { user: 'alice@corp.com' },
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { devices: unknown[]; count: number };

      expect(result.count).toBe(1);
      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/deviceManagement/managedDevices');
      expect(url).toContain('alice%40corp.com');
    });

    it('fetches all devices when no user filter', async () => {
      const fetchFn = mockGraphFetch([]);
      await handler('intune.devices.compliance')({}, graphConfig, graphCreds, fetchFn);
      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('/deviceManagement/managedDevices');
      expect(url).not.toContain('%24filter');
    });
  });

  describe('intune.devices.noncompliant', () => {
    it('fetches only noncompliant devices', async () => {
      const devices = [{ id: 'd2', deviceName: 'LAPTOP-02', complianceState: 'noncompliant' }];
      const fetchFn = mockGraphFetch(devices);
      const result = (await handler('intune.devices.noncompliant')(
        {},
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { devices: unknown[]; count: number };

      expect(result.count).toBe(1);
      const [url] = callArgs(fetchFn, 1);
      expect(url).toContain('noncompliant');
    });
  });

  describe('Intune 403 handling', () => {
    it('throws friendly error on 403 for Intune endpoints', async () => {
      const fetchFn = mockGraphWithApiStatus(403);
      await expect(
        handler('intune.devices.compliance')({}, graphConfig, graphCreds, fetchFn),
      ).rejects.toThrow('Intune license or permissions required');
    });
  });

  describe('intune.apps.status', () => {
    it('fetches apps with install summaries', async () => {
      // Call 1: token, Call 2: mobileApps list, Call 3: token (cached), Call 4: installSummary
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: 'graph-token-123', expires_in: 3600 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (callCount === 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ value: [{ id: 'app1', displayName: 'Teams', publisher: 'MS' }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        // installSummary call
        if (typeof url === 'string' && url.includes('installSummary')) {
          return Promise.resolve(
            new Response(JSON.stringify({ installedDeviceCount: 10, failedDeviceCount: 2 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      const result = (await handler('intune.apps.status')(
        {},
        graphConfig,
        graphCreds,
        fetchFn,
      )) as { apps: Array<Record<string, unknown>>; count: number };

      expect(result.count).toBe(1);
      expect(result.apps[0]?.displayName).toBe('Teams');
      expect(result.apps[0]?.installSummary).toEqual({
        installedDeviceCount: 10,
        failedDeviceCount: 2,
      });
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(graphPack.manifest.name).toBe('graph');
      expect(graphPack.manifest.probes).toHaveLength(7);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = graphPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(graphPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('has correct timeouts (15s for user probes, 30s for sign-in/Intune)', () => {
      const probeMap = new Map(graphPack.manifest.probes.map((p) => [p.name, p.timeout]));
      expect(probeMap.get('user.lookup')).toBe(15000);
      expect(probeMap.get('user.groups')).toBe(15000);
      expect(probeMap.get('users.risky')).toBe(15000);
      expect(probeMap.get('signin.recent')).toBe(30000);
      expect(probeMap.get('intune.devices.compliance')).toBe(30000);
      expect(probeMap.get('intune.devices.noncompliant')).toBe(30000);
      expect(probeMap.get('intune.apps.status')).toBe(30000);
    });

    it('has identity runbook', () => {
      expect(graphPack.manifest.runbook).toEqual({
        category: 'identity',
        probes: ['user.lookup', 'users.risky', 'intune.devices.noncompliant'],
        parallel: true,
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response', async () => {
      const fetchFn = mockGraphWithApiStatus(500);
      await expect(
        handler('user.lookup')({ q: 'test' }, graphConfig, graphCreds, fetchFn),
      ).rejects.toThrow('Graph API returned 500');
    });
  });
});
