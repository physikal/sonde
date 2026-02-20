import crypto from 'node:crypto';
import type http from 'node:http';
import type { SondeDb } from './db/index.js';
import type { AuthContext } from './engine/policy.js';

/** Extract API key from Authorization header or query param */
export function extractApiKey(req: http.IncomingMessage): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return url.searchParams.get('apiKey') ?? '';
}

/** SHA-256 hex hash of a raw API key */
export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Validate an incoming request against API key auth.
 *
 * 1. Extract bearer token
 * 2. Hash → lookup in api_keys table → check not expired/revoked → return with policy
 * 3. Else undefined (caller should check OAuth next)
 */
export function validateAuth(req: http.IncomingMessage, db: SondeDb): AuthContext | undefined {
  const token = extractApiKey(req);
  if (!token) return undefined;

  // Scoped key lookup
  const keyHash = hashApiKey(token);
  const record = db.getApiKeyByHash(keyHash);
  if (!record) return undefined;

  // Check revoked
  if (record.revokedAt) return undefined;

  // Check expired
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) return undefined;

  const policy = JSON.parse(record.policyJson);
  return { type: 'api_key', keyId: record.id, keyName: record.name, policy };
}
