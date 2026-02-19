import type { PackManifest } from '../schemas/packs.js';

/** Injectable fetch function for testing */
export type FetchFn = typeof globalThis.fetch;

/** Supported authentication methods for integration packs */
export type AuthMethod = 'api_key' | 'bearer_token' | 'oauth2';

/** OAuth2-specific credential fields */
export interface OAuth2Credentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenUrl?: string;
}

/** Credentials for authenticating with an external API */
export interface IntegrationCredentials {
  packName: string;
  authMethod: AuthMethod;
  credentials: Record<string, string>;
  oauth2?: OAuth2Credentials;
}

/** Configuration for an integration pack's external API */
export interface IntegrationConfig {
  /** Base URL for the external API */
  endpoint: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
  /** Accept self-signed TLS certificates (default: true — reject invalid certs) */
  tlsRejectUnauthorized?: boolean;
}

/** Handler function for a single integration probe */
export type IntegrationProbeHandler = (
  params: Record<string, unknown> | undefined,
  config: IntegrationConfig,
  credentials: IntegrationCredentials,
  fetchFn: FetchFn,
) => Promise<unknown>;

/** An integration pack definition */
export interface IntegrationPack {
  manifest: PackManifest;
  handlers: Record<string, IntegrationProbeHandler>;
  /** Test connectivity with the external API */
  testConnection: (
    config: IntegrationConfig,
    credentials: IntegrationCredentials,
    fetchFn: FetchFn,
  ) => Promise<boolean>;
}
