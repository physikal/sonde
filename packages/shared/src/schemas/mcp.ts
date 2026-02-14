import { z } from 'zod';
import { AgentInfo } from '../types/agent.js';

/**
 * Input schema for the `probe` MCP tool.
 * MVP's primary MCP tool — sends a single probe to an agent.
 */
export const ProbeInput = z.object({
  /** Agent name or ID */
  agent: z.string(),
  /** Full probe name, e.g. "system.disk.usage" */
  probe: z.string(),
  /** Probe-specific parameters */
  params: z.record(z.unknown()).optional(),
});
export type ProbeInput = z.infer<typeof ProbeInput>;

/**
 * Input schema for the `diagnose` MCP tool (post-MVP).
 */
export const DiagnoseInput = z.object({
  /** Agent name or ID */
  agent: z.string(),
  /** Pack category, e.g. "docker", "system" */
  category: z.string(),
  /** Natural language problem description */
  description: z.string().optional(),
});
export type DiagnoseInput = z.infer<typeof DiagnoseInput>;

/**
 * Output schema for the `diagnose` MCP tool (post-MVP).
 */
export const DiagnoseOutput = z.object({
  agent: z.string(),
  timestamp: z.string().datetime(),
  category: z.string(),
  runbookId: z.string(),
  /** Keyed by probe name → result */
  findings: z.record(z.unknown()),
  summary: z.object({
    probesRun: z.number(),
    probesSucceeded: z.number(),
    probesFailed: z.number(),
    durationMs: z.number(),
  }),
});
export type DiagnoseOutput = z.infer<typeof DiagnoseOutput>;

/**
 * Output schema for the `list_agents` MCP tool.
 */
export const ListAgentsOutput = z.object({
  agents: z.array(AgentInfo),
});
export type ListAgentsOutput = z.infer<typeof ListAgentsOutput>;
