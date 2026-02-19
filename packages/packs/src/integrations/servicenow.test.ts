import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { servicenowPack } from './servicenow.js';

const config: IntegrationConfig = {
  endpoint: 'https://instance.service-now.com',
};

const basicCreds: IntegrationCredentials = {
  packName: 'servicenow',
  authMethod: 'api_key',
  credentials: { username: 'admin', password: 'secret' },
};

const oauthCreds: IntegrationCredentials = {
  packName: 'servicenow',
  authMethod: 'oauth2',
  credentials: {},
  oauth2: { accessToken: 'my-token' },
};

const handler = (name: string) => {
  const h = servicenowPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

/** Get a specific call's args from a mock, with bounds check */
function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

/** Create a mock fetch that returns ServiceNow-shaped JSON */
function mockFetch(result: unknown[] = []) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Create a mock fetch that returns a non-200 response */
function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue(new Response('Error', { status, statusText: 'Error' }));
}

/** Create a multi-step mock: first call returns lookup result, second returns data */
function mockFetchMultiStep(lookupResult: unknown[], dataResult: unknown[]) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    const body = callCount === 1 ? { result: lookupResult } : { result: dataResult };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

describe('servicenow pack', () => {
  describe('auth headers', () => {
    it('uses basic auth for api_key method', async () => {
      const fetchFn = mockFetch([{ name: 'web01' }]);
      await handler('ci.lookup')({ query: 'web01' }, config, basicCreds, fetchFn);

      const init = callArgs(fetchFn, 0)[1] as { headers: Record<string, string> };
      const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
      expect(init.headers.Authorization).toBe(expected);
    });

    it('uses bearer token for oauth2 method', async () => {
      const fetchFn = mockFetch([{ name: 'web01' }]);
      await handler('ci.lookup')({ query: 'web01' }, config, oauthCreds, fetchFn);

      const init = callArgs(fetchFn, 0)[1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe('Bearer my-token');
    });
  });

  describe('testConnection', () => {
    it('returns true on 200', async () => {
      const fetchFn = mockFetch([]);
      const result = await servicenowPack.testConnection(config, basicCreds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/now/table/sys_properties');
      expect(url).toContain('sysparm_limit=1');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(401);
      const result = await servicenowPack.testConnection(config, basicCreds, fetchFn);
      expect(result).toBe(false);
    });

    it('throws on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(servicenowPack.testConnection(config, basicCreds, fetchFn))
        .rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('ci.lookup', () => {
    it('queries by name or IP with default server type', async () => {
      const fetchFn = mockFetch([{ name: 'web01', ip_address: '10.0.0.1' }]);
      const result = await handler('ci.lookup')({ query: 'web01' }, config, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/now/table/cmdb_ci_server');
      expect(url).toContain('name%3Dweb01%5EORip_address%3Dweb01');
      expect(result).toEqual([{ name: 'web01', ip_address: '10.0.0.1' }]);
    });

    it('uses custom CI type when provided', async () => {
      const fetchFn = mockFetch([]);
      await handler('ci.lookup')(
        { query: 'desk01', type: 'computer' },
        config,
        basicCreds,
        fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/now/table/cmdb_ci_computer');
    });

    it('throws when query is missing', async () => {
      const fetchFn = mockFetch();
      await expect(handler('ci.lookup')({}, config, basicCreds, fetchFn)).rejects.toThrow(
        'query parameter is required',
      );
    });

    it('includes common params', async () => {
      const fetchFn = mockFetch([]);
      await handler('ci.lookup')({ query: 'test' }, config, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('sysparm_display_value=true');
      expect(url).toContain('sysparm_exclude_reference_link=true');
      expect(url).toContain('sysparm_limit=1000');
    });
  });

  describe('ci.owner', () => {
    it('returns ownership fields', async () => {
      const ownerData = [{ name: 'web01', assigned_to: 'Alice', support_group: 'Infra' }];
      const fetchFn = mockFetch(ownerData);
      const result = await handler('ci.owner')({ name: 'web01' }, config, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain(
        'sysparm_fields=name%2Cassigned_to%2Csupport_group%2Cmanaged_by%2Cowned_by',
      );
      expect(result).toEqual(ownerData);
    });

    it('throws when name is missing', async () => {
      await expect(handler('ci.owner')({}, config, basicCreds, mockFetch())).rejects.toThrow(
        'name parameter is required',
      );
    });
  });

  describe('ci.relationships', () => {
    it('looks up sys_id then queries relationships', async () => {
      const fetchFn = mockFetchMultiStep(
        [{ sys_id: 'abc123', name: 'web01' }],
        [{ parent: 'abc123', child: 'def456', type: 'Runs on' }],
      );

      const result = await handler('ci.relationships')(
        { name: 'web01' },
        config,
        basicCreds,
        fetchFn,
      );

      expect(fetchFn).toHaveBeenCalledTimes(2);
      const [lookupUrl] = callArgs(fetchFn, 0);
      expect(lookupUrl).toContain('/api/now/table/cmdb_ci_server');
      const [relUrl] = callArgs(fetchFn, 1);
      expect(relUrl).toContain('/api/now/table/cmdb_rel_ci');
      expect(relUrl).toContain('parent%3Dabc123%5EORchild%3Dabc123');
      expect(result).toEqual([{ parent: 'abc123', child: 'def456', type: 'Runs on' }]);
    });

    it('throws when CI not found', async () => {
      const fetchFn = mockFetch([]);
      await expect(
        handler('ci.relationships')({ name: 'missing' }, config, basicCreds, fetchFn),
      ).rejects.toThrow('CI not found: missing');
    });
  });

  describe('changes.recent', () => {
    it('looks up sys_id then queries change_request with default 7 days', async () => {
      const fetchFn = mockFetchMultiStep(
        [{ sys_id: 'srv01' }],
        [{ number: 'CHG0001', short_description: 'Update' }],
      );

      const result = await handler('changes.recent')(
        { name: 'web01' },
        config,
        basicCreds,
        fetchFn,
      );

      const [changeUrl] = callArgs(fetchFn, 1);
      expect(changeUrl).toContain('/api/now/table/change_request');
      expect(changeUrl).toContain('cmdb_ci%3Dsrv01');
      expect(changeUrl).toContain('gs.daysAgoStart%287%29');
      expect(result).toEqual([{ number: 'CHG0001', short_description: 'Update' }]);
    });

    it('respects custom days parameter', async () => {
      const fetchFn = mockFetchMultiStep([{ sys_id: 'srv01' }], []);

      await handler('changes.recent')({ name: 'web01', days: 30 }, config, basicCreds, fetchFn);

      const [changeUrl] = callArgs(fetchFn, 1);
      expect(changeUrl).toContain('gs.daysAgoStart%2830%29');
    });
  });

  describe('incidents.open', () => {
    it('queries incidents not in resolved/closed/canceled states', async () => {
      const incidents = [{ number: 'INC0001', state: '2', short_description: 'Server down' }];
      const fetchFn = mockFetch(incidents);
      const result = await handler('incidents.open')(
        { name: 'web01' },
        config,
        basicCreds,
        fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/now/table/incident');
      expect(url).toContain('cmdb_ci.name%3Dweb01');
      expect(url).toContain('stateNOT+IN6%2C7%2C8');
      expect(result).toEqual(incidents);
    });
  });

  describe('service.health', () => {
    it('fetches service then child relationships', async () => {
      const fetchFn = mockFetchMultiStep(
        [{ sys_id: 'svc01', name: 'Email', operational_status: '1' }],
        [{ child: 'srv01', type: 'Depends on' }],
      );

      const result = (await handler('service.health')(
        { service_name: 'Email' },
        config,
        basicCreds,
        fetchFn,
      )) as { service: { name: string }; children: unknown[] };

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.service.name).toBe('Email');
      expect(result.children).toEqual([{ child: 'srv01', type: 'Depends on' }]);
    });

    it('throws when service not found', async () => {
      const fetchFn = mockFetch([]);
      await expect(
        handler('service.health')({ service_name: 'Missing' }, config, basicCreds, fetchFn),
      ).rejects.toThrow('Service not found: Missing');
    });
  });

  describe('ci.lifecycle', () => {
    it('returns lifecycle fields', async () => {
      const lifecycle = [{ name: 'web01', install_date: '2023-01-15', asset_tag: 'A001' }];
      const fetchFn = mockFetch(lifecycle);
      const result = await handler('ci.lifecycle')({ name: 'web01' }, config, basicCreds, fetchFn);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain(
        'sysparm_fields=name%2Cinstall_date%2Cwarranty_expiration%2Cend_of_life%2Casset_tag%2Cmodel_id',
      );
      expect(result).toEqual(lifecycle);
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('ci.lookup')({ query: 'web01' }, config, basicCreds, fetchFn),
      ).rejects.toThrow('ServiceNow API returned 403');
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(servicenowPack.manifest.name).toBe('servicenow');
      expect(servicenowPack.manifest.probes).toHaveLength(7);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = servicenowPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(servicenowPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });
  });
});
