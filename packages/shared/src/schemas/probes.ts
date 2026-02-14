import { z } from 'zod';
import { CapabilityLevel, DEFAULT_PROBE_TIMEOUT_MS, ProbeStatus } from '../types/common.js';

/**
 * Probe request descriptor (Hub → Agent).
 */
export const ProbeRequest = z.object({
  /** Fully qualified probe name, e.g. "docker.containers.list" */
  probe: z.string(),
  /** Probe-specific parameters */
  params: z.record(z.unknown()).optional(),
  /** Max time for probe execution in ms */
  timeout: z.number().default(DEFAULT_PROBE_TIMEOUT_MS),
  /** API key ID or OAuth client ID that initiated the request */
  requestedBy: z.string(),
  /** Set if this probe is part of a runbook execution */
  runbookId: z.string().optional(),
});
export type ProbeRequest = z.infer<typeof ProbeRequest>;

/**
 * Probe response (Agent → Hub).
 */
export const ProbeResponse = z.object({
  /** Echo back which probe ran */
  probe: z.string(),
  /** Result status */
  status: ProbeStatus,
  /** Probe-specific result data (already scrubbed) */
  data: z.unknown(),
  /** How long execution took in ms */
  durationMs: z.number(),
  /** Metadata about the agent/pack that executed the probe */
  metadata: z.object({
    agentVersion: z.string(),
    packName: z.string(),
    packVersion: z.string(),
    capabilityLevel: CapabilityLevel,
  }),
});
export type ProbeResponse = z.infer<typeof ProbeResponse>;
