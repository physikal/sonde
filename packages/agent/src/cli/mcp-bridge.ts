/**
 * stdio → StreamableHTTP MCP bridge.
 *
 * Claude Code spawns `sonde mcp-bridge` and speaks MCP over stdin/stdout.
 * This bridge forwards every JSON-RPC message to the hub's /mcp endpoint
 * using the StreamableHTTP transport and relays responses back on stdout.
 *
 * Protocol details:
 *   stdin  – newline-delimited JSON-RPC (MCP stdio transport)
 *   stdout – newline-delimited JSON-RPC (MCP stdio transport)
 *   hub    – HTTP POST /mcp with JSON body, response is JSON or SSE
 */
import { loadConfig } from '../config.js';

// ── stdio helpers ──────────────────────────────────────────────────────

/** Write a JSON-RPC message to stdout (newline-delimited). */
function writeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  process.stdout.write(`${json}\n`);
}

/** Log to stderr so it doesn't interfere with the JSON-RPC channel. */
function log(msg: string): void {
  process.stderr.write(`[sonde-bridge] ${msg}\n`);
}

// ── SSE parsing ────────────────────────────────────────────────────────

/** Parse SSE text into individual data payloads. */
function parseSseEvents(text: string): string[] {
  const payloads: string[] = [];
  let currentData = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      currentData += line.slice(6);
    } else if (line === '' && currentData) {
      payloads.push(currentData);
      currentData = '';
    }
  }
  // Flush any remaining data (stream may not end with blank line)
  if (currentData) {
    payloads.push(currentData);
  }
  return payloads;
}

// ── HTTP transport ─────────────────────────────────────────────────────

interface BridgeOptions {
  mcpUrl: string;
  apiKey: string;
}

class McpHttpTransport {
  private sessionId: string | undefined;
  private mcpUrl: string;
  private apiKey: string;

  constructor(opts: BridgeOptions) {
    this.mcpUrl = opts.mcpUrl;
    this.apiKey = opts.apiKey;
  }

  /** Send a JSON-RPC message to the hub and relay response(s) to stdout. */
  async send(message: unknown): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const res = await fetch(this.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });

    // Capture session ID from response
    const newSessionId = res.headers.get('mcp-session-id');
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!res.ok) {
      const text = await res.text();
      log(`Hub returned ${res.status}: ${text}`);
      // Send JSON-RPC error response if the message had an id
      const msg = message as { id?: string | number };
      if (msg.id !== undefined) {
        writeMessage({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: `Hub returned HTTP ${res.status}` },
        });
      }
      return;
    }

    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      // SSE response — parse events and forward each as a JSON-RPC message
      const text = await res.text();
      for (const payload of parseSseEvents(text)) {
        try {
          const parsed: unknown = JSON.parse(payload);
          writeMessage(parsed);
        } catch {
          log(`Failed to parse SSE payload: ${payload.slice(0, 200)}`);
        }
      }
    } else {
      // JSON response — forward directly
      const text = await res.text();
      if (text) {
        try {
          const parsed: unknown = JSON.parse(text);
          writeMessage(parsed);
        } catch {
          log(`Failed to parse JSON response: ${text.slice(0, 200)}`);
        }
      }
    }
  }

  /** Terminate the session cleanly. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(this.mcpUrl, {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': this.sessionId,
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
    } catch {
      // Best-effort cleanup
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

export async function startMcpBridge(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    log('Agent not enrolled. Run "sonde enroll" first.');
    process.exit(1);
  }

  if (!config.apiKey) {
    log('No API key found in agent config. Re-enroll the agent with "sonde enroll".');
    process.exit(1);
  }

  const mcpUrl = `${config.hubUrl}/mcp`;
  log(`Bridging stdio ↔ ${mcpUrl}`);

  const transport = new McpHttpTransport({
    mcpUrl,
    apiKey: config.apiKey,
  });

  // Read newline-delimited JSON-RPC from stdin
  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        log(`Failed to parse stdin message: ${line.slice(0, 200)}`);
        continue;
      }

      // Fire and forget — errors are handled inside send()
      transport.send(message).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log(`Transport error: ${errorMsg}`);
        // Try to send a JSON-RPC error if we can extract the message id
        const msg = message as { id?: string | number };
        if (msg.id !== undefined) {
          writeMessage({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32603, message: `Bridge transport error: ${errorMsg}` },
          });
        }
      });
    }
  });

  process.stdin.on('end', async () => {
    log('stdin closed, shutting down');
    await transport.close();
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
}
