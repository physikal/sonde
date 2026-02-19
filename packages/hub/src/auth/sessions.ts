import crypto from 'node:crypto';
import type { SessionRow, SondeDb } from '../db/index.js';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface UserContext {
  id: string;
  displayName: string;
  role: string;
  authMethod: string;
  email?: string | null;
}

export interface CreateSessionInput {
  authMethod: string;
  userId: string;
  email?: string | null;
  displayName: string;
  role: string;
}

export class SessionManager {
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(private db: SondeDb) {}

  createSession(input: CreateSessionInput): string {
    const id = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    this.db.createSession({
      id,
      authMethod: input.authMethod,
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      expiresAt,
    });

    return id;
  }

  getSession(id: string): UserContext | null {
    const row = this.db.getSession(id);
    if (!row) return null;

    // Check expiry
    if (new Date(row.expiresAt) < new Date()) {
      this.db.deleteSession(id);
      return null;
    }

    return {
      id: row.userId,
      displayName: row.displayName,
      role: row.role,
      authMethod: row.authMethod,
      email: row.email,
    };
  }

  touchSession(id: string): void {
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    this.db.touchSession(id, newExpiresAt);
  }

  deleteSession(id: string): void {
    this.db.deleteSession(id);
  }

  cleanExpiredSessions(): number {
    return this.db.cleanExpiredSessions();
  }

  startCleanupLoop(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanExpiredSessions();
    }, CLEANUP_INTERVAL_MS);
  }

  stopCleanupLoop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}
