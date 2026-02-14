import crypto from 'node:crypto';

export interface AgentAuditEntry {
  timestamp: string;
  probe: string;
  status: string;
  durationMs: number;
  prevHash: string;
}

const DEFAULT_CAPACITY = 1000;

export class AgentAuditLog {
  private entries: AgentAuditEntry[] = [];
  private capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  log(probe: string, status: string, durationMs: number): void {
    const prevHash =
      this.entries.length > 0
        ? crypto
            .createHash('sha256')
            .update(JSON.stringify(this.entries[this.entries.length - 1]))
            .digest('hex')
        : '';

    const entry: AgentAuditEntry = {
      timestamp: new Date().toISOString(),
      probe,
      status,
      durationMs,
      prevHash,
    };

    this.entries.push(entry);

    // Ring buffer: drop oldest when over capacity
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  getRecent(n?: number): AgentAuditEntry[] {
    if (n === undefined) return [...this.entries];
    return this.entries.slice(-n);
  }

  verifyChain(): { valid: boolean; brokenAt?: number } {
    if (this.entries.length === 0) return { valid: true };

    const first = this.entries[0];
    if (first && first.prevHash !== '') {
      return { valid: false, brokenAt: 0 };
    }

    for (let i = 1; i < this.entries.length; i++) {
      const prev = this.entries[i - 1] as AgentAuditEntry;
      const curr = this.entries[i] as AgentAuditEntry;
      const expectedHash = crypto.createHash('sha256').update(JSON.stringify(prev)).digest('hex');
      if (curr.prevHash !== expectedHash) {
        return { valid: false, brokenAt: i };
      }
    }

    return { valid: true };
  }
}
