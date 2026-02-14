import { z } from 'zod';
import { CapabilityLevel, DEFAULT_PROBE_TIMEOUT_MS } from '../types/common.js';

/** Parameter definition for a probe */
export const ProbeParamDef = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string(),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});
export type ProbeParamDef = z.infer<typeof ProbeParamDef>;

/** Database role access requirement */
export const DbRoleRequirement = z.object({
  type: z.enum(['postgres', 'mysql', 'mongodb']),
  access: z.enum(['read-only', 'read-write']),
});
export type DbRoleRequirement = z.infer<typeof DbRoleRequirement>;

/** System access requirements for a pack */
export const PackRequirements = z.object({
  /** OS groups needed */
  groups: z.array(z.string()).default([]),
  /** File paths needed (glob OK) */
  files: z.array(z.string()).default([]),
  /** Binaries that must exist in PATH */
  commands: z.array(z.string()).default([]),
  /** Database access if needed */
  dbRole: DbRoleRequirement.optional(),
});
export type PackRequirements = z.infer<typeof PackRequirements>;

/** Probe definition within a pack */
export const ProbeDefinition = z.object({
  /** Probe name, e.g. "containers.list" */
  name: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Capability level required to execute */
  capability: CapabilityLevel,
  /** Parameter definitions */
  params: z.record(ProbeParamDef).optional(),
  /** Probe timeout in ms */
  timeout: z.number().default(DEFAULT_PROBE_TIMEOUT_MS),
});
export type ProbeDefinition = z.infer<typeof ProbeDefinition>;

/** Runbook definition (diagnostic workflow) */
export const RunbookDefinition = z.object({
  /** Category this runbook covers, e.g. "docker" */
  category: z.string(),
  /** Ordered list of probe names to run */
  probes: z.array(z.string()),
  /** Whether to run probes in parallel */
  parallel: z.boolean().default(true),
});
export type RunbookDefinition = z.infer<typeof RunbookDefinition>;

/** Detection rules for auto-discovering installed software */
export const DetectRules = z.object({
  /** Check if these commands exist in PATH */
  commands: z.array(z.string()).optional(),
  /** Check if these files exist */
  files: z.array(z.string()).optional(),
  /** Check if these systemd services exist */
  services: z.array(z.string()).optional(),
});
export type DetectRules = z.infer<typeof DetectRules>;

/**
 * Full pack manifest schema.
 * Defines a pack's metadata, requirements, probes, runbook, and detection rules.
 */
export const PackManifest = z.object({
  /** Pack name, e.g. "docker" */
  name: z.string(),
  /** Semver version */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Human-readable description */
  description: z.string(),
  /** Pack author */
  author: z.string().optional(),
  /** Code signature (base64) */
  signature: z.string().optional(),
  /** System access requirements */
  requires: PackRequirements,
  /** Probes this pack provides */
  probes: z.array(ProbeDefinition),
  /** Default diagnostic runbook */
  runbook: RunbookDefinition.optional(),
  /** Rules for auto-detecting this software on the system */
  detect: DetectRules.optional(),
});
export type PackManifest = z.infer<typeof PackManifest>;
