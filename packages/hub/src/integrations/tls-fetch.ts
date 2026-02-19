import { Agent, fetch as undiciFetch } from 'undici';
import type { IntegrationConfig } from './types.js';

type FetchFn = typeof globalThis.fetch;

/**
 * Build a fetch function that respects the integration's TLS config.
 * When tlsRejectUnauthorized is false, uses an undici Agent that
 * accepts self-signed certificates. Node.js native fetch ignores
 * https.Agent — undici's Agent is required for the dispatcher option.
 */
export function buildTlsFetch(config: IntegrationConfig): FetchFn {
  if (config.tlsRejectUnauthorized === false) {
    const agent = new Agent({
      connect: { rejectUnauthorized: false },
    });
    return ((input: string | URL | Request, init?: RequestInit) =>
      undiciFetch(input, {
        ...init,
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1])) as FetchFn;
  }
  return globalThis.fetch.bind(globalThis);
}
