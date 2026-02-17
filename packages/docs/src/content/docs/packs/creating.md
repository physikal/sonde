---
title: Creating a Pack
---

This guide walks through creating a custom pack from scratch. By the end, you will have a manifest, probe handlers, tests, and a registered pack ready for use.

## Pack structure

Every pack lives under `packages/packs/src/<name>/` and follows this layout:

```
packages/packs/src/<name>/
  manifest.ts          # Pack metadata, requirements, probe definitions
  index.ts             # Wires manifest to handlers, exports the Pack object
  probes/
    <probe-name>.ts       # Probe handler implementation
    <probe-name>.test.ts  # Tests with mocked exec
```

## Step 1: Define the manifest

The manifest declares everything about your pack: what it is, what it needs, and what probes it provides. Create `packages/packs/src/<name>/manifest.ts`:

```typescript
import type { PackManifest } from '@sonde/shared';

export const mypackManifest: PackManifest = {
  name: 'mypack',
  version: '0.1.0',
  description: 'Probes for MyService health and metrics',
  requires: {
    groups: [],
    files: [],
    commands: ['myservice-cli'],
  },
  probes: [
    {
      name: 'status',
      description: 'Get MyService status and version',
      capability: 'observe',
      timeout: 10_000,
    },
    {
      name: 'metrics',
      description: 'Get MyService performance metrics',
      capability: 'observe',
      params: {
        host: {
          type: 'string',
          description: 'Service host',
          required: false,
          default: 'localhost',
        },
        port: {
          type: 'number',
          description: 'Service port',
          required: false,
          default: 9000,
        },
      },
      timeout: 15_000,
    },
  ],
  runbook: {
    category: 'mypack',
    probes: ['status', 'metrics'],
    parallel: true,
  },
  detect: {
    commands: ['myservice-cli'],
  },
};
```

### Manifest fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique pack name. Used as a prefix for probe names. |
| `version` | string | yes | Semver version (e.g., `0.1.0`). |
| `description` | string | yes | Human-readable description. |
| `requires.commands` | string[] | no | Binaries that must exist in PATH. |
| `requires.files` | string[] | no | File paths that must exist. |
| `requires.groups` | string[] | no | OS groups the agent user must belong to. |
| `probes` | ProbeDefinition[] | yes | Array of probe definitions (see below). |
| `runbook` | object | no | Default diagnostic workflow. |
| `detect` | object | no | Auto-detection rules (commands, files, services). |

### Probe definition fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Probe name (combined with pack name as `<pack>.<name>`). |
| `description` | string | yes | What this probe does. |
| `capability` | string | yes | One of `observe`, `interact`, or `manage`. |
| `params` | object | no | Parameter definitions with type, description, required, and default. |
| `timeout` | number | no | Timeout in milliseconds (default: 30000). |

### Probe naming convention

Probe names follow the pattern `<pack>.<category>.<action>`. For example:

- `system.disk.usage`
- `docker.containers.list`
- `nginx.error.log.tail`

The pack name prefix is added automatically when registering handlers. In the manifest, you only define the portion after the pack name (e.g., `disk.usage`, not `system.disk.usage`).

## Step 2: Implement probe handlers

Each probe handler is an async function with the signature:

```typescript
async function handler(
  params: Record<string, unknown> | undefined,
  exec: ExecFn,
): Promise<unknown>
```

The `exec` function is injected by the agent runtime. It runs a command and returns stdout as a string. This design makes handlers easy to test by mocking `exec`.

Create `packages/packs/src/<name>/probes/status.ts`:

```typescript
import type { ProbeHandler } from '../../types.js';

export interface StatusResult {
  version: string;
  uptime: number;
  status: string;
}

export const status: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('myservice-cli', ['status', '--json']);
  return parseStatusOutput(stdout);
};

export function parseStatusOutput(stdout: string): StatusResult {
  const data = JSON.parse(stdout);
  return {
    version: String(data.version),
    uptime: Number(data.uptime_seconds),
    status: String(data.status),
  };
}
```

Key principles:

- **Always return structured data.** Parse command output into typed objects. Never return raw strings.
- **Export the parser separately.** This lets tests exercise the parsing logic directly with sample data.
- **Use the injected `exec`.** Never import `child_process` or call commands directly.
- **Handle edge cases.** Validate parsed values, skip malformed lines, and provide sensible defaults.

### Real example: system.disk.usage

Here is the actual implementation from the system pack for reference:

```typescript
import type { ProbeHandler } from '../../types.js';

export interface FilesystemUsage {
  filesystem: string;
  sizeKb: number;
  usedKb: number;
  availableKb: number;
  usePct: number;
  mountedOn: string;
}

export interface DiskUsageResult {
  filesystems: FilesystemUsage[];
}

export const diskUsage: ProbeHandler = async (_params, exec) => {
  const stdout = await exec('df', ['-kP']);
  return parseDfOutput(stdout);
};

export function parseDfOutput(stdout: string): DiskUsageResult {
  const lines = stdout.trim().split('\n');
  const dataLines = lines.slice(1); // Skip header

  const filesystems: FilesystemUsage[] = [];

  for (const line of dataLines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const [filesystem, sizeStr, usedStr, availStr, pctStr, mountedOn] = parts;
    if (!filesystem || !sizeStr || !usedStr || !availStr || !pctStr || !mountedOn) continue;

    // Skip pseudo-filesystems
    if (filesystem === 'tmpfs' || filesystem === 'devtmpfs' || filesystem === 'none') continue;

    const sizeKb = Number(sizeStr);
    const usedKb = Number(usedStr);
    const availableKb = Number(availStr);
    const usePct = Number.parseInt(pctStr.replace('%', ''), 10);

    if (Number.isNaN(sizeKb) || Number.isNaN(usedKb)) continue;

    filesystems.push({ filesystem, sizeKb, usedKb, availableKb, usePct, mountedOn });
  }

  return { filesystems };
}
```

## Step 3: Wire up the pack

Create `packages/packs/src/<name>/index.ts` to connect the manifest with the handlers:

```typescript
import type { Pack } from '../types.js';
import { mypackManifest } from './manifest.js';
import { status } from './probes/status.js';
import { metrics } from './probes/metrics.js';

export const mypackPack: Pack = {
  manifest: mypackManifest,
  handlers: {
    'mypack.status': status,
    'mypack.metrics': metrics,
  },
};
```

Handler keys must follow the format `<packName>.<probeName>` where `<probeName>` matches the `name` field in the manifest probe definition. The pack registry validates that every manifest probe has a corresponding handler and that no extra handlers exist.

## Step 4: Register in the pack registry

Add your pack to `packages/packs/src/index.ts`:

```typescript
import { mypackPack } from './mypack/index.js';

// Add to imports, exports, and the registry array:
export { mypackPack } from './mypack/index.js';

export const packRegistry: ReadonlyMap<string, Pack> = createPackRegistry(
  injectSignatures([
    systemPack, dockerPack, systemdPack, nginxPack,
    postgresPack, redisPack, mysqlPack, mypackPack,
  ]),
  { allowUnsignedPacks: true },
);
```

## Step 5: Write tests

Tests mock the `exec` function to simulate command output. Create `packages/packs/src/<name>/probes/status.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { ExecFn } from '../../types.js';
import type { StatusResult } from './status.js';
import { status, parseStatusOutput } from './status.js';

const SAMPLE_OUTPUT = JSON.stringify({
  version: '2.4.1',
  uptime_seconds: 86400,
  status: 'healthy',
});

describe('parseStatusOutput', () => {
  it('parses JSON status output', () => {
    const result = parseStatusOutput(SAMPLE_OUTPUT);

    expect(result).toEqual({
      version: '2.4.1',
      uptime: 86400,
      status: 'healthy',
    });
  });
});

describe('status handler', () => {
  it('calls myservice-cli and returns parsed result', async () => {
    const mockExec: ExecFn = async (cmd, args) => {
      expect(cmd).toBe('myservice-cli');
      expect(args).toEqual(['status', '--json']);
      return SAMPLE_OUTPUT;
    };

    const result = (await status(undefined, mockExec)) as StatusResult;
    expect(result.version).toBe('2.4.1');
    expect(result.uptime).toBe(86400);
    expect(result.status).toBe('healthy');
  });
});
```

Run tests with:

```bash
npx vitest packages/packs/src/mypack/
```

## Step 6: Detection rules

The `detect` block in your manifest tells the agent how to auto-discover your software. You can check for:

```typescript
detect: {
  // Check if commands exist in PATH
  commands: ['myservice-cli'],
  // Check if files exist on the filesystem
  files: ['/etc/myservice/config.yml'],
  // Check if systemd services exist
  services: ['myservice.service'],
},
```

If any of the specified checks pass, the agent considers the pack relevant for the host and activates it.

## Checklist

Before shipping your pack:

- [ ] Manifest has a unique `name`, valid semver `version`, and descriptive `description`
- [ ] All probes declare a `capability` level (use `observe` for read-only operations)
- [ ] `requires.commands` lists every binary the probes need
- [ ] Handler keys match `<packName>.<probeName>` exactly
- [ ] `detect` block enables auto-discovery on target machines
- [ ] Probe handlers return structured JSON, not raw strings
- [ ] The `exec` function is used for all command execution (no direct `child_process`)
- [ ] Parser functions are exported separately for direct testing
- [ ] Tests cover happy path, edge cases, and malformed output
- [ ] Pack validates successfully (`createPackRegistry` does not throw)
