import { z } from 'zod';
import { MessageType } from '../types/common.js';

/**
 * WebSocket message envelope.
 * All agent ↔ hub communication uses this envelope.
 */
export const MessageEnvelope = z.object({
  /** Unique message ID */
  id: z.string().uuid(),
  /** Message type discriminator */
  type: MessageType,
  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),
  /** Set after registration */
  agentId: z.string().optional(),
  /** Payload signature (base64) */
  signature: z.string(),
  /** Type-specific payload (validated per type) */
  payload: z.unknown(),
});
export type MessageEnvelope = z.infer<typeof MessageEnvelope>;

/**
 * Payload schema for agent.register messages.
 * Validates registration data before processing.
 */
export const RegisterPayload = z.object({
  name: z.string().min(1).max(255),
  os: z.string().min(1).max(255),
  agentVersion: z.string().min(1).max(64),
  packs: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      status: z.string().min(1),
    }),
  ),
  enrollmentToken: z.string().optional(),
  attestation: z.unknown().optional(),
});
export type RegisterPayload = z.infer<typeof RegisterPayload>;
