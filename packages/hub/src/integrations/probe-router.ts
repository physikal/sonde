import type { ProbeResponse } from '@sonde/shared';
import type { SondeDb } from '../db/index.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import type { IntegrationExecutor } from './executor.js';

interface CacheEntry {
  response: ProbeResponse;
  expiresAt: number;
}

export interface ProbeRouterOptions {
  cacheTtlMs?: number;
}

function stableStringify(
  params: Record<string, unknown> | undefined,
): string {
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
    private resolveIntegrationId?: (
      packName: string,
    ) => string | undefined,
    options?: ProbeRouterOptions,
  ) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 10_000;
  }

  async execute(
    probe: string,
    params?: Record<string, unknown>,
    agent?: string,
  ): Promise<ProbeResponse> {
    const cacheKey = `${probe}:${stableStringify(params)}:${agent ?? ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return structuredClone(cached.response);
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const response = await this.executeProbe(probe, params, agent);

    if (response.status === 'success') {
      this.cache.set(cacheKey, {
        response: structuredClone(response),
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    return response;
  }

  private async executeProbe(
    probe: string,
    params?: Record<string, unknown>,
    agent?: string,
  ): Promise<ProbeResponse> {
    if (this.integrationExecutor.isIntegrationProbe(probe)) {
      const startTime = Date.now();
      const result =
        await this.integrationExecutor.executeProbe(probe, params);
      this.logProbeExecution(probe, result, Date.now() - startTime);
      return result;
    }

    if (!agent) {
      throw new Error(
        `Agent name or ID is required for agent probe '${probe}'`,
      );
    }

    return this.dispatcher.sendProbe(agent, probe, params);
  }

  private logProbeExecution(
    probe: string,
    result: ProbeResponse,
    durationMs: number,
  ): void {
    if (!this.db || !this.resolveIntegrationId) return;

    const packName = probe.split('.')[0];
    if (!packName) return;

    const integrationId = this.resolveIntegrationId(packName);
    if (!integrationId) return;

    this.db.logIntegrationEvent({
      integrationId,
      eventType: 'probe_execution',
      status: result.status === 'success' ? 'success' : 'error',
      message: `Probe ${probe} ${result.status} (${durationMs}ms)`,
      detailJson: JSON.stringify({
        probe,
        durationMs,
        status: result.status,
      }),
    });
  }
}
