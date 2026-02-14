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
