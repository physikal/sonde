import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const COMPOSE_FILE = 'docker/docker-compose.yml';
const HUB_URL = 'http://localhost:3000';
const API_KEY = 'test-key-123';
const AGENT_NAME = 'integration-test-agent';

/** Check if Docker daemon is available */
function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Wait for the hub health endpoint with retry */
async function waitForHub(maxMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${HUB_URL}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Hub did not become healthy within ${maxMs}ms`);
}

describe.skipIf(!isDockerAvailable())('Integration: full probe loop', () => {
  beforeAll(async () => {
    execSync(`docker compose -f ${COMPOSE_FILE} up -d --build`, {
      stdio: 'inherit',
      timeout: 120_000,
    });
    await waitForHub(60_000);
  });

  afterAll(() => {
    try {
      execSync(`docker compose -f ${COMPOSE_FILE} down -v`, {
        stdio: 'inherit',
        timeout: 30_000,
      });
    } catch {
      // best-effort cleanup
    }
  });

  it('should execute a probe via MCP → hub → agent → response', async () => {
    // Dynamic imports to avoid triggering agent CLI side effects
    const { ProbeExecutor } = await import('@sonde/agent/runtime/executor');
    const { AgentConnection } = await import('@sonde/agent/runtime/connection');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );

    // 1. Start the agent and wait for registration
    const executor = new ProbeExecutor();
    let agentConn: InstanceType<typeof AgentConnection> | undefined;

    await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Agent registration timed out')), 15_000);

      const conn = new AgentConnection(
        { hubUrl: HUB_URL, apiKey: API_KEY, agentName: AGENT_NAME },
        executor,
        {
          onRegistered: (id) => {
            clearTimeout(timeout);
            resolve(id);
          },
          onError: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        },
      );
      agentConn = conn;
      conn.start();
    });

    try {
      // 2. Create MCP client
      const transport = new StreamableHTTPClientTransport(new URL(`${HUB_URL}/mcp`), {
        requestInit: {
          headers: { Authorization: `Bearer ${API_KEY}` },
        },
      });

      const mcpClient = new Client({ name: 'integration-test', version: '0.1.0' });
      await mcpClient.connect(transport);

      try {
        // 3. Call the probe tool
        const result = await mcpClient.callTool({
          name: 'probe',
          arguments: {
            agent: AGENT_NAME,
            probe: 'system.disk.usage',
          },
        });

        // 4. Verify the result
        expect(result.isError).toBeFalsy();

        const content = result.content as Array<{ type: string; text: string }>;
        expect(content).toBeDefined();
        expect(content.length).toBeGreaterThan(0);

        const textContent = content.find((c) => c.type === 'text');
        expect(textContent).toBeDefined();

        const parsed = JSON.parse(textContent?.text ?? '');
        expect(parsed.status).toBe('success');
        expect(parsed.data.filesystems).toBeDefined();
        expect(Array.isArray(parsed.data.filesystems)).toBe(true);
        expect(parsed.data.filesystems.length).toBeGreaterThan(0);

        const fs = parsed.data.filesystems[0];
        expect(fs).toHaveProperty('filesystem');
        expect(fs).toHaveProperty('mountpoint');
        expect(fs).toHaveProperty('totalBytes');
        expect(fs).toHaveProperty('usedBytes');
        expect(fs).toHaveProperty('availableBytes');
        expect(fs).toHaveProperty('usedPercent');
      } finally {
        await mcpClient.close();
      }
    } finally {
      agentConn?.stop();
    }
  });
});
