import type {
  DiagnosticRunbookDefinition,
  DiagnosticRunbookResult,
  RunProbe,
  RunbookContext,
  RunbookProbeResult,
} from '@sonde/packs';
import type { PackManifest, ProbeResponse, RunbookDefinition } from '@sonde/shared';
import type { ProbeRouter } from '../integrations/probe-router.js';

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
  /** category → diagnostic runbook */
  private diagnosticRunbooks = new Map<string, DiagnosticRunbookDefinition>();

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

  registerDiagnostic(definition: DiagnosticRunbookDefinition): void {
    this.diagnosticRunbooks.set(definition.category, definition);
  }

  getDiagnosticRunbook(category: string): DiagnosticRunbookDefinition | undefined {
    return this.diagnosticRunbooks.get(category);
  }

  getRunbook(category: string): ResolvedRunbook | undefined {
    return this.runbooks.get(category);
  }

  getCategories(): string[] {
    return [...new Set([...this.runbooks.keys(), ...this.diagnosticRunbooks.keys()])];
  }

  async executeDiagnostic(
    category: string,
    params: Record<string, unknown>,
    probeRouter: ProbeRouter,
    context: RunbookContext,
  ): Promise<DiagnosticRunbookResult> {
    const def = this.diagnosticRunbooks.get(category);
    if (!def) throw new Error(`No diagnostic runbook for "${category}"`);

    const runProbe: RunProbe = async (probe, probeParams, agent) => {
      const start = Date.now();
      try {
        const response: ProbeResponse = await probeRouter.execute(probe, probeParams, agent);
        return {
          probe,
          status: response.status === 'success' ? 'success' : 'error',
          data: response.data,
          durationMs: response.durationMs,
          error: response.status !== 'success' ? JSON.stringify(response.data) : undefined,
        } as RunbookProbeResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const isTimeout = message.toLowerCase().includes('timed out');
        return {
          probe,
          status: isTimeout ? 'timeout' : 'error',
          durationMs: Date.now() - start,
          error: message,
        } as RunbookProbeResult;
      }
    };

    return def.handler(params, runProbe, context);
  }

  /** Execute a runbook's probes, optionally targeting an agent */
  async execute(
    category: string,
    agentNameOrId: string | undefined,
    probeRouter: ProbeRouter,
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
        qualifiedProbes.map((probe) => this.executeProbe(probe, agentNameOrId, probeRouter)),
      );
    } else {
      results = [];
      for (const probe of qualifiedProbes) {
        results.push(await this.executeProbe(probe, agentNameOrId, probeRouter));
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
    agentNameOrId: string | undefined,
    probeRouter: ProbeRouter,
  ): Promise<ProbeResult> {
    try {
      const response: ProbeResponse = await probeRouter.execute(probe, undefined, agentNameOrId);
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
