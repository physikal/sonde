import { z } from 'zod';
import { AgentStatus, PackStatus } from './common.js';

export const AgentPackInfo = z.object({
  name: z.string(),
  version: z.string(),
  status: PackStatus,
});
export type AgentPackInfo = z.infer<typeof AgentPackInfo>;

export const AgentInfo = z.object({
  id: z.string(),
  name: z.string(),
  status: AgentStatus,
  lastSeen: z.string().datetime(),
  packs: z.array(AgentPackInfo),
  os: z.string(),
  agentVersion: z.string(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;
