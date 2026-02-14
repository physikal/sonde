#!/usr/bin/env node

import os from 'node:os';
import { getConfigPath, loadConfig, saveConfig } from './config.js';
import { AgentConnection } from './runtime/connection.js';
import { ProbeExecutor } from './runtime/executor.js';

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log('Usage: sonde <command>');
  console.log('');
  console.log('Commands:');
  console.log('  enroll    Enroll this agent with a hub');
  console.log('  start     Start the agent (connect to hub)');
  console.log('  status    Show agent status');
  console.log('');
  console.log('Enroll options:');
  console.log('  --hub <url>    Hub URL (e.g. http://localhost:3000)');
  console.log('  --key <key>    API key for authentication');
  console.log('  --name <name>  Agent name (default: hostname)');
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function cmdEnroll(): void {
  const hubUrl = getArg('--hub');
  const apiKey = getArg('--key');
  const agentName = getArg('--name') ?? os.hostname();

  if (!hubUrl || !apiKey) {
    console.error('Error: --hub and --key are required');
    console.error('  sonde enroll --hub http://localhost:3000 --key your-api-key');
    process.exit(1);
  }

  saveConfig({ hubUrl, apiKey, agentName });
  console.log('Agent enrolled successfully.');
  console.log(`  Hub:    ${hubUrl}`);
  console.log(`  Name:   ${agentName}`);
  console.log(`  Config: ${getConfigPath()}`);
  console.log('');
  console.log('Run "sonde start" to connect.');
}

function cmdStart(): void {
  const config = loadConfig();
  if (!config) {
    console.error('Error: Agent not enrolled. Run "sonde enroll" first.');
    process.exit(1);
  }

  console.log('Sonde Agent v0.1.0');
  console.log(`  Name: ${config.agentName}`);
  console.log(`  Hub:  ${config.hubUrl}`);
  console.log('');

  const executor = new ProbeExecutor();
  const connection = new AgentConnection(config, executor, {
    onConnected: (agentId) => {
      console.log(`Connected to hub (agentId: ${agentId})`);
    },
    onDisconnected: () => {
      console.log('Disconnected from hub, reconnecting...');
    },
    onError: (err) => {
      console.error(`Connection error: ${err.message}`);
    },
    onRegistered: (agentId) => {
      config.agentId = agentId;
      saveConfig(config);
    },
  });

  connection.start();

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    connection.stop();
    process.exit(0);
  });
}

function cmdStatus(): void {
  const config = loadConfig();
  if (!config) {
    console.log('Status: Not enrolled');
    console.log(`Run "sonde enroll" to get started.`);
    return;
  }

  console.log('Sonde Agent Status');
  console.log(`  Name:     ${config.agentName}`);
  console.log(`  Hub:      ${config.hubUrl}`);
  console.log(`  Agent ID: ${config.agentId ?? '(not yet assigned)'}`);
  console.log(`  Config:   ${getConfigPath()}`);
}

switch (command) {
  case 'enroll':
    cmdEnroll();
    break;
  case 'start':
    cmdStart();
    break;
  case 'status':
    cmdStatus();
    break;
  default:
    printUsage();
    if (command) {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
    break;
}
