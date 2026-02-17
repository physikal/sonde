import type { IntegrationPack } from '@sonde/shared';

export const httpbinPack: IntegrationPack = {
  manifest: {
    name: 'httpbin',
    type: 'integration',
    version: '0.1.0',
    description: 'httpbin.org integration for testing HTTP requests',
    requires: { groups: [], files: [], commands: [] },
    probes: [
      {
        name: 'ip',
        description: 'Get the origin IP address',
        capability: 'observe',
        timeout: 5000,
      },
      {
        name: 'headers',
        description: 'Get the request headers as seen by the server',
        capability: 'observe',
        timeout: 5000,
      },
      {
        name: 'status',
        description: 'Return a response with the given HTTP status code',
        capability: 'observe',
        params: {
          code: {
            type: 'number',
            description: 'HTTP status code to return',
            required: true,
          },
        },
        timeout: 5000,
      },
    ],
    runbook: {
      category: 'httpbin',
      probes: ['ip', 'headers'],
      parallel: true,
    },
  },

  handlers: {
    ip: async (_params, config, _credentials, fetchFn) => {
      const res = await fetchFn(`${config.endpoint}/ip`);
      if (!res.ok) throw new Error(`httpbin /ip returned ${res.status}`);
      return await res.json();
    },

    headers: async (_params, config, _credentials, fetchFn) => {
      const res = await fetchFn(`${config.endpoint}/headers`);
      if (!res.ok) throw new Error(`httpbin /headers returned ${res.status}`);
      return await res.json();
    },

    status: async (params, config, _credentials, fetchFn) => {
      const code = params?.code ?? 200;
      const res = await fetchFn(`${config.endpoint}/status/${code}`);
      return { statusCode: res.status, ok: res.ok };
    },
  },

  testConnection: async (config, _credentials, fetchFn) => {
    try {
      const res = await fetchFn(`${config.endpoint}/ip`);
      return res.ok;
    } catch {
      return false;
    }
  },
};
