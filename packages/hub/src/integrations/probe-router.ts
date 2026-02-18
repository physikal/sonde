import type { ProbeResponse } from '@sonde/shared';
import type { AgentDispatcher } from '../ws/dispatcher.js';
import type { IntegrationExecutor } from './executor.js';

export class ProbeRouter {
  constructor(
    private dispatcher: AgentDispatcher,
    private integrationExecutor: IntegrationExecutor,
  ) {}

  async execute(
    probe: string,
    params?: Record<string, unknown>,
    agent?: string,
  ): Promise<ProbeResponse> {
    if (this.integrationExecutor.isIntegrationProbe(probe)) {
      return this.integrationExecutor.executeProbe(probe, params);
    }

    if (!agent) {
      throw new Error(`Agent name or ID is required for agent probe '${probe}'`);
    }

    return this.dispatcher.sendProbe(agent, probe, params);
  }
}
