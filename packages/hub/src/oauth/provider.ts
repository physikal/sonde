import crypto from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import type { SondeDb } from '../db/index.js';

const CODE_TTL_SECONDS = 300; // 5 minutes
const TOKEN_TTL_SECONDS = 3600; // 1 hour

class SondeClientsStore implements OAuthRegisteredClientsStore {
  constructor(private db: SondeDb) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db.getOAuthClient(clientId);
    if (!row) return undefined;

    const metadata = JSON.parse(row.metadata_json);
    return {
      ...metadata,
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      client_secret_expires_at: row.client_secret_expires_at ?? undefined,
      client_id_issued_at: row.client_id_issued_at,
    };
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): OAuthClientInformationFull {
    const clientId = crypto.randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);

    // Separate the client_secret from metadata for DB storage
    const { client_secret, client_secret_expires_at, ...metadata } = client;

    this.db.insertOAuthClient(
      clientId,
      client_secret ?? null,
      client_secret_expires_at ?? null,
      issuedAt,
      JSON.stringify(metadata),
    );

    return {
      ...metadata,
      client_id: clientId,
      client_secret,
      client_secret_expires_at,
      client_id_issued_at: issuedAt,
    };
  }
}

export class SondeOAuthProvider implements OAuthServerProvider {
  private _clientsStore: SondeClientsStore;

  constructor(private db: SondeDb) {
    this._clientsStore = new SondeClientsStore(db);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Auto-approve: generate code, store, redirect immediately
    const code = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db.insertOAuthCode(
      code,
      client.client_id,
      params.codeChallenge,
      params.redirectUri,
      JSON.stringify(params.scopes ?? []),
      params.resource?.toString() ?? null,
      now,
      now + CODE_TTL_SECONDS,
    );

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (params.state) {
      redirectUrl.searchParams.set('state', params.state);
    }

    res.redirect(redirectUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = this.db.getOAuthCode(authorizationCode);
    if (!row) {
      throw new InvalidGrantError('Unknown authorization code');
    }
    return row.challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const row = this.db.getOAuthCode(authorizationCode);
    if (!row) {
      throw new InvalidGrantError('Unknown authorization code');
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > row.expires_at) {
      this.db.deleteOAuthCode(authorizationCode);
      throw new InvalidGrantError('Authorization code expired');
    }

    if (row.client_id !== client.client_id) {
      throw new InvalidGrantError('Client mismatch');
    }

    // Consume code (one-time use)
    this.db.deleteOAuthCode(authorizationCode);

    // Generate access token
    const accessToken = crypto.randomUUID();
    const scopes: string[] = JSON.parse(row.scopes_json);

    this.db.insertOAuthToken(
      accessToken,
      client.client_id,
      JSON.stringify(scopes),
      resource?.toString() ?? row.resource ?? null,
      now,
      now + TOKEN_TTL_SECONDS,
    );

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: scopes.join(' '),
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new InvalidGrantError('Refresh tokens not supported');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db.getOAuthToken(token);
    if (!row) {
      throw new InvalidTokenError('Unknown token');
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > row.expires_at) {
      this.db.deleteOAuthToken(token);
      throw new InvalidTokenError('Token expired');
    }

    const scopes: string[] = JSON.parse(row.scopes_json);

    return {
      token,
      clientId: row.client_id,
      scopes,
      expiresAt: row.expires_at,
      resource: row.resource ? new URL(row.resource) : undefined,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.db.deleteOAuthToken(request.token);
  }
}
