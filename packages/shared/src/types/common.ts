import { z } from 'zod';

export const CapabilityLevel = z.enum(['observe', 'interact', 'manage']);
export type CapabilityLevel = z.infer<typeof CapabilityLevel>;

export const AgentStatus = z.enum(['online', 'offline', 'degraded']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const PackStatus = z.enum(['active', 'pending', 'error']);
export type PackStatus = z.infer<typeof PackStatus>;

export const ProbeStatus = z.enum(['success', 'error', 'timeout', 'unauthorized']);
export type ProbeStatus = z.infer<typeof ProbeStatus>;

export const MessageType = z.enum([
  'probe.request',
  'probe.response',
  'probe.error',
  'agent.register',
  'agent.heartbeat',
  'hub.ack',
  'hub.reject',
]);
export type MessageType = z.infer<typeof MessageType>;

/** Default probe timeout in milliseconds */
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

/** Default hub port */
export const DEFAULT_HUB_PORT = 3000;

/** Agent heartbeat interval in milliseconds */
export const HEARTBEAT_INTERVAL_MS = 30_000;
