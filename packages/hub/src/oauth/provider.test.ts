import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { describe, expect, it } from 'vitest';
import { SondeDb } from '../db/index.js';
import { SondeOAuthProvider } from './provider.js';

function setup() {
  const db = new SondeDb(':memory:');
  const provider = new SondeOAuthProvider(db);
  return { db, provider };
}

const REDIRECT_URI = 'http://localhost:3000/callback';

function makeClientMetadata() {
  return {
    redirect_uris: [REDIRECT_URI],
    client_name: 'test-client',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  } as Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>;
}

function registerClient(provider: SondeOAuthProvider): OAuthClientInformationFull {
  // Our implementation is synchronous so we can cast directly
  return provider.clientsStore.registerClient?.(makeClientMetadata()) as OAuthClientInformationFull;
}

describe('SondeOAuthProvider', () => {
  it('registers a client and retrieves it by ID', () => {
    const { provider } = setup();

    const registered = registerClient(provider);
    expect(registered.client_id).toBeTruthy();
    expect(registered.client_name).toBe('test-client');

    const retrieved = provider.clientsStore.getClient(registered.client_id);
    expect(retrieved).toBeDefined();
  });

  it('authorize generates code that can be exchanged', async () => {
    const { provider } = setup();
    const client = registerClient(provider);

    // Simulate authorize
    let redirectedTo = '';
    const fakeRes = {
      redirect: (url: string) => {
        redirectedTo = url;
      },
    } as unknown as import('express').Response;

    await provider.authorize(
      client,
      {
        codeChallenge: 'test-challenge',
        redirectUri: REDIRECT_URI,
        scopes: ['mcp:tools'],
        state: 'state-abc',
      },
      fakeRes,
    );

    expect(redirectedTo).toContain('code=');
    expect(redirectedTo).toContain('state=state-abc');

    // Extract code from redirect URL
    const url = new URL(redirectedTo);
    const code = url.searchParams.get('code') ?? '';
    expect(code).toBeTruthy();

    // Challenge should be returned
    const challenge = await provider.challengeForAuthorizationCode(client, code);
    expect(challenge).toBe('test-challenge');

    // Exchange code for token
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBeGreaterThan(0);
  });

  it('expired code fails exchange', async () => {
    const { db, provider } = setup();
    const client = registerClient(provider);

    // Manually insert an expired code
    const now = Math.floor(Date.now() / 1000);
    db.insertOAuthCode(
      'expired-code',
      client.client_id,
      'challenge',
      REDIRECT_URI,
      '[]',
      null,
      now - 600,
      now - 300,
    );

    await expect(provider.exchangeAuthorizationCode(client, 'expired-code')).rejects.toThrow(
      'expired',
    );
  });

  it('valid token returns AuthInfo', async () => {
    const { provider } = setup();
    const client = registerClient(provider);

    let code = '';
    const fakeRes = {
      redirect: (url: string) => {
        code = new URL(url).searchParams.get('code') ?? '';
      },
    } as unknown as import('express').Response;

    await provider.authorize(
      client,
      {
        codeChallenge: 'c',
        redirectUri: REDIRECT_URI,
        scopes: ['mcp:tools'],
      },
      fakeRes,
    );

    const tokens = await provider.exchangeAuthorizationCode(client, code);
    const authInfo = await provider.verifyAccessToken(tokens.access_token);

    expect(authInfo.clientId).toBe(client.client_id);
    expect(authInfo.token).toBe(tokens.access_token);
    expect(authInfo.scopes).toContain('mcp:tools');
  });

  it('expired token throws', async () => {
    const { db, provider } = setup();
    const client = registerClient(provider);

    const now = Math.floor(Date.now() / 1000);
    db.insertOAuthToken('expired-token', client.client_id, '[]', null, now - 7200, now - 3600);

    await expect(provider.verifyAccessToken('expired-token')).rejects.toThrow('expired');
  });

  it('revoked token fails verification', async () => {
    const { provider } = setup();
    const client = registerClient(provider);

    let code = '';
    const fakeRes = {
      redirect: (url: string) => {
        code = new URL(url).searchParams.get('code') ?? '';
      },
    } as unknown as import('express').Response;

    await provider.authorize(
      client,
      {
        codeChallenge: 'c',
        redirectUri: REDIRECT_URI,
      },
      fakeRes,
    );

    const tokens = await provider.exchangeAuthorizationCode(client, code);
    await provider.revokeToken?.(client, { token: tokens.access_token });

    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
  });

  it('double exchange of same code fails', async () => {
    const { provider } = setup();
    const client = registerClient(provider);

    let code = '';
    const fakeRes = {
      redirect: (url: string) => {
        code = new URL(url).searchParams.get('code') ?? '';
      },
    } as unknown as import('express').Response;

    await provider.authorize(
      client,
      {
        codeChallenge: 'c',
        redirectUri: REDIRECT_URI,
      },
      fakeRes,
    );

    await provider.exchangeAuthorizationCode(client, code);
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow();
  });

  it('unknown token throws', async () => {
    const { provider } = setup();
    await expect(provider.verifyAccessToken('nonexistent')).rejects.toThrow('Unknown token');
  });
});
