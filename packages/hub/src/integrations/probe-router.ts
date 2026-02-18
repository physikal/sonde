import type { ProbeResponse } from '@sonde/shared';
import type { SondeDb } from '../db/index.js';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import type { IntegrationExecutor } from './executor.js';

export class ProbeRouter {
  constructor(
    private dispatcher: AgentDispatcher,
    private integrationExecutor: IntegrationExecutor,
    private db?: SondeDb,
    private resolveIntegrationId?: (packName: string) => string | undefined,
  ) {}

  async execute(
    probe: string,
    params?: Record<string, unknown>,
    agent?: string,
  ): Promise<ProbeResponse> {
    if (this.integrationExecutor.isIntegrationProbe(probe)) {
      const startTime = Date.now();
      const result = await this.integrationExecutor.executeProbe(probe, params);
      this.logProbeExecution(probe, result, Date.now() - startTime);
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
