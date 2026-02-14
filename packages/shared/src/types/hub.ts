import { z } from 'zod';
import { DEFAULT_HUB_PORT } from './common.js';

export const HubConfig = z.object({
  /** Port the hub listens on */
  port: z.number().int().positive().default(DEFAULT_HUB_PORT),
  /** Hostname to bind to */
  host: z.string().default('0.0.0.0'),
  /** API key for authenticating MCP clients and agents (MVP: single key) */
  apiKey: z.string().min(1),
  /** Path to SQLite database file */
  dbPath: z.string().default('./sonde.db'),
  /** Log level */
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type HubConfig = z.infer<typeof HubConfig>;
