import type {
  DiagnosticRunbookDefinition,
  DiagnosticRunbookResult,
  RunProbe,
  RunbookContext,
  RunbookProbeResult,
} from '@sonde/packs';
import type { PackManifest, ProbeResponse, RunbookDefinition } from '@sonde/shared';
import type { ProbeRouter } from '../integrations/probe-router.js';

export const DEFAULT_MAX_PROBE_DATA_SIZE = 10_240; // 10 KB
export const DEFAULT_RUNBOOK_TIMEOUT_MS = 45_000;

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

export function truncateProbeData(
  probeResults: Record<string, RunbookProbeResult>,
  maxSize: number = DEFAULT_MAX_PROBE_DATA_SIZE,
): { results: Record<string, RunbookProbeResult>; truncated: boolean } {
  let anyTruncated = false;
  const results: Record<string, RunbookProbeResult> = {};

  for (const [key, result] of Object.entries(probeResults)) {
    const serialized = JSON.stringify(result.data);
    if (serialized && serialized.length > maxSize) {
      anyTruncated = true;
      results[key] = {
        ...result,
        data: { _truncated: true, _originalSize: serialized.length, _maxSize: maxSize },
      };
    } else {
      results[key] = result;
    }
  }

  return { results, truncated: anyTruncated };
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
    options?: { timeoutMs?: number; maxProbeDataSize?: number },
  ): Promise<DiagnosticRunbookResult & { timedOut?: boolean; truncated?: boolean }> {
    const def = this.diagnosticRunbooks.get(category);
    if (!def) throw new Error(`No diagnostic runbook for "${category}"`);

    const timeoutMs = options?.timeoutMs ?? DEFAULT_RUNBOOK_TIMEOUT_MS;
    const maxProbeDataSize = options?.maxProbeDataSize ?? DEFAULT_MAX_PROBE_DATA_SIZE;

    // Collect probe results as they complete (for partial results on timeout)
    const collectedProbes: Record<string, RunbookProbeResult> = {};

    const runProbe: RunProbe = async (probe, probeParams, agent) => {
      const start = Date.now();
      try {
        const response: ProbeResponse = await probeRouter.execute(probe, probeParams, agent);
        const result: RunbookProbeResult = {
          probe,
          status: response.status === 'success' ? 'success' : 'error',
          data: response.data,
          durationMs: response.durationMs,
          error:
            response.status !== 'success'
              ? (((response as Record<string, unknown>).error as string) ??
                JSON.stringify(response.data))
              : undefined,
        };
        collectedProbes[probe] = result;
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const isTimeout = message.toLowerCase().includes('timed out');
        const result: RunbookProbeResult = {
          probe,
          status: isTimeout ? 'timeout' : 'error',
          durationMs: Date.now() - start,
          error: message,
        };
        collectedProbes[probe] = result;
        return result;
      }
    };

    let timedOut = false;
    let runbookResult: DiagnosticRunbookResult;

    try {
      runbookResult = await Promise.race([
        def.handler(params, runProbe, context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('__RUNBOOK_TIMEOUT__')), timeoutMs),
        ),
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === '__RUNBOOK_TIMEOUT__') {
        timedOut = true;
        runbookResult = {
          category,
          findings: [],
          probeResults: collectedProbes,
          summary: {
            probesRun: Object.keys(collectedProbes).length,
            probesSucceeded: Object.values(collectedProbes).filter((p) => p.status === 'success')
              .length,
            probesFailed: Object.values(collectedProbes).filter((p) => p.status !== 'success')
              .length,
            findingsCount: { info: 0, warning: 0, critical: 0 },
            durationMs: timeoutMs,
            summaryText: `Runbook timed out after ${timeoutMs}ms with ${Object.keys(collectedProbes).length} probes completed`,
          },
        };
      } else {
        throw err;
      }
    }

    // Apply truncation
    const { results: truncatedProbes, truncated } = truncateProbeData(
      runbookResult.probeResults,
      maxProbeDataSize,
    );
    runbookResult.probeResults = truncatedProbes;

    return { ...runbookResult, timedOut, truncated };
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
