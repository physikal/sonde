import type { IntegrationConfig, IntegrationCredentials } from '@sonde/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, k8sGet, kubernetesPack } from './kubernetes.js';

const k8sConfig: IntegrationConfig = {
  endpoint: 'https://k8s.company.com:6443',
};

const creds: IntegrationCredentials = {
  packName: 'kubernetes',
  authMethod: 'bearer_token',
  credentials: { token: 'my-k8s-token-abc' },
};

const handler = (name: string) => {
  const h = kubernetesPack.handlers[name];
  if (!h) throw new Error(`Handler ${name} not found`);
  return h;
};

function callArgs(fn: ReturnType<typeof vi.fn>, index: number): unknown[] {
  const args = fn.mock.calls[index];
  if (!args) throw new Error(`No call at index ${index}`);
  return args;
}

function mockK8sResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockTextResponse(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'text/plain' },
    }),
  );
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue(
    new Response('Error', { status, statusText: 'Error' }),
  );
}

describe('kubernetes pack', () => {
  describe('auth headers', () => {
    it('uses Bearer token', () => {
      const headers = buildAuthHeaders(creds);
      expect(headers.Authorization).toBe('Bearer my-k8s-token-abc');
    });

    it('uses empty token when missing', () => {
      const emptyCreds: IntegrationCredentials = {
        packName: 'kubernetes',
        authMethod: 'bearer_token',
        credentials: {},
      };
      const headers = buildAuthHeaders(emptyCreds);
      expect(headers.Authorization).toBe('Bearer ');
    });
  });

  describe('k8sGet', () => {
    it('builds correct URL with params', async () => {
      const fetchFn = mockK8sResponse({ items: [] });
      await k8sGet('/api/v1/pods', k8sConfig, creds, fetchFn, {
        labelSelector: 'app=nginx',
      });

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v1/pods');
      expect(url).toContain('labelSelector=app%3Dnginx');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(401);
      await expect(
        k8sGet('/api/v1/pods', k8sConfig, creds, fetchFn),
      ).rejects.toThrow('Kubernetes API returned 401');
    });
  });

  describe('testConnection', () => {
    it('returns true when API is reachable', async () => {
      const fetchFn = mockK8sResponse({ items: [] });
      const result = await kubernetesPack.testConnection(k8sConfig, creds, fetchFn);
      expect(result).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v1/namespaces/default/pods');
      expect(url).toContain('limit=1');
    });

    it('returns false on non-200', async () => {
      const fetchFn = mockFetchError(401);
      const result = await kubernetesPack.testConnection(k8sConfig, creds, fetchFn);
      expect(result).toBe(false);
    });

    it('throws on network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        kubernetesPack.testConnection(k8sConfig, creds, fetchFn),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('pods.list', () => {
    it('returns pods from all namespaces', async () => {
      const fetchFn = mockK8sResponse({
        items: [
          {
            metadata: { name: 'nginx-abc', namespace: 'default' },
            status: {
              phase: 'Running',
              containerStatuses: [
                { name: 'nginx', ready: true, restartCount: 0 },
              ],
            },
            spec: { nodeName: 'node-1' },
          },
          {
            metadata: { name: 'redis-xyz', namespace: 'cache' },
            status: {
              phase: 'Running',
              containerStatuses: [
                { name: 'redis', ready: true, restartCount: 3 },
              ],
            },
            spec: { nodeName: 'node-2' },
          },
        ],
      });

      const result = (await handler('pods.list')({}, k8sConfig, creds, fetchFn)) as {
        pods: Array<{ name: string; namespace: string; restarts: number }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.pods[0]?.name).toBe('nginx-abc');
      expect(result.pods[0]?.namespace).toBe('default');
      expect(result.pods[1]?.restarts).toBe(3);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v1/pods');
      expect(url).not.toContain('/namespaces/');
    });

    it('filters by namespace when provided', async () => {
      const fetchFn = mockK8sResponse({ items: [] });
      await handler('pods.list')(
        { namespace: 'kube-system' }, k8sConfig, creds, fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v1/namespaces/kube-system/pods');
    });

    it('passes labelSelector as query param', async () => {
      const fetchFn = mockK8sResponse({ items: [] });
      await handler('pods.list')(
        { labelSelector: 'app=nginx' }, k8sConfig, creds, fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('labelSelector=app%3Dnginx');
    });
  });

  describe('pods.failing', () => {
    it('returns only non-Running/Succeeded pods', async () => {
      const fetchFn = mockK8sResponse({
        items: [
          {
            metadata: { name: 'healthy', namespace: 'default' },
            status: { phase: 'Running', containerStatuses: [] },
            spec: {},
          },
          {
            metadata: { name: 'completed', namespace: 'default' },
            status: { phase: 'Succeeded', containerStatuses: [] },
            spec: {},
          },
          {
            metadata: { name: 'crashloop', namespace: 'default' },
            status: {
              phase: 'CrashLoopBackOff',
              containerStatuses: [
                { name: 'app', ready: false, restartCount: 15 },
              ],
            },
            spec: { nodeName: 'node-1' },
          },
          {
            metadata: { name: 'pending-pod', namespace: 'staging' },
            status: { phase: 'Pending', containerStatuses: [] },
            spec: {},
          },
        ],
      });

      const result = (await handler('pods.failing')({}, k8sConfig, creds, fetchFn)) as {
        pods: Array<{ name: string; status: string; restarts: number }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.pods[0]?.name).toBe('crashloop');
      expect(result.pods[0]?.restarts).toBe(15);
      expect(result.pods[1]?.name).toBe('pending-pod');
      expect(result.pods[1]?.status).toBe('Pending');
    });
  });

  describe('nodes.list', () => {
    it('returns nodes with Ready/NotReady status', async () => {
      const fetchFn = mockK8sResponse({
        items: [
          {
            metadata: { name: 'node-1' },
            status: {
              conditions: [
                { type: 'Ready', status: 'True' },
                { type: 'MemoryPressure', status: 'False' },
              ],
              nodeInfo: {
                kubeletVersion: 'v1.28.3',
                osImage: 'Ubuntu 22.04',
              },
            },
          },
          {
            metadata: { name: 'node-2' },
            status: {
              conditions: [{ type: 'Ready', status: 'False' }],
              nodeInfo: {
                kubeletVersion: 'v1.28.3',
                osImage: 'Ubuntu 22.04',
              },
            },
          },
        ],
      });

      const result = (await handler('nodes.list')({}, k8sConfig, creds, fetchFn)) as {
        nodes: Array<{
          name: string;
          status: string;
          kubeletVersion: string | null;
        }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.nodes[0]?.name).toBe('node-1');
      expect(result.nodes[0]?.status).toBe('Ready');
      expect(result.nodes[0]?.kubeletVersion).toBe('v1.28.3');
      expect(result.nodes[1]?.status).toBe('NotReady');
    });
  });

  describe('events.recent', () => {
    it('returns warning events with fieldSelector', async () => {
      const fetchFn = mockK8sResponse({
        items: [
          {
            type: 'Warning',
            reason: 'BackOff',
            message: 'Back-off restarting failed container',
            involvedObject: {
              kind: 'Pod',
              name: 'crashloop-abc',
              namespace: 'default',
            },
            firstTimestamp: '2026-03-06T10:00:00Z',
            lastTimestamp: '2026-03-06T11:00:00Z',
            count: 5,
          },
        ],
      });

      const result = (await handler('events.recent')({}, k8sConfig, creds, fetchFn)) as {
        events: Array<{
          type: string;
          reason: string;
          message: string;
          count: number;
        }>;
        count: number;
      };

      expect(result.count).toBe(1);
      expect(result.events[0]?.type).toBe('Warning');
      expect(result.events[0]?.reason).toBe('BackOff');
      expect(result.events[0]?.count).toBe(5);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('fieldSelector=type%21%3DNormal');
    });
  });

  describe('pods.logs', () => {
    it('returns plain text logs', async () => {
      const logLines = 'line 1\nline 2\nline 3';
      const fetchFn = mockTextResponse(logLines);

      const result = (await handler('pods.logs')(
        { namespace: 'default', pod: 'nginx-abc', lines: 50 },
        k8sConfig, creds, fetchFn,
      )) as { logs: string; pod: string; namespace: string; lines: number };

      expect(result.logs).toBe(logLines);
      expect(result.pod).toBe('nginx-abc');
      expect(result.namespace).toBe('default');
      expect(result.lines).toBe(50);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v1/namespaces/default/pods/nginx-abc/log');
      expect(url).toContain('tailLines=50');
    });

    it('defaults to 100 lines', async () => {
      const fetchFn = mockTextResponse('log');
      await handler('pods.logs')(
        { namespace: 'default', pod: 'nginx-abc' },
        k8sConfig, creds, fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('tailLines=100');
    });

    it('throws when namespace is missing', async () => {
      const fetchFn = mockTextResponse('');
      await expect(
        handler('pods.logs')({ pod: 'nginx' }, k8sConfig, creds, fetchFn),
      ).rejects.toThrow('namespace parameter is required');
    });

    it('throws when pod is missing', async () => {
      const fetchFn = mockTextResponse('');
      await expect(
        handler('pods.logs')({ namespace: 'default' }, k8sConfig, creds, fetchFn),
      ).rejects.toThrow('pod parameter is required');
    });

    it('throws on non-200 response', async () => {
      const fetchFn = mockFetchError(404);
      await expect(
        handler('pods.logs')(
          { namespace: 'default', pod: 'missing' },
          k8sConfig, creds, fetchFn,
        ),
      ).rejects.toThrow('Kubernetes API returned 404');
    });
  });

  describe('deployments.list', () => {
    it('returns deployments from all namespaces', async () => {
      const fetchFn = mockK8sResponse({
        items: [
          {
            metadata: { name: 'web', namespace: 'default' },
            status: {
              replicas: 3,
              readyReplicas: 3,
              availableReplicas: 3,
              updatedReplicas: 3,
            },
          },
          {
            metadata: { name: 'api', namespace: 'backend' },
            status: {
              replicas: 2,
              readyReplicas: 1,
              availableReplicas: 1,
              updatedReplicas: 2,
            },
          },
        ],
      });

      const result = (await handler('deployments.list')(
        {}, k8sConfig, creds, fetchFn,
      )) as {
        deployments: Array<{
          name: string;
          replicas: number;
          readyReplicas: number;
        }>;
        count: number;
      };

      expect(result.count).toBe(2);
      expect(result.deployments[0]?.name).toBe('web');
      expect(result.deployments[0]?.readyReplicas).toBe(3);
      expect(result.deployments[1]?.readyReplicas).toBe(1);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/apis/apps/v1/deployments');
      expect(url).not.toContain('/namespaces/');
    });

    it('filters by namespace when provided', async () => {
      const fetchFn = mockK8sResponse({ items: [] });
      await handler('deployments.list')(
        { namespace: 'production' }, k8sConfig, creds, fetchFn,
      );

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/apis/apps/v1/namespaces/production/deployments');
    });
  });

  describe('health', () => {
    it('returns reachable true on success', async () => {
      const fetchFn = mockK8sResponse({ items: [] });
      const result = (await handler('health')({}, k8sConfig, creds, fetchFn)) as {
        reachable: boolean;
      };

      expect(result.reachable).toBe(true);

      const [url] = callArgs(fetchFn, 0);
      expect(url).toContain('/api/v1/namespaces/default/pods');
      expect(url).toContain('limit=1');
    });

    it('throws on API error', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('health')({}, k8sConfig, creds, fetchFn),
      ).rejects.toThrow('Kubernetes API returned 403');
    });
  });

  describe('manifest', () => {
    it('has correct name and probe count', () => {
      expect(kubernetesPack.manifest.name).toBe('kubernetes');
      expect(kubernetesPack.manifest.probes).toHaveLength(7);
    });

    it('all handlers match manifest probes', () => {
      const probeNames = kubernetesPack.manifest.probes.map((p) => p.name);
      const handlerNames = Object.keys(kubernetesPack.handlers);
      expect(handlerNames.sort()).toEqual(probeNames.sort());
    });

    it('has correct timeouts', () => {
      const probeMap = new Map(
        kubernetesPack.manifest.probes.map((p) => [p.name, p.timeout]),
      );
      expect(probeMap.get('pods.list')).toBe(15000);
      expect(probeMap.get('pods.failing')).toBe(15000);
      expect(probeMap.get('nodes.list')).toBe(15000);
      expect(probeMap.get('events.recent')).toBe(15000);
      expect(probeMap.get('pods.logs')).toBe(30000);
      expect(probeMap.get('deployments.list')).toBe(15000);
      expect(probeMap.get('health')).toBe(10000);
    });

    it('has kubernetes runbook', () => {
      expect(kubernetesPack.manifest.runbook).toEqual({
        category: 'kubernetes',
        probes: ['health', 'pods.failing', 'events.recent'],
        parallel: true,
      });
    });
  });

  describe('error handling', () => {
    it('throws on non-200 API response for probes', async () => {
      const fetchFn = mockFetchError(403);
      await expect(
        handler('pods.list')({}, k8sConfig, creds, fetchFn),
      ).rejects.toThrow('Kubernetes API returned 403');
    });
  });
});
