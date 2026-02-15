#!/usr/bin/env node

import os from 'node:os';
import { handlePacksCommand } from './cli/packs.js';
import { type AgentConfig, getConfigPath, loadConfig, saveConfig } from './config.js';
import { AgentConnection, type ConnectionEvents, enrollWithHub } from './runtime/connection.js';
import { ProbeExecutor } from './runtime/executor.js';
import { checkNotRoot } from './runtime/privilege.js';
import { buildPatterns } from './runtime/scrubber.js';

const args = process.argv.slice(2);
const command = args[0];

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function printUsage(): void {
  console.log('Usage: sonde [command]');
  console.log('');
  console.log('Commands:');
  console.log('  (none)    Launch management TUI (if enrolled)');
  console.log('  install   Interactive guided setup (enroll + scan + packs)');
  console.log('  enroll    Enroll this agent with a hub');
  console.log('  start     Start the agent (TUI by default, --headless for daemon)');
  console.log('  status    Show agent status');
  console.log('  packs     Manage packs (list, scan, install, uninstall)');
  console.log('');
  console.log('Enroll options:');
  console.log('  --hub <url>      Hub URL (e.g. http://localhost:3000)');
  console.log('  --key <key>      API key for authentication (or use --token)');
  console.log('  --name <name>    Agent name (default: hostname)');
  console.log('  --token <token>  Enrollment token (can be used instead of --key)');
  console.log('');
  console.log('Start options:');
  console.log('  --headless       Run without TUI (for systemd / background)');
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

interface Runtime {
  config: AgentConfig;
  executor: ProbeExecutor;
  connection: AgentConnection;
}

function createRuntime(events: ConnectionEvents): Runtime {
  checkNotRoot();

  const config = loadConfig();
  if (!config) {
    console.error('Error: Agent not enrolled. Run "sonde enroll" first.');
    process.exit(1);
  }

  const executor = new ProbeExecutor(undefined, undefined, buildPatterns(config.scrubPatterns));
  const connection = new AgentConnection(config, executor, events);

  return { config, executor, connection };
}

async function cmdEnroll(): Promise<void> {
  const hubUrl = getArg('--hub');
  const apiKey = getArg('--key');
  const agentName = getArg('--name') ?? os.hostname();
  const enrollmentToken = getArg('--token');

  if (!hubUrl) {
    console.error('Error: --hub is required');
    console.error('  sonde enroll --hub http://localhost:3000 --key your-api-key');
    console.error('  sonde enroll --hub http://localhost:3000 --token enrollment-token');
    process.exit(1);
  }
  if (!apiKey && !enrollmentToken) {
    console.error('Error: --key or --token is required');
    console.error('  sonde enroll --hub http://localhost:3000 --key your-api-key');
    console.error('  sonde enroll --hub http://localhost:3000 --token enrollment-token');
    process.exit(1);
  }

  const config: AgentConfig = { hubUrl, apiKey: apiKey ?? '', agentName };
  if (enrollmentToken) {
    config.enrollmentToken = enrollmentToken;
  }
  saveConfig(config);

  const executor = new ProbeExecutor();
  console.log(`Enrolling with hub at ${hubUrl}...`);

  const { agentId, certIssued, apiKey: mintedKey } = await enrollWithHub(config, executor);
  config.agentId = agentId;
  // Save the hub-minted API key so the agent can reconnect after the token is consumed
  if (mintedKey) {
    config.apiKey = mintedKey;
  }
  // Clear the one-time token after use
  config.enrollmentToken = undefined;
  saveConfig(config);

  console.log('Agent enrolled successfully.');
  console.log(`  Hub:      ${hubUrl}`);
  console.log(`  Name:     ${agentName}`);
  console.log(`  Agent ID: ${agentId}`);
  console.log(`  Config:   ${getConfigPath()}`);
  if (certIssued) {
    console.log('  mTLS:     Client certificate issued and saved');
  }
  console.log('');
  console.log('Run "sonde start" to connect.');
}

function cmdStart(): void {
  const { config, connection } = createRuntime({
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

  console.log('Sonde Agent v0.1.0');
  console.log(`  Name: ${config.agentName}`);
  console.log(`  Hub:  ${config.hubUrl}`);
  console.log('');

  connection.start();

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    connection.stop();
    process.exit(0);
  });
}

async function cmdManager(): Promise<void> {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { ManagerApp } = await import('./tui/manager/ManagerApp.js');
  const { waitUntilExit } = render(createElement(ManagerApp, { createRuntime }));
  await waitUntilExit();
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

async function cmdInstall(): Promise<void> {
  const initialHubUrl = getArg('--hub');
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { InstallerApp } = await import('./tui/installer/InstallerApp.js');
  const { waitUntilExit } = render(createElement(InstallerApp, { initialHubUrl }));
  await waitUntilExit();
}

switch (command) {
  case 'install':
    cmdInstall().catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
    break;
  case 'enroll':
    cmdEnroll().catch((err: Error) => {
      console.error(`Enrollment failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'start':
    if (hasFlag('--headless')) {
      cmdStart();
    } else {
      cmdManager().catch((err: Error) => {
        console.error(err.message);
        process.exit(1);
      });
    }
    break;
  case 'status':
    cmdStatus();
    break;
  case 'packs':
    handlePacksCommand(args.slice(1));
    break;
  default:
    if (command) {
      printUsage();
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    } else {
      // No command: launch TUI if enrolled, otherwise show usage
      const config = loadConfig();
      if (config) {
        cmdManager().catch((err: Error) => {
          console.error(err.message);
          process.exit(1);
        });
      } else {
        printUsage();
      }
    }
    break;
}

export { createRuntime };
export type { Runtime };
