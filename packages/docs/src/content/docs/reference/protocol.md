---
title: Protocol Reference
---

The WebSocket protocol between hub and agents uses JSON message envelopes. All messages conform to Zod schemas defined in `@sonde/shared`.

## Message Envelope

Every message follows this structure:

```typescript
{
  id: string          // UUID v4
  type: string        // message type (see table below)
  timestamp: string   // ISO 8601
  agentId?: string    // set after registration
  signature: string   // RSA-SHA256 payload signature (empty string if unsigned)
  payload: object     // type-specific data
}
```

## Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `agent.register` | Agent -> Hub | Register with name, OS, version, packs, attestation |
| `hub.ack` | Hub -> Agent | Acknowledge registration, assign agentId |
| `hub.reject` | Hub -> Agent | Reject registration with reason |
| `agent.heartbeat` | Agent -> Hub | Keep-alive signal (every 30 seconds) |
| `probe.request` | Hub -> Agent | Execute a probe |
| `probe.response` | Agent -> Hub | Probe result (success) |
| `probe.error` | Agent -> Hub | Probe failure |
| `hub.update_available` | Hub -> Agent | Notify agent of a new version |

## Registration

### `agent.register` Payload

```typescript
{
  name: string              // human-readable agent name
  hostname: string          // machine hostname
  os: string                // e.g. "linux", "darwin"
  osVersion: string         // e.g. "Ubuntu 22.04"
  arch: string              // e.g. "x64", "arm64"
  version: string           // agent version
  packs: string[]           // loaded pack names
  capabilities: string[]    // available probe names
  attestation: {
    binaryHash: string      // SHA-256 of agent binary
    configHash: string      // SHA-256 of agent config
    osFingerprint: string   // OS version + kernel
  }
}
```

### `hub.ack` Payload

```typescript
{
  agentId: string           // assigned UUID (stable across re-enrollments by name)
  apiKey?: string           // scoped API key (only on token-based enrollment)
}
```

### `hub.reject` Payload

```typescript
{
  reason: string            // human-readable rejection reason
}
```

## Probes

### `probe.request` Payload

```typescript
{
  probe: string                     // fully qualified name, e.g. "system.disk.usage"
  params?: Record<string, unknown>  // probe-specific parameters
  timeout: number                   // milliseconds (default: 30000)
  requestedBy: string               // "api" or a runbook ID
  requestId: string                 // UUID for concurrent correlation
}
```

### `probe.response` Payload

```typescript
{
  probe: string
  status: "success" | "error" | "timeout" | "unauthorized"
  data: object              // structured result (probe-specific)
  durationMs: number        // execution time in milliseconds
  requestId?: string        // echoed back for correlation
  metadata: {
    agentVersion: string
    packName: string
    packVersion: string
    capabilityLevel: "observe" | "interact" | "manage"
  }
}
```

### `probe.error` Payload

```typescript
{
  probe: string
  error: string             // error message
  code?: string             // error code (e.g. "PROBE_NOT_FOUND", "TIMEOUT")
  requestId?: string        // echoed back for correlation
}
```

## Concurrent Probe Correlation

Multiple probes can execute simultaneously on a single agent. The `requestId` field in `probe.request` is echoed back in the corresponding response, allowing the hub to match responses to pending requests.

The hub maintains a `Map<requestId, PendingRequest>` for each agent. When a response arrives, it is matched by `requestId` and the pending promise is resolved.

Agents that do not include a `requestId` in their response fall back to first-match-by-agentId behavior (for backward compatibility).

## Heartbeats

Agents send `agent.heartbeat` messages every 30 seconds. The hub uses heartbeat timing to determine agent connectivity status. If no heartbeat is received within the expected window, the agent is marked as offline.

## Payload Signing

Messages can be signed using RSA-SHA256:

1. Serialize the `payload` object: `JSON.stringify(payload)`
2. Sign the serialized string with the sender's RSA private key
3. Set the `signature` field to the resulting base64 string
4. The receiver verifies against the sender's public key or certificate

When signing is not configured, the `signature` field is an empty string.
