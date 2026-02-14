import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { SondeDb } from './db/index.js';
import { createMcpHandler } from './mcp/server.js';
import { AgentDispatcher } from './ws/dispatcher.js';
import { setupWsServer } from './ws/server.js';

const config = loadConfig();
const db = new SondeDb(config.dbPath);
const dispatcher = new AgentDispatcher();

// Hono app for REST routes
const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    agents: dispatcher.getOnlineAgentIds().length,
  }),
);

// MCP handler for /mcp/* routes
const mcpHandler = createMcpHandler(dispatcher, db, config.apiKey);

// Node HTTP server — routes /mcp to MCP handler, everything else to Hono
const honoListener = getRequestListener(app.fetch);

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '';

  if (url.startsWith('/mcp')) {
    await mcpHandler(req, res);
    return;
  }

  honoListener(req, res);
});

// WebSocket server for agent connections
setupWsServer(server, dispatcher, db, (key) => key === config.apiKey);

server.listen(config.port, config.host, () => {
  console.log('Sonde Hub v0.1.0');
  console.log(`  HTTP:      http://${config.host}:${config.port}`);
  console.log(`  MCP:       http://${config.host}:${config.port}/mcp`);
  console.log(`  WebSocket: ws://${config.host}:${config.port}/ws/agent`);
  console.log(`  Health:    http://${config.host}:${config.port}/health`);
  console.log(`  Database:  ${config.dbPath}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  db.close();
  process.exit(0);
});

export { app, config, db, dispatcher };
