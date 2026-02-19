import type http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { extractApiKey, hashApiKey, validateAuth } from './auth.js';
import type { SondeDb } from './db/index.js';

function createMockReq(headers: Record<string, string> = {}, url = '/'): http.IncomingMessage {
  return { headers, url } as unknown as http.IncomingMessage;
}

function createMockDb(
  keyRecord?:
    | {
        id: string;
        name: string;
        policyJson: string;
        expiresAt: string | null;
        revokedAt: string | null;
        roleId: string;
      }
    | undefined,
): SondeDb {
  return {
    getApiKeyByHash: vi.fn().mockReturnValue(keyRecord),
  } as unknown as SondeDb;
}

describe('extractApiKey', () => {
  it('extracts from Bearer header', () => {
    const req = createMockReq({ authorization: 'Bearer my-key' });
    expect(extractApiKey(req)).toBe('my-key');
  });

  it('extracts from query param', () => {
    const req = createMockReq({}, '/?apiKey=query-key');
    expect(extractApiKey(req)).toBe('query-key');
  });

  it('returns empty string when no key present', () => {
    const req = createMockReq();
    expect(extractApiKey(req)).toBe('');
  });
});

describe('validateAuth', () => {
  it('returns undefined for empty token', () => {
    const db = createMockDb();
    const req = createMockReq();
    expect(validateAuth(req, db)).toBeUndefined();
  });

  it('returns auth context for valid DB key', () => {
    const keyRecord = {
      id: 'key-1',
      name: 'test-key',
      policyJson: '{"allowedAgents":["agent-1"]}',
      expiresAt: null,
      revokedAt: null,
      roleId: 'admin',
    };
    const db = createMockDb(keyRecord);
    const req = createMockReq({ authorization: 'Bearer some-raw-key' });

    const result = validateAuth(req, db);

    expect(result).toBeDefined();
    expect(result?.type).toBe('api_key');
    expect(result?.keyId).toBe('key-1');
    expect(result?.policy.allowedAgents).toEqual(['agent-1']);
  });

  it('returns undefined for revoked key', () => {
    const keyRecord = {
      id: 'key-1',
      name: 'test-key',
      policyJson: '{}',
      expiresAt: null,
      revokedAt: '2024-01-01T00:00:00Z',
      roleId: 'member',
    };
    const db = createMockDb(keyRecord);
    const req = createMockReq({ authorization: 'Bearer some-raw-key' });

    expect(validateAuth(req, db)).toBeUndefined();
  });

  it('returns undefined for expired key', () => {
    const keyRecord = {
      id: 'key-1',
      name: 'test-key',
      policyJson: '{}',
      expiresAt: '2020-01-01T00:00:00Z',
      revokedAt: null,
      roleId: 'member',
    };
    const db = createMockDb(keyRecord);
    const req = createMockReq({ authorization: 'Bearer some-raw-key' });

    expect(validateAuth(req, db)).toBeUndefined();
  });

  it('returns undefined when key not found in DB', () => {
    const db = createMockDb(undefined);
    const req = createMockReq({ authorization: 'Bearer unknown-key' });

    expect(validateAuth(req, db)).toBeUndefined();
  });
});

describe('hashApiKey', () => {
  it('produces consistent SHA-256 hex hash', () => {
    const hash1 = hashApiKey('test-key');
    const hash2 = hashApiKey('test-key');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('produces different hashes for different keys', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'));
  });
});
