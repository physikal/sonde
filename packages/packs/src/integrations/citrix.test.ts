import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthHeaders,
  buildODataUrl,
  citrixPack,
  clearTokenCache,
  ensureAccessToken,
  fetchAllPages,
} from './citrix.js';

const onPremConfig: IntegrationConfig = {
  endpoint: 'https://director.company.com',
};

const cloudConfig: IntegrationConfig = {
  endpoint: 'https://api.cloud.com/monitorodata',
};

const onPremCreds: IntegrationCredentials = {
  packName: 'citrix',
  authMethod: 'api_key',
  credentials: { domain: 'CORP', username: 'admin', password: 'secret' },
};

const cloudCreds: IntegrationCredentials = {
  packName: 'citrix',
  authMethod: 'oauth2',
  credentials: {
    customerId: 'cust123',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  },
};

const handler = (name: string) => {
  const h = citrixPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

/** Create a mock fetch returning OData-shaped response */
function mockOData(value: unknown[] = [], nextLink?: string) {
  const body: Record<string, unknown> = { value };
  if (nextLink) body['@odata.nextLink'] = nextLink;
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Mock fetch that returns a token response then OData responses */
function mockCloudFetch(odataValue: unknown[] = []) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // Token response
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'cloud-token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    // OData response
    return Promise.resolve(
      new Response(JSON.stringify({ value: odataValue }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

/** Mock fetch returning paginated OData responses */
function mockPaginated(pages: unknown[][], baseUrl: string) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const pageIdx = callCount++;
    const value = pages[pageIdx] ?? [];
    const nextLink =
      pageIdx < pages.length - 1 ? `${baseUrl}?$skip=${(pageIdx + 1) * 100}` : undefined;
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

afterEach(() => {
  clearTokenCache();
});

describe('citrix pack', () => {
  describe('auth headers', () => {
    it('uses Basic auth with DOMAIN\\user for on-prem', () => {
      const headers = buildAuthHeaders(onPremCreds);
      const expected = `Basic ${Buffer.from('CORP\\admin:secret').toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
    });

    it('uses Basic auth without domain prefix when domain is empty', () => {
      const creds: IntegrationCredentials = {
        packName: 'citrix',
        authMethod: 'api_key',
        credentials: { username: 'admin', password: 'secret' },
      };
      const headers = buildAuthHeaders(creds);
      const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
    });

    it('uses CWSAuth bearer + Citrix-CustomerId for cloud', () => {
      const headers = buildAuthHeaders(cloudCreds, 'my-cloud-token');
      expect(headers.Authorization).toBe('CWSAuth bearer=my-cloud-token');
      expect(headers['Citrix-CustomerId']).toBe('cust123');
    });
  });

  describe('URL building', () => {
    it('builds on-prem OData URL with Director path', () => {
      const url = buildODataUrl('https://director.company.com', 'api_key', 'Sessions');
      expect(url).toBe('https://director.company.com/Citrix/Monitor/OData/v4/Data/Sessions');
    });

    it('builds cloud URL directly from endpoint', () => {
      const url = buildODataUrl('https://api.cloud.com/monitorodata', 'oauth2', 'Machines');
      expect(url).toBe('https://api.cloud.com/monitorodata/Machines');
    });

    it('strips trailing slash from endpoint', () => {
      const url = buildODataUrl('https://director.company.com/', 'api_key', 'Sessions');
      expect(url).toBe('https://director.company.com/Citrix/Monitor/OData/v4/Data/Sessions');
    });
  });

  describe('OData pagination', () => {
    it('fetches a single page when no nextLink', async () => {
      const fetchFn = mockOData([{ Id: 1 }, { Id: 2 }]);
      const results = await fetchAllPages('https://test.com/odata', {}, fetchFn);
      expect(results).toEqual([{ Id: 1 }, { Id: 2 }]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('follows nextLink across multiple pages', async () => {
      const fetchFn = mockPaginated(
        [[{ Id: 1 }], [{ Id: 2 }], [{ Id: 3 }]],
        'https://test.com/odata',
      );
      const results = await fetchAllPages('https://test.com/odata', {}, fetchFn);
      expect(results).toEqual([{ Id: 1 }, { Id: 2 }, { Id: 3 }]);
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('caps at maxPages', async () => {
      const fetchFn = mockPaginated(
        [[{ Id: 1 }], [{ Id: 2 }], [{ Id: 3 }]],
        'https://test.com/odata',
      );
      const results = await fetchAllPages('https://test.com/odata', {}, fetchFn, 2);
      expect(results).toEqual([{ Id: 1 }, { Id: 2 }]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(500);
      await expect(fetchAllPages('https://test.com/odata', {}, fetchFn)).rejects.toThrow(
        'Citrix OData API returned 500',
      );
    });
  });

  describe('cloud token acquisition', () => {
    it('acquires token via client_credentials grant', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const token = await ensureAccessToken(cloudCreds, fetchFn);
      expect(token).toBe('tok-123');

      const [url, init] = callArgs(fetchFn, 0);
      expect(url).toContain('cctrustoauth2/cust123/tokens/clients');
      expect((init as { method: string }).method).toBe('POST');
    });

    it('caches token and reuses on subsequent calls', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'tok-456', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const t1 = await ensureAccessToken(cloudCreds, fetchFn);
      const t2 = await ensureAccessToken(cloudCreds, fetchFn);
      expect(t1).toBe('tok-456');
      expect(t2).toBe('tok-456');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('throws on token request failure', async () => {
      const fetchFn = mockFetchError(401);
      await expect(ensureAccessToken(cloudCreds, fetchFn)).rejects.toThrow(
        'Citrix Cloud token request failed: 401',
      );
    });
  });

  describe('testConnection', () => {
    it('returns true on 200 (on-prem)', async () => {
      const fetchFn = mockOData([]);
      const result = await citrixPack.testConnection(onPremConfig, onPremCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/Citrix/Monitor/OData/v4/Data/Machines');
      expect(url).toContain('%24top=1');
    });

    it('returns true on 200 (cloud)', async () => {
      const fetchFn = mockCloudFetch([]);
      const result = await citrixPack.testConnection(cloudConfig, cloudCreds, fetchFn);
      expect(result).toBe(true);
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(403);
      const result = await citrixPack.testConnection(onPremConfig, onPremCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await citrixPack.testConnection(onPremConfig, onPremCreds, fetchFn);
      expect(result).toBe(false);
    });
  });

  describe('sessions.active', () => {
    it('returns sessions grouped by delivery group', async () => {
      const sessions = [
        {
          ConnectionState: 5,
          EndDate: null,
          DesktopGroup: { Name: 'DG-Finance' },
          Machine: { Name: 'VDA01' },
        },
        {
          ConnectionState: 3,
          EndDate: null,
          DesktopGroup: { Name: 'DG-Finance' },
          Machine: { Name: 'VDA02' },
        },
        {
          ConnectionState: 5,
          EndDate: null,
          DesktopGroup: { Name: 'DG-HR' },
          Machine: { Name: 'VDA03' },
        },
      ];
      const fetchFn = mockOData(sessions);
      const result = (await handler('sessions.active')({}, onPremConfig, onPremCreds, fetchFn)) as {
        totalSessions: number;
        byDeliveryGroup: Array<{ deliveryGroup: string; active: number; disconnected: number }>;
      };

      expect(result.totalSessions).toBe(3);
      expect(result.byDeliveryGroup).toHaveLength(2);

      const finance = result.byDeliveryGroup.find((g) => g.deliveryGroup === 'DG-Finance');
      expect(finance?.active).toBe(1);
      expect(finance?.disconnected).toBe(1);
    });
  });

  describe('sessions.failures', () => {
    it('counts failures by category and collects affected users/machines', async () => {
      const connections = [
        {
          FailureDate: '2025-01-01T00:00:00Z',
          FailureCategory: 1,
          UserName: 'alice',
          MachineName: 'VDA01',
          LogOnStartDate: '2025-01-01',
        },
        {
          FailureDate: '2025-01-01T00:00:00Z',
          FailureCategory: 1,
          UserName: 'bob',
          MachineName: 'VDA01',
          LogOnStartDate: '2025-01-01',
        },
        {
          FailureDate: '2025-01-01T00:00:00Z',
          FailureCategory: 3,
          UserName: 'alice',
          MachineName: 'VDA02',
          LogOnStartDate: '2025-01-01',
        },
      ];
      const fetchFn = mockOData(connections);
      const result = (await handler('sessions.failures')(
        { hours: 24 },
        onPremConfig,
        onPremCreds,
        fetchFn,
      )) as {
        totalFailures: number;
        byCategory: Record<string, number>;
        affectedUsers: string[];
        affectedMachines: string[];
      };

      expect(result.totalFailures).toBe(3);
      expect(result.byCategory.ClientConnectionFailure).toBe(2);
      expect(result.byCategory.CommunicationError).toBe(1);
      expect(result.affectedUsers).toContain('alice');
      expect(result.affectedUsers).toContain('bob');
      expect(result.affectedMachines).toContain('VDA01');
      expect(result.affectedMachines).toContain('VDA02');
    });
  });

  describe('logon.performance', () => {
    it('averages logon durations per delivery group', async () => {
      const sessions = [
        {
          LogOnDuration: 5000,
          StartDate: '2025-01-01',
          DesktopGroup: { Name: 'DG1' },
          BrokeringDuration: 200,
          VMStartStartDate: null,
        },
        {
          LogOnDuration: 3000,
          StartDate: '2025-01-01',
          DesktopGroup: { Name: 'DG1' },
          BrokeringDuration: 100,
          VMStartStartDate: null,
        },
      ];
      const fetchFn = mockOData(sessions);
      const result = (await handler('logon.performance')(
        {},
        onPremConfig,
        onPremCreds,
        fetchFn,
      )) as {
        totalSessions: number;
        byDeliveryGroup: Array<{ deliveryGroup: string; avgLogonDurationMs: number }>;
      };

      expect(result.totalSessions).toBe(2);
      const dg1 = result.byDeliveryGroup.find((g) => g.deliveryGroup === 'DG1');
      expect(dg1?.avgLogonDurationMs).toBe(4000);
    });
  });

  describe('machines.status', () => {
    it('maps integer enums to human-readable names', async () => {
      const machines = [
        {
          DnsName: 'vda01.corp.local',
          CurrentRegistrationState: 1,
          CurrentPowerState: 4,
          FaultState: 0,
          IsInMaintenanceMode: false,
          CurrentLoadIndex: 50,
          OSType: 'Windows',
          AgentVersion: '7.15',
          IPAddress: '10.0.0.1',
          LifecycleState: 0,
        },
        {
          DnsName: 'vda02.corp.local',
          CurrentRegistrationState: 0,
          CurrentPowerState: 3,
          FaultState: 3,
          IsInMaintenanceMode: true,
          CurrentLoadIndex: 0,
          OSType: 'Windows',
          AgentVersion: '7.15',
          IPAddress: '10.0.0.2',
          LifecycleState: 0,
        },
      ];
      const fetchFn = mockOData(machines);
      const result = (await handler('machines.status')(
        {},
        onPremConfig,
        onPremCreds,
        fetchFn,
      )) as Array<{
        name: string;
        registrationState: string;
        powerState: string;
        faultState: string;
      }>;

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('vda01.corp.local');
      expect(result[0]?.registrationState).toBe('Registered');
      expect(result[0]?.powerState).toBe('On');
      expect(result[0]?.faultState).toBe('None');

      expect(result[1]?.registrationState).toBe('Unregistered');
      expect(result[1]?.powerState).toBe('Off');
      expect(result[1]?.faultState).toBe('Unregistered');
    });
  });

  describe('machines.load', () => {
    it('sorts registered machines by load index descending', async () => {
      const machines = [
        {
          DnsName: 'vda01',
          CurrentLoadIndex: 3000,
          CurrentSessionCount: 5,
          IsInMaintenanceMode: false,
          CurrentRegistrationState: 1,
          LifecycleState: 0,
        },
        {
          DnsName: 'vda02',
          CurrentLoadIndex: 8000,
          CurrentSessionCount: 15,
          IsInMaintenanceMode: false,
          CurrentRegistrationState: 1,
          LifecycleState: 0,
        },
        {
          DnsName: 'vda03',
          CurrentLoadIndex: 5000,
          CurrentSessionCount: 10,
          IsInMaintenanceMode: true,
          CurrentRegistrationState: 1,
          LifecycleState: 0,
        },
      ];
      const fetchFn = mockOData(machines);
      const result = (await handler('machines.load')({}, onPremConfig, onPremCreds, fetchFn)) as {
        totalRegistered: number;
        machines: Array<{ name: string; currentLoadIndex: number; capacityPct: number }>;
      };

      expect(result.totalRegistered).toBe(3);
      expect(result.machines[0]?.name).toBe('vda02');
      expect(result.machines[0]?.currentLoadIndex).toBe(8000);
      expect(result.machines[0]?.capacityPct).toBe(80);
      expect(result.machines[2]?.name).toBe('vda01');
    });
  });

  describe('deliverygroups.health', () => {
    it('aggregates machines and sessions per delivery group', async () => {
      // 3 separate OData calls: DesktopGroups, Machines, Sessions
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        let value: unknown[];
        if (callCount === 1) {
          // DesktopGroups
          value = [
            { Id: 'dg-1', Name: 'DG-Finance', Enabled: true },
            { Id: 'dg-2', Name: 'DG-HR', Enabled: false },
          ];
        } else if (callCount === 2) {
          // Machines
          value = [
            {
              DesktopGroupId: 'dg-1',
              CurrentRegistrationState: 1,
              IsInMaintenanceMode: false,
              LifecycleState: 0,
            },
            {
              DesktopGroupId: 'dg-1',
              CurrentRegistrationState: 0,
              IsInMaintenanceMode: false,
              LifecycleState: 0,
            },
            {
              DesktopGroupId: 'dg-1',
              CurrentRegistrationState: 1,
              IsInMaintenanceMode: true,
              LifecycleState: 0,
            },
            {
              DesktopGroupId: 'dg-2',
              CurrentRegistrationState: 1,
              IsInMaintenanceMode: false,
              LifecycleState: 0,
            },
          ];
        } else {
          // Sessions
          value = [
            { DesktopGroupId: 'dg-1', EndDate: null },
            { DesktopGroupId: 'dg-1', EndDate: null },
            { DesktopGroupId: 'dg-2', EndDate: null },
          ];
        }
        return Promise.resolve(
          new Response(JSON.stringify({ value }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const result = (await handler('deliverygroups.health')(
        {},
        onPremConfig,
        onPremCreds,
        fetchFn,
      )) as Array<{
        name: string;
        totalMachines: number;
        registeredMachines: number;
        unregisteredMachines: number;
        maintenanceMode: number;
        activeSessions: number;
        enabled: boolean;
      }>;

      expect(result).toHaveLength(2);

      const finance = result.find((g) => g.name === 'DG-Finance');
      expect(finance).toBeDefined();
      expect(finance?.totalMachines).toBe(3);
      expect(finance?.registeredMachines).toBe(2);
      expect(finance?.unregisteredMachines).toBe(1);
      expect(finance?.maintenanceMode).toBe(1);
      expect(finance?.activeSessions).toBe(2);
      expect(finance?.enabled).toBe(true);

      const hr = result.find((g) => g.name === 'DG-HR');
      expect(hr?.totalMachines).toBe(1);
      expect(hr?.activeSessions).toBe(1);
      expect(hr?.enabled).toBe(false);
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(citrixPack.manifest.name).toBe('citrix');
      expect(citrixPack.manifest.probes).toHaveLength(6);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = citrixPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(citrixPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('all probes have 30s timeout', () => {
      for (const probe of citrixPack.manifest.probes) {
        expect(probe.timeout).toBe(30000);
      }
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('sessions.active')({}, onPremConfig, onPremCreds, fetchFn),
      ).rejects.toThrow('Citrix OData API returned 403');
    });
  });
});
