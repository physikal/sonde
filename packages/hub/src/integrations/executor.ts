import type { ProbeResponse } from '@sonde/shared';
import { DEFAULT_PROBE_TIMEOUT_MS } from '@sonde/shared';
import type {
  FetchFn,
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationPack,
} from './types.js';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

interface RegisteredPack {
  pack: IntegrationPack;
  config: IntegrationConfig;
  credentials: IntegrationCredentials;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true; // network errors
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof Response) return error.status >= 500;
  return false;
}

export class IntegrationExecutor {
  private packs = new Map<string, RegisteredPack>();
  private fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  registerPack(
    pack: IntegrationPack,
    config: IntegrationConfig,
    credentials: IntegrationCredentials,
  ): void {
    this.packs.set(pack.manifest.name, { pack, config, credentials });
  }

  unregisterPack(name: string): boolean {
    return this.packs.delete(name);
  }

  isIntegrationProbe(probe: string): boolean {
    const packName = probe.split('.')[0];
    return this.packs.has(packName!);
  }

  getRegisteredPacks(): IntegrationPack[] {
    return [...this.packs.values()].map((r) => r.pack);
  }

  async executeProbe(
    probe: string,
    params?: Record<string, unknown>,
  ): Promise<ProbeResponse> {
    const startTime = Date.now();
    const packName = probe.split('.')[0];
    const registered = this.packs.get(packName!);

    if (!registered) {
      return this.errorResponse(probe, startTime, `Unknown integration pack: ${packName}`);
    }

    const { pack, config, credentials } = registered;
    const handlerName = probe.slice(packName!.length + 1);
    const handler = pack.handlers[handlerName];

    if (!handler) {
      return this.errorResponse(probe, startTime, `Unknown probe: ${probe}`);
    }

    const probeDef = pack.manifest.probes.find((p) => p.name === handlerName);
    const timeout = probeDef?.timeout ?? DEFAULT_PROBE_TIMEOUT_MS;

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchWithSignal: FetchFn = (input, init) =>
          this.fetchFn(input, { ...init, signal: controller.signal });

        const data = await handler(params, config, credentials, fetchWithSignal);
        clearTimeout(timer);

        return {
          probe,
          status: 'success',
          data,
          durationMs: Date.now() - startTime,
          metadata: {
            agentVersion: 'hub',
            packName: pack.manifest.name,
            packVersion: pack.manifest.version,
            capabilityLevel: probeDef?.capability ?? 'observe',
          },
        };
      } catch (error) {
        clearTimeout(timer);
        lastError = error;

        // On 401 with OAuth2 credentials, attempt token refresh once
        if (
          attempt === 0 &&
          error instanceof Response &&
          error.status === 401 &&
          credentials.authMethod === 'oauth2' &&
          credentials.oauth2?.refreshToken &&
          credentials.oauth2?.tokenUrl
        ) {
          const refreshed = await this.refreshOAuth2Token(credentials);
          if (refreshed) continue;
        }

        if (!isRetryable(error) || attempt === MAX_RETRIES - 1) break;

        // Exponential backoff
        await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
      }
    }

    const message = lastError instanceof Error ? lastError.message
      : lastError instanceof DOMException ? lastError.message
      : 'Integration probe failed';

    return this.errorResponse(probe, startTime, message);
  }

  private errorResponse(probe: string, startTime: number, error: string): ProbeResponse {
    const packName = probe.split('.')[0] ?? 'unknown';
    return {
      probe,
      status: 'error',
      data: null,
      durationMs: Date.now() - startTime,
      metadata: {
        agentVersion: 'hub',
        packName,
        packVersion: '0.0.0',
        capabilityLevel: 'observe',
      },
      error,
    } as ProbeResponse;
  }

  private async refreshOAuth2Token(credentials: IntegrationCredentials): Promise<boolean> {
    const { oauth2 } = credentials;
    if (!oauth2?.refreshToken || !oauth2.tokenUrl) return false;

    try {
      const response = await this.fetchFn(oauth2.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: oauth2.refreshToken,
        }),
      });

      if (!response.ok) return false;

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      oauth2.accessToken = data.access_token;
      if (data.refresh_token) oauth2.refreshToken = data.refresh_token;
      if (data.expires_in) oauth2.expiresAt = Date.now() + data.expires_in * 1000;

      return true;
    } catch {
      return false;
    }
  }
}
