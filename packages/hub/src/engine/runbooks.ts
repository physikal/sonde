import type { PackManifest, ProbeResponse, RunbookDefinition } from '@sonde/shared';
import type { AgentDispatcher } from '../ws/dispatcher.js';

export interface ProbeResult {
  probe: string;
  status: 'success' | 'error' | 'timeout';
  data?: unknown;
  durationMs: number;
  error?: string;
}

export interface DiagnoseResult {
  category: string;
  findings: Record<string, ProbeResult>;
  summary: {
    probesRun: number;
    probesSucceeded: number;
    probesFailed: number;
    durationMs: number;
  };
}

interface ResolvedRunbook {
  packName: string;
  definition: RunbookDefinition;
}

export class RunbookEngine {
  /** category → resolved runbook */
  private runbooks = new Map<string, ResolvedRunbook>();

  /** Load runbook definitions from pack manifests */
  loadFromManifests(manifests: PackManifest[]): void {
    for (const manifest of manifests) {
      if (!manifest.runbook) continue;
      this.runbooks.set(manifest.runbook.category, {
        packName: manifest.name,
        definition: manifest.runbook,
      });
    }
  }

  getRunbook(category: string): ResolvedRunbook | undefined {
    return this.runbooks.get(category);
  }

  getCategories(): string[] {
    return [...this.runbooks.keys()];
  }

  /** Execute a runbook's probes against an agent */
  async execute(
    category: string,
    agentNameOrId: string,
    dispatcher: AgentDispatcher,
  ): Promise<DiagnoseResult> {
    const runbook = this.runbooks.get(category);
    if (!runbook) {
      throw new Error(`No runbook found for category "${category}"`);
    }

    const { packName, definition } = runbook;
    const qualifiedProbes = definition.probes.map((p) => `${packName}.${p}`);

    const startTime = Date.now();
    let results: ProbeResult[];

    if (definition.parallel) {
      results = await Promise.all(
        qualifiedProbes.map((probe) => this.executeProbe(probe, agentNameOrId, dispatcher)),
      );
    } else {
      results = [];
      for (const probe of qualifiedProbes) {
        results.push(await this.executeProbe(probe, agentNameOrId, dispatcher));
      }
    }

    const totalDuration = Date.now() - startTime;
    const findings: Record<string, ProbeResult> = {};
    let succeeded = 0;
    let failed = 0;

    for (const result of results) {
      findings[result.probe] = result;
      if (result.status === 'success') {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      category,
      findings,
      summary: {
        probesRun: results.length,
        probesSucceeded: succeeded,
        probesFailed: failed,
        durationMs: totalDuration,
      },
    };
  }

  private async executeProbe(
    probe: string,
    agentNameOrId: string,
    dispatcher: AgentDispatcher,
  ): Promise<ProbeResult> {
    try {
      const response: ProbeResponse = await dispatcher.sendProbe(agentNameOrId, probe);
      return {
        probe,
        status: response.status === 'success' ? 'success' : 'error',
        data: response.data,
        durationMs: response.durationMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const isTimeout = message.toLowerCase().includes('timed out');
      return {
        probe,
        status: isTimeout ? 'timeout' : 'error',
        durationMs: 0,
        error: message,
      };
    }
  }
}
