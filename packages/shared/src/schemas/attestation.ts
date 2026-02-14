import { z } from 'zod';

export const AttestationData = z.object({
  /** e.g. "linux 6.1.0 x64" */
  osVersion: z.string(),
  /** SHA-256 hex of the agent binary (process.argv[1]) */
  binaryHash: z.string(),
  /** Packs loaded by this agent */
  installedPacks: z.array(z.object({ name: z.string(), version: z.string() })),
  /** SHA-256 hex of sanitised config (minus apiKey/enrollmentToken) */
  configHash: z.string(),
  /** e.g. "v22.0.0" */
  nodeVersion: z.string(),
});
export type AttestationData = z.infer<typeof AttestationData>;
