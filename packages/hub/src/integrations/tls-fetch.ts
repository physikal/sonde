import https from 'node:https';
import type { IntegrationConfig } from './types.js';

type FetchFn = typeof globalThis.fetch;

/**
 * Build a fetch function that respects the integration's TLS config.
 * When tlsRejectUnauthorized is false, creates a fetch wrapper using
 * an https.Agent that accepts self-signed certificates.
 */
export function buildTlsFetch(config: IntegrationConfig): FetchFn {
  if (config.tlsRejectUnauthorized === false) {
    const agent = new https.Agent({ rejectUnauthorized: false });
    return ((input: string | URL, init?: Record<string, unknown>) =>
      globalThis.fetch(input, { ...init, dispatcher: agent } as Record<string, unknown>)) as FetchFn;
  }
  return globalThis.fetch.bind(globalThis);
}
