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
