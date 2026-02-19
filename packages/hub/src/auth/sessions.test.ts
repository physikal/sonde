import { afterEach, describe, expect, it } from 'vitest';
import { SondeDb } from '../db/index.js';
import { SessionManager } from './sessions.js';

describe('SessionManager', () => {
  let db: SondeDb;
  let sm: SessionManager;

  afterEach(() => {
    sm.stopCleanupLoop();
    db.close();
  });

  function setup() {
    db = new SondeDb(':memory:');
    sm = new SessionManager(db);
  }

  it('creates a session and retrieves the user context', () => {
    setup();
    const id = sm.createSession({
      authMethod: 'local',
      userId: 'local:admin',
      displayName: 'Admin',
      role: 'owner',
    });

    expect(id).toHaveLength(64); // 32 bytes hex

    const user = sm.getSession(id);
    expect(user).not.toBeNull();
    expect(user?.id).toBe('local:admin');
    expect(user?.displayName).toBe('Admin');
    expect(user?.role).toBe('owner');
    expect(user?.authMethod).toBe('local');
  });

  it('returns null for unknown session id', () => {
    setup();
    expect(sm.getSession('nonexistent')).toBeNull();
  });

  it('returns null and deletes an expired session', () => {
    setup();
    const id = sm.createSession({
      authMethod: 'local',
      userId: 'local:admin',
      displayName: 'Admin',
      role: 'owner',
    });

    // Manually expire the session by setting expires_at in the past
    db.touchSession(id, new Date(Date.now() - 1000).toISOString());

    const user = sm.getSession(id);
    expect(user).toBeNull();
  });

  it('touchSession extends the expiry (sliding window)', () => {
    setup();
    const id = sm.createSession({
      authMethod: 'local',
      userId: 'local:admin',
      displayName: 'Admin',
      role: 'owner',
    });

    // Touch extends it
    sm.touchSession(id);

    // Session should still be valid
    const user = sm.getSession(id);
    expect(user).not.toBeNull();
    expect(user?.displayName).toBe('Admin');
  });

  it('deleteSession removes the session', () => {
    setup();
    const id = sm.createSession({
      authMethod: 'local',
      userId: 'local:admin',
      displayName: 'Admin',
      role: 'owner',
    });

    sm.deleteSession(id);
    expect(sm.getSession(id)).toBeNull();
  });

  it('cleanExpiredSessions removes only expired sessions', () => {
    setup();
    const validId = sm.createSession({
      authMethod: 'local',
      userId: 'user:valid',
      displayName: 'Valid',
      role: 'member',
    });
    const expiredId = sm.createSession({
      authMethod: 'local',
      userId: 'user:expired',
      displayName: 'Expired',
      role: 'member',
    });

    // Manually expire one session
    db.touchSession(expiredId, new Date(Date.now() - 1000).toISOString());

    const cleaned = sm.cleanExpiredSessions();
    expect(cleaned).toBe(1);

    expect(sm.getSession(validId)).not.toBeNull();
    expect(sm.getSession(expiredId)).toBeNull();
  });

  it('startCleanupLoop and stopCleanupLoop manage the timer', () => {
    setup();
    sm.startCleanupLoop();
    // Starting again should not throw
    sm.startCleanupLoop();
    sm.stopCleanupLoop();
    // Stopping again should not throw
    sm.stopCleanupLoop();
  });

  it('stores optional email field', () => {
    setup();
    const id = sm.createSession({
      authMethod: 'sso',
      userId: 'entra:user123',
      displayName: 'Jane Doe',
      role: 'admin',
      email: 'jane@example.com',
    });

    const user = sm.getSession(id);
    expect(user).not.toBeNull();
    expect(user?.email).toBe('jane@example.com');
  });
});
