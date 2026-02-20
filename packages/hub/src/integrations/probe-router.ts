import type { IntegrationPack, ProbeResponse } from '@sonde/shared';
import type { SondeDb } from '../db/index.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import type { IntegrationExecutor } from './executor.js';

interface CacheEntry {
  response: ProbeResponse;
  expiresAt: number;
}

export interface CallerContext {
  apiKeyId?: string;
}

export interface ProbeRouterOptions {
  cacheTtlMs?: number;
}

function stableStringify(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const sorted = Object.keys(params).sort();
  const obj: Record<string, unknown> = {};
  for (const key of sorted) {
    obj[key] = params[key];
  }
  return JSON.stringify(obj);
}

export class ProbeRouter {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;

  constructor(
    private dispatcher: AgentDispatcher,
    private integrationExecutor: IntegrationExecutor,
    private db?: SondeDb,
    private resolveIntegrationId?: (packName: string) => string | undefined,
    options?: ProbeRouterOptions,
  ) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 10_000;
  }

  getIntegrationPacks(): IntegrationPack[] {
    return this.integrationExecutor.getRegisteredPacks();
  }

  async execute(
    probe: string,
    params?: Record<string, unknown>,
    agent?: string,
    caller?: CallerContext,
  ): Promise<ProbeResponse> {
    const cacheKey = `${probe}:${stableStringify(params)}:${agent ?? ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return structuredClone(cached.response);
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const response = await this.executeProbe(probe, params, agent, caller);

    if (response.status === 'success') {
      this.cache.set(cacheKey, {
        response: structuredClone(response),
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    this.recordProbeResult(probe, agent, response, caller);

    return response;
  }

  private async executeProbe(
    probe: string,
    params?: Record<string, unknown>,
    agent?: string,
    caller?: CallerContext,
  ): Promise<ProbeResponse> {
    if (this.integrationExecutor.isIntegrationProbe(probe)) {
      const startTime = Date.now();
      const result = await this.integrationExecutor.executeProbe(probe, params);
      this.logProbeExecution(probe, result, Date.now() - startTime, params, caller);
      return result;
    }

    if (!agent) {
      throw new Error(`Agent name or ID is required for agent probe '${probe}'`);
    }

    return this.dispatcher.sendProbe(agent, probe, params);
  }

  private logProbeExecution(
    probe: string,
    result: ProbeResponse,
    durationMs: number,
    params?: Record<string, unknown>,
    caller?: CallerContext,
  ): void {
    if (!this.db || !this.resolveIntegrationId) return;

    const packName = probe.split('.')[0];
    if (!packName) return;

    const integrationId = this.resolveIntegrationId(packName);
    if (!integrationId) return;

    const detail: Record<string, unknown> = {
      probe,
      durationMs,
      status: result.status,
    };
    if (params && Object.keys(params).length > 0) {
      detail.params = params;
    }
    if (caller?.apiKeyId) {
      detail.callerApiKeyId = caller.apiKeyId;
    }
    if (result.status !== 'success') {
      const data = result.data as Record<string, unknown> | undefined;
      if (data?.error) {
        detail.error = data.error;
      }
    }

    this.db.logIntegrationEvent({
      integrationId,
      eventType: 'probe_execution',
      status: result.status === 'success' ? 'success' : 'error',
      message: `Probe ${probe} ${result.status} (${durationMs}ms)`,
      detailJson: JSON.stringify(detail),
    });
  }

  private recordProbeResult(
    probe: string,
    agent: string | undefined,
    response: ProbeResponse,
    caller?: CallerContext,
  ): void {
    if (!this.db) return;

    const isIntegration = this.integrationExecutor.isIntegrationProbe(probe);
    const agentOrSource = agent ?? probe.split('.')[0] ?? 'unknown';
    const sourceType = isIntegration ? 'integration' : 'agent';

    let errorMessage: string | undefined;
    if (response.status !== 'success') {
      const data = response.data as Record<string, unknown> | undefined;
      if (typeof data?.error === 'string') {
        errorMessage = data.error.slice(0, 500);
      }
    }

    try {
      this.db.recordProbeResult({
        probe,
        agentOrSource,
        sourceType,
        status: response.status,
        durationMs: response.durationMs,
        errorMessage,
        callerApiKeyId: caller?.apiKeyId,
      });
    } catch {
      // Never block probe delivery
    }
  }
}
