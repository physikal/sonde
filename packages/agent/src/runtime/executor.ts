import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type ExecFn, type Pack, packRegistry } from '@sonde/packs';
import type { ProbeRequest, ProbeResponse } from '@sonde/shared';
import { VERSION } from '../version.js';
import { type ScrubPattern, buildPatterns, scrubData } from './scrubber.js';

const execFileAsync = promisify(execFile);

/** Default exec function that shells out to real commands */
async function defaultExec(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

export class ProbeExecutor {
  private packs: ReadonlyMap<string, Pack>;
  private exec: ExecFn;
  private scrubPatterns: ScrubPattern[];

  constructor(packs?: ReadonlyMap<string, Pack>, exec?: ExecFn, scrubPatterns?: ScrubPattern[]) {
    this.packs = packs ?? packRegistry;
    this.exec = exec ?? defaultExec;
    this.scrubPatterns = scrubPatterns ?? buildPatterns();
  }

  /** Get list of loaded packs with status info */
  getLoadedPacks(): Array<{ name: string; version: string; status: string }> {
    return [...this.packs.values()].map((pack) => ({
      name: pack.manifest.name,
      version: pack.manifest.version,
      status: 'active',
    }));
  }

  /** Get a pack by name */
  getPackByName(name: string): Pack | undefined {
    return this.packs.get(name);
  }

  /** Execute a probe request and return a probe response */
  async execute(request: ProbeRequest): Promise<ProbeResponse> {
    const start = Date.now();

    // Find the handler by full probe name (e.g. "system.disk.usage")
    const probeName = request.probe;
    const packName = probeName.split('.')[0];

    if (!packName) {
      return this.errorResponse(probeName, start, `Invalid probe name: ${probeName}`);
    }

    const pack = this.packs.get(packName);
    if (!pack) {
      return this.errorResponse(probeName, start, `Pack '${packName}' not loaded`);
    }

    const handler = pack.handlers[probeName];
    if (!handler) {
      return this.errorResponse(probeName, start, `Unknown probe: ${probeName}`);
    }

    try {
      const rawData = await handler(request.params, this.exec);
      const data = scrubData(rawData, this.scrubPatterns);
      return {
        probe: probeName,
        status: 'success',
        data,
        durationMs: Date.now() - start,
        metadata: {
          agentVersion: VERSION,
          packName: pack.manifest.name,
          packVersion: pack.manifest.version,
          capabilityLevel: 'observe',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.errorResponse(probeName, start, message, pack);
    }
  }

  private errorResponse(
    probe: string,
    startMs: number,
    message: string,
    pack?: Pack,
  ): ProbeResponse {
    return {
      probe,
      status: 'error',
      data: { error: message },
      durationMs: Date.now() - startMs,
      metadata: {
        agentVersion: VERSION,
        packName: pack?.manifest.name ?? 'unknown',
        packVersion: pack?.manifest.version ?? '0.0.0',
        capabilityLevel: 'observe',
      },
    };
  }
}
