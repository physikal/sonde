# Sonde Protocol Schemas

All schemas defined in Zod in `@sonde/shared`.

## WebSocket Message Envelope

All agent ↔ hub communication uses this envelope:

```typescript
// @sonde/shared/src/schemas/protocol.ts

const MessageEnvelope = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'probe.request',        // Hub → Agent: run a probe
    'probe.response',       // Agent → Hub: probe result
    'probe.error',          // Agent → Hub: probe failed
    'agent.register',       // Agent → Hub: initial registration
    'agent.heartbeat',      // Agent → Hub: I'm alive + capabilities
    'hub.ack',              // Hub → Agent: registration accepted
    'hub.reject',           // Hub → Agent: registration rejected
  ]),
  timestamp: z.string().datetime(),
  agentId: z.string().optional(),
  signature: z.string(),
  payload: z.unknown(),
});
```

## Probe Request (Hub → Agent)

```typescript
const ProbeRequest = z.object({
  probe: z.string(),                       // e.g., "docker.containers.list"
  params: z.record(z.unknown()).optional(),
  timeout: z.number().default(30000),
  requestedBy: z.string(),                 // API key ID or OAuth client ID
  runbookId: z.string().optional(),
});
```

## Probe Response (Agent → Hub)

```typescript
const ProbeResponse = z.object({
  probe: z.string(),
  status: z.enum(['success', 'error', 'timeout', 'unauthorized']),
  data: z.unknown(),
  durationMs: z.number(),
  metadata: z.object({
    agentVersion: z.string(),
    packName: z.string(),
    packVersion: z.string(),
    capabilityLevel: z.enum(['observe', 'interact', 'manage']),
  }),
});
```

## Pack Manifest

```typescript
const PackManifest = z.object({
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  author: z.string().optional(),
  signature: z.string().optional(),

  requires: z.object({
    groups: z.array(z.string()).default([]),
    files: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([]),
    dbRole: z.object({
      type: z.enum(['postgres', 'mysql', 'mongodb']),
      access: z.enum(['read-only', 'read-write']),
    }).optional(),
  }),

  probes: z.array(z.object({
    name: z.string(),
    description: z.string(),
    capability: z.enum(['observe', 'interact', 'manage']),
    params: z.record(z.object({
      type: z.enum(['string', 'number', 'boolean']),
      description: z.string(),
      required: z.boolean().default(false),
      default: z.unknown().optional(),
    })).optional(),
    timeout: z.number().default(30000),
  })),

  runbook: z.object({
    category: z.string(),
    probes: z.array(z.string()),
    parallel: z.boolean().default(true),
  }).optional(),

  detect: z.object({
    commands: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    services: z.array(z.string()).optional(),
  }).optional(),
});
```

## MCP Tool Schemas

```typescript
const DiagnoseInput = z.object({
  agent: z.string(),
  category: z.string(),
  description: z.string().optional(),
});

const DiagnoseOutput = z.object({
  agent: z.string(),
  timestamp: z.string().datetime(),
  category: z.string(),
  runbookId: z.string(),
  findings: z.record(z.unknown()),
  summary: z.object({
    probesRun: z.number(),
    probesSucceeded: z.number(),
    probesFailed: z.number(),
    durationMs: z.number(),
  }),
});

const ProbeInput = z.object({
  agent: z.string(),
  probe: z.string(),
  params: z.record(z.unknown()).optional(),
});

const ListAgentsOutput = z.object({
  agents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['online', 'offline', 'degraded']),
    lastSeen: z.string().datetime(),
    packs: z.array(z.object({
      name: z.string(),
      version: z.string(),
      status: z.enum(['active', 'pending', 'error']),
    })),
    os: z.string(),
    agentVersion: z.string(),
  })),
});
```
