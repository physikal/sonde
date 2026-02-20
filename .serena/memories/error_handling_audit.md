# Sonde Error Handling Patterns Audit

**Date:** 2025-02-18  
**Scope:** Comprehensive audit of error handling patterns across hub, agent, and shared packages

---

## 1. REST Route Handlers (packages/hub/src/index.ts)

### Pattern: Hono HTTP Response with `{ error: string }` format

**Files:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/hub/src/index.ts`

All REST endpoints use consistent error response format:

```typescript
return c.json({ error: 'message' }, statusCode);
```

#### Unique Error Response Formats Found:

**Format 1: Simple error string**
```typescript
c.json({ error: 'Unauthorized' }, 401)
c.json({ error: 'name is required' }, 400)
c.json({ error: 'Invalid role: ${role}' }, 400)
```

**Examples with exact line numbers:**

- **Line 245:** API key auth failure
  ```typescript
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  ```

- **Line 250-252:** Revoked/expired key check
  ```typescript
  if (!record || record.revokedAt) return c.json({ error: 'Unauthorized' }, 401);
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  ```

- **Line 303:** Missing required field
  ```typescript
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }
  ```

- **Line 308:** Invalid enum value
  ```typescript
  if (!VALID_ROLES.has(role)) {
    return c.json({ error: `Invalid role: ${role}` }, 400);
  }
  ```

- **Line 312:** Authorization check (RBAC)
  ```typescript
  if (caller && exceedsRole(caller.role, role)) {
    return c.json({ error: 'Cannot create key with role higher than your own' }, 403);
  }
  ```

- **Line 348:** Resource not found
  ```typescript
  if (!rotated) {
    return c.json({ error: 'API key not found or already revoked' }, 404);
  }
  ```

- **Line 456-459:** Constraint violation (UNIQUE key)
  ```typescript
  try {
    db.createAuthorizedUser(id, body.email, role);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'User with this email already exists' }, 409);
    }
    throw error;
  }
  ```

- **Line 991:** Probe execution error (from handleProbe result)
  ```typescript
  if (result.isError) {
    return c.json({ error: text }, 400);
  }
  ```

### HTTP Status Codes Used:
- **400** - Bad Request (missing fields, invalid values)
- **401** - Unauthorized (auth failures, invalid tokens)
- **403** - Forbidden (RBAC violations, access denied)
- **404** - Not Found (missing resources)
- **409** - Conflict (constraint violations, duplicates)
- **500** - Internal Server Error (install script failure only at line 1067)

### Try/Catch Pattern:
Routes use selective `try/catch` only for database operations that may throw (constraint violations):
- Line 453-460: User creation
- Line 529-534: Group creation
- Line 587-594: Access group creation
- Line 718-739: Integration creation
- Line 761-775: Integration creation (alternate endpoint)
- Line 734-738: Graph integration creation

All other routes validate input and check preconditions directly without try/catch.

---

## 2. Integration Executor (packages/hub/src/integrations/executor.ts)

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/hub/src/integrations/executor.ts`

### Error Handling Strategy:

Integration probes **never throw**. All errors are wrapped in a `ProbeResponse` object with status = 'error'.

### Error Response Format:

```typescript
{
  probe: string;
  status: 'error';
  data: null;
  durationMs: number;
  metadata: {
    agentVersion: 'hub';
    packName: string;
    packVersion: string;
    capabilityLevel: 'observe';
  };
  error: string;  // ← Error message field
} as ProbeResponse
```

### Exact Code (Lines 134-149):

```typescript
private errorResponse(probe: string, startTime: number, error: string): ProbeResponse {
  const packName = probe.split('.')[0] ?? 'unknown';
  return {
    probe,
    status: 'error',
    data: null,
    durationMs: Date.now() - startTime,
    metadata: {
      agentVersion: 'hub',
      packName,
      packVersion: '0.0.0',
      capabilityLevel: 'observe',
    },
    error,  // ← String message
  } as ProbeResponse;
}
```

### Error Cases Handled:

1. **Unknown pack** (Line 60-61):
   ```typescript
   if (!registered) {
     return this.errorResponse(probe, startTime, `Unknown integration pack: ${packName}`);
   }
   ```

2. **Unknown probe** (Line 68-69):
   ```typescript
   if (!handler) {
     return this.errorResponse(probe, startTime, `Unknown probe: ${probe}`);
   }
   ```

3. **Execution timeout/failure** (Line 77-132):
   ```typescript
   for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
     try {
       const data = await handler(params, config, credentials, fetchWithSignal);
       return { probe, status: 'success', data, ... };
     } catch (error) {
       lastError = error;
       // OAuth2 token refresh on 401 (attempt 0 only)
       if (attempt === 0 && error instanceof Response && error.status === 401 && ...) {
         const refreshed = await this.refreshOAuth2Token(credentials);
         if (refreshed) continue;
       }
       // Retry on network errors or 5xx status
       if (!isRetryable(error) || attempt === MAX_RETRIES - 1) break;
       // Exponential backoff
       await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
     }
   }
   
   const message = lastError instanceof Error ? lastError.message
                 : lastError instanceof DOMException ? lastError.message
                 : 'Integration probe failed';
   return this.errorResponse(probe, startTime, message);
   ```

### Retry Logic:
- **MAX_RETRIES = 3** (Line 10)
- **Retryable conditions** (Lines 19-24):
  - `TypeError` (network errors)
  - `DOMException` with name !== 'AbortError'
  - HTTP 5xx responses
- **Non-retryable**: 4xx responses, AbortError (timeout)
- **Exponential backoff**: `1s * 2^attempt` ms
- **OAuth2 token refresh** on first 401 if credentials have refresh token

---

## 3. Agent Probe Executor (packages/agent/src/runtime/executor.ts)

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/agent/src/runtime/executor.ts`

### Error Handling Strategy:

Agent probes **never throw**. All errors are wrapped in a `ProbeResponse` object.

### Error Response Format:

```typescript
{
  probe: string;
  status: 'error';
  data: { error: string };  // ← Wrapped in data object (different from hub!)
  durationMs: number;
  metadata: {
    agentVersion: VERSION;
    packName: string;
    packVersion: string;
    capabilityLevel: 'observe';
  };
}
```

### Exact Code (Lines 100-118):

```typescript
private errorResponse(
  probe: string,
  startMs: number,
  message: string,
  pack?: Pack,
): ProbeResponse {
  return {
    probe,
    status: 'error',
    data: { error: message },  // ← Wrapped in data object!
    durationMs: Date.now() - startMs,
    metadata: {
      agentVersion: VERSION,
      packName: pack?.manifest.name ?? 'unknown',
      packVersion: pack?.manifest.version ?? '0.0.0',
      capabilityLevel: 'observe',
    },
  };
}
```

### Error Cases (Lines 58-98):

```typescript
async execute(request: ProbeRequest): Promise<ProbeResponse> {
  const start = Date.now();
  const probeName = request.probe;
  const packName = probeName.split('.')[0];

  // Invalid probe name
  if (!packName) {
    return this.errorResponse(probeName, start, `Invalid probe name: ${probeName}`);
  }

  // Pack not loaded
  const pack = this.packs.get(packName);
  if (!pack) {
    return this.errorResponse(probeName, start, `Pack '${packName}' not loaded`);
  }

  // Unknown probe in pack
  const handler = pack.handlers[probeName];
  if (!handler) {
    return this.errorResponse(probeName, start, `Unknown probe: ${probeName}`);
  }

  // Probe handler throws
  try {
    const rawData = await handler(request.params, this.exec);
    const data = scrubData(rawData, this.scrubPatterns);
    return { probe: probeName, status: 'success', data, durationMs: ... };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return this.errorResponse(probeName, start, message, pack);
  }
}
```

**Key Difference:** Agent wraps error message in `data: { error: message }`, while hub integration executor uses top-level `error: message`.

---

## 4. WebSocket Message Error Handling (packages/hub/src/ws/server.ts)

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/hub/src/ws/server.ts`

### Message Parsing Errors (Lines 105-129):

```typescript
ws.on('message', (data) => {
  try {
    const raw: unknown = JSON.parse(data.toString());
    const envelope = MessageEnvelope.parse(raw);  // Zod validation
    
    // Impersonation check
    if (envelope.agentId && envelope.type !== 'agent.register') {
      const socketAgentId = dispatcher.getAgentIdBySocket(ws);
      if (socketAgentId && socketAgentId !== envelope.agentId) {
        console.warn(`Agent impersonation attempt: ...`);
        ws.send(JSON.stringify({ error: 'Agent ID mismatch' }));  // ← Simple error object
        return;
      }
    }

    handleMessage(ws, envelope, dispatcher, db, ca, bearerToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`WebSocket message error: ${message}`);
    ws.send(JSON.stringify({ error: 'Invalid message format' }));  // ← Simple error object
  }
});
```

### Authentication Rejection (Lines 49-52):

```typescript
if (!sessionManager || !sessionId || !sessionManager.getSession(sessionId)) {
  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
  return;
}
```

### Registration Errors (Lines 189-191):

```typescript
const parsed = RegisterPayload.safeParse(envelope.payload);
if (!parsed.success) {
  ws.send(JSON.stringify({ error: 'Invalid registration data' }));
  ws.close();
  return;
}
```

### Enrollment Token Validation (Lines 209-222):

```typescript
const result = db.consumeEnrollmentToken(enrollmentToken, payload.name);
if (!result.valid) {
  ws.send(
    JSON.stringify({
      id: crypto.randomUUID(),
      type: 'hub.ack' as const,
      timestamp: now,
      signature: '',
      payload: { error: `Enrollment token rejected: ${result.reason}` },  // ← In payload
    }),
  );
  ws.close();
  return;
}
```

### Signature Verification (Lines 149-159):

```typescript
if (envelope.signature === '') {
  console.warn(`Missing signature from agent ${envelope.agentId} which has a stored cert`);
  ws.send(JSON.stringify({ error: 'Signature required' }));
  return;
}
const valid = verifyPayload(envelope.payload, envelope.signature, certPem);
if (!valid) {
  console.warn(`Signature verification failed for agent ${envelope.agentId}`);
  ws.send(JSON.stringify({ error: 'Signature verification failed' }));
  return;
}
```

### Error Response Formats:

1. **Simple error object** (broadcast to socket):
   ```typescript
   ws.send(JSON.stringify({ error: 'message' }));
   ```

2. **Enrollment ACK with error** (structured envelope):
   ```typescript
   ws.send(JSON.stringify({
     id: uuid,
     type: 'hub.ack',
     timestamp: iso8601,
     signature: '',
     payload: { error: 'reason' }  // ← Error in payload
   }));
   ```

3. **HTTP rejection** (raw socket):
   ```typescript
   socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
   socket.destroy();
   ```

---

## 5. MCP Tool Error Handling (packages/hub/src/mcp/tools/)

### probe.ts (Lines 6-62):

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/hub/src/mcp/tools/probe.ts`

```typescript
export async function handleProbe(
  args: { agent?: string; probe: string; params?: Record<string, unknown> },
  probeRouter: ProbeRouter,
  db: SondeDb,
  auth?: AuthContext,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    // Policy check
    if (auth) {
      const decision = evaluateProbeAccess(auth, agentOrSource, args.probe);
      if (!decision.allowed) {
        return {
          content: [{ type: 'text', text: `Access denied: ${decision.reason}` }],
          isError: true,
        };
      }
    }

    const response = await probeRouter.execute(args.probe, args.params, args.agent);
    // Audit log + return success
    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    let hint = '';
    if (message.includes('not found or offline')) {
      hint = ' Check that the agent is running and connected to the hub.';
    } else if (message.includes('timed out')) {
      hint = ' The agent may be overloaded or the probe may be slow.';
    }
    return {
      content: [{ type: 'text', text: `Error: ${message}${hint}` }],
      isError: true,
    };
  }
}
```

**Error Response Format:**
```typescript
{
  content: [{ type: 'text', text: 'Error: message\nOptional hint' }],
  isError: true
}
```

**Access denial (policy):**
```typescript
{
  content: [{ type: 'text', text: 'Access denied: reason' }],
  isError: true
}
```

### diagnose.ts (Lines 7-156):

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/hub/src/mcp/tools/diagnose.ts`

```typescript
export async function handleDiagnose(
  args: { agent?: string; category: string; ... },
  probeRouter: ProbeRouter,
  runbookEngine: RunbookEngine,
  db: SondeDb,
  auth?: AuthContext,
  connectedAgents?: string[],
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}> {
  try {
    // Agent access check
    if (auth && args.agent) {
      const agentDecision = evaluateAgentAccess(auth, args.agent);
      if (!agentDecision.allowed) {
        return {
          content: [{ type: 'text', text: `Access denied: ${agentDecision.reason}` }],
          isError: true,
        };
      }
    }

    // Diagnostic runbook
    const diagnosticRunbook = runbookEngine.getDiagnosticRunbook(args.category);
    if (diagnosticRunbook) {
      const result = await runbookEngine.executeDiagnostic(...);
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    }

    // Fallback: simple runbook
    const runbook = runbookEngine.getRunbook(args.category);
    if (!runbook) {
      const available = runbookEngine.getCategories();
      return {
        content: [{
          type: 'text',
          text: `Error: No runbook for category "${args.category}". Available: ${available.join(', ') || 'none'}`
        }],
        isError: true,
      };
    }

    const result = await runbookEngine.execute(args.category, args.agent, probeRouter);
    return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
```

**Error Response Formats:**
1. Unknown category:
   ```typescript
   {
     content: [{ type: 'text', text: 'Error: No runbook for category "...". Available: ...' }],
     isError: true
   }
   ```

2. General exception:
   ```typescript
   {
     content: [{ type: 'text', text: 'Error: message' }],
     isError: true
   }
   ```

3. Policy denial:
   ```typescript
   {
     content: [{ type: 'text', text: 'Access denied: reason' }],
     isError: true
   }
   ```

### list-agents.ts (Lines 6-38):

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/hub/src/mcp/tools/list-agents.ts`

**No error handling.** Returns filtered agent list always:
```typescript
return {
  content: [{ type: 'text', text: JSON.stringify({ agents: result }, null, 2) }],
};
```

---

## 6. Agent Connection Errors (packages/agent/src/runtime/connection.ts)

**File:** `/Users/joshowen/Library/CloudStorage/ProtonDrive-joshowen@protonmail.com-folder/AI/ClaudeCode/sonde/packages/agent/src/runtime/connection.ts`

### Enrollment Error (Lines 39-128):

```typescript
export function enrollWithHub(
  config: AgentConfig,
  executor: ProbeExecutor,
): Promise<{ agentId: string; certIssued: boolean; apiKey?: string }> {
  return new Promise((resolve, reject) => {
    // Timeout
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Enrollment timed out waiting for hub acknowledgement'));
    }, ENROLL_TIMEOUT_MS);

    // Parse ACK
    ws.on('message', (data) => {
      let envelope: MessageEnvelope;
      try {
        envelope = MessageEnvelopeSchema.parse(JSON.parse(data.toString()));
      } catch {
        return;  // Ignore parse errors silently
      }

      if (envelope.type === 'hub.ack') {
        clearTimeout(timeout);
        const ackPayload = envelope.payload as {
          agentId?: string;
          error?: string;  // ← Hub may return error in ack
          certPem?: string;
          keyPem?: string;
          caCertPem?: string;
          apiKey?: string;
        };

        ws.close();

        // Hub rejected enrollment
        if (ackPayload.error) {
          reject(new Error(ackPayload.error));
          return;
        }

        // Missing agentId
        const agentId = ackPayload.agentId;
        if (!agentId) {
          reject(new Error('Hub ack did not contain agentId'));
          return;
        }

        resolve({ agentId, certIssued, apiKey: ackPayload.apiKey });
      }
    });

    // Network/WS errors
    ws.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timeout);
      reject(new Error(humanizeWsError(err, config.hubUrl)));
    });
  });
}
```

### Network Error Humanization (Lines 131-141):

```typescript
function humanizeWsError(err: Error & { code?: string }, hubUrl: string): string {
  switch (err.code) {
    case 'ECONNREFUSED':
      return `Could not connect to hub at ${hubUrl}. Verify the hub is running.`;
    case 'ENOTFOUND':
      return `Hub hostname not found: ${hubUrl}. Check the URL.`;
    case 'ETIMEDOUT':
      return `Connection to hub at ${hubUrl} timed out. The hub may be unreachable.`;
    default:
      return err.message;
  }
}
```

### Cert Loading (Lines 153-160):

```typescript
if (config.certPath && config.keyPath && config.caCertPath) {
  try {
    options.cert = fs.readFileSync(config.certPath, 'utf-8');
    options.key = fs.readFileSync(config.keyPath, 'utf-8');
    options.ca = [fs.readFileSync(config.caCertPath, 'utf-8')];
    options.rejectUnauthorized = true;
  } catch {
    // Cert files missing or unreadable — fall back to API key only
  }
}
```

### Probe Request Handling (Lines 312-329):

```typescript
private handleProbeRequest(envelope: MessageEnvelope): void {
  const parsed = ProbeRequestSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    // Invalid request schema
    this.sendError(envelope.id, 'Invalid probe request payload');
    return;
  }

  const request = parsed.data;
  // Execute probe, will automatically return success or error response
  this.executor.execute(request).then((response) => {
    this.send({
      type: response.status === 'success' ? 'probe.response' : 'probe.error',
      payload: response,
    });
  });
}

private sendError(requestId: string, message: string): void {
  this.send({
    id: requestId,
    type: 'probe.error',
    timestamp: new Date().toISOString(),
    signature: '',
    payload: {
      probe: '?',
      status: 'error',
      data: { error: message },  // ← Probe error format
      durationMs: 0,
      metadata: { ... }
    },
  });
}
```

---

## Summary: Error Response Patterns

### Inconsistencies Found:

| Component | Error Format | Context | HTTP Status |
|-----------|--------------|---------|-------------|
| **Hub REST** | `{ error: string }` | All routes | 400, 401, 403, 404, 409, 500 |
| **Hub Integration Executor** | `{ ..., error: string, status: 'error' }` | Probe response | N/A (wrapped in MCP) |
| **Agent Executor** | `{ data: { error: string }, status: 'error' }` | Probe response | N/A (wrapped in MCP) |
| **WebSocket (Hub)** | `{ error: string }` OR enrollment ACK payload | Message send | N/A |
| **MCP Probe Tool** | `{ content: [...], isError: true }` | Tool response | N/A |
| **MCP Diagnose Tool** | `{ content: [...], isError: true }` | Tool response | N/A |
| **Agent Connection** | `Error('message')` | Promise reject | N/A |

### Key Issues:

1. **Integration vs Agent Executor mismatch**: Hub wraps error at top level (`error: string`), agent wraps in data (`data: { error: string }`)
2. **WebSocket inconsistency**: Message errors sent as `{ error: string }`, enrollment errors in `payload: { error: string }`
3. **No structured error codes**: Only string messages, no error code/type discrimination
4. **Silent failures**: Some parsing errors caught and ignored without logging
5. **Selective logging**: WS errors logged to console, HTTP errors not logged
