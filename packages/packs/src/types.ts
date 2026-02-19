import type { PackManifest } from '@sonde/shared';

/** Function that executes a command and returns stdout */
export type ExecFn = (command: string, args: string[]) => Promise<string>;

/** Probe handler: takes params + exec helper, returns structured data */
export type ProbeHandler = (
  params: Record<string, unknown> | undefined,
  exec: ExecFn,
) => Promise<unknown>;

/** A loaded pack with its manifest and probe handlers */
export interface Pack {
  manifest: PackManifest;
  handlers: Record<string, ProbeHandler>;
}

// --- Diagnostic runbook types ---

/** Structured finding from diagnostic runbook analysis */
export interface DiagnosticFinding {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  remediation?: string;
  relatedProbes: string[];
}

/** Result from a single probe within a diagnostic runbook */
export interface RunbookProbeResult {
  probe: string;
  status: 'success' | 'error' | 'timeout';
  data?: unknown;
  durationMs: number;
  error?: string;
}

/** Function to execute a probe — injected, mockable in tests */
export type RunProbe = (
  probe: string,
  params?: Record<string, unknown>,
  agent?: string,
) => Promise<RunbookProbeResult>;

/** Context available to diagnostic runbook handlers */
export interface RunbookContext {
  connectedAgents: string[];
}

/** Result of a diagnostic runbook execution */
export interface DiagnosticRunbookResult {
  category: string;
  findings: DiagnosticFinding[];
  probeResults: Record<string, RunbookProbeResult>;
  summary: {
    probesRun: number;
    probesSucceeded: number;
    probesFailed: number;
    findingsCount: { info: number; warning: number; critical: number };
    durationMs: number;
    summaryText: string;
  };
}

/** Handler function for a diagnostic runbook */
export type DiagnosticRunbookHandler = (
  params: Record<string, unknown>,
  runProbe: RunProbe,
  context: RunbookContext,
) => Promise<DiagnosticRunbookResult>;

/** Registered diagnostic runbook definition */
export interface DiagnosticRunbookDefinition {
  category: string;
  description: string;
  params?: Record<string, { type: string; description: string; required?: boolean }>;
  handler: DiagnosticRunbookHandler;
}
