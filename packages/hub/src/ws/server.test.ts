import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SondeDb } from '../db/index.js';
import { AgentDispatcher } from './dispatcher.js';
import { setupWsServer } from './server.js';

const API_KEY = 'test-key';
const PORT = 0; // Let OS pick a free port

describe('WebSocket server', () => {
  let server: http.Server;
  let db: SondeDb;
  let dispatcher: AgentDispatcher;
  let baseUrl: string;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        db = new SondeDb(':memory:');
        dispatcher = new AgentDispatcher();

        const app = new Hono();
        app.get('/health', (c) => c.json({ status: 'ok' }));
        const honoListener = getRequestListener(app.fetch);

        server = http.createServer(async (req, res) => {
          const url = req.url ?? '';
          if (url.startsWith('/mcp')) {
            res.writeHead(200);
            res.end();
            return;
          }
          honoListener(req, res);
        });

        setupWsServer(server, dispatcher, db, (key) => key === API_KEY);

        server.listen(PORT, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `ws://127.0.0.1:${addr.port}`;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        db.close();
        server.close(() => resolve());
      }),
  );

  function registerAgent(name: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl}/ws/agent`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for hub.ack'));
      }, 5_000);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            id: crypto.randomUUID(),
            type: 'agent.register',
            timestamp: new Date().toISOString(),
            signature: '',
            payload: {
              name,
              os: 'linux x64',
              agentVersion: '0.1.0',
              packs: [{ name: 'system', version: '0.1.0', status: 'active' }],
            },
          }),
        );
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'hub.ack' && msg.payload?.agentId) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.payload.agentId);
        } else if (msg.error) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Server error: ${msg.error}`));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  it('should complete agent registration and return hub.ack', async () => {
    const agentId = await registerAgent('test-agent');

    expect(agentId).toBeDefined();
    expect(typeof agentId).toBe('string');
    expect(dispatcher.getOnlineAgentIds()).toContain(agentId);
  });

  it('should reuse agent ID on re-enrollment with the same name', async () => {
    const firstId = await registerAgent('re-enroll-agent');
    const secondId = await registerAgent('re-enroll-agent');

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(secondId).toBe(firstId);
  });
});
