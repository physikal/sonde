#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { packRegistry } from '@sonde/packs';
import { buildEnabledPacks, handlePacksCommand } from './cli/packs.js';
import {
  getServiceStatus,
  installService,
  isServiceInstalled,
  restartService,
  stopService,
  uninstallService,
} from './cli/service.js';
import { checkForUpdate, performUpdate } from './cli/update.js';
import {
  type AgentConfig,
  getConfigPath,
  loadConfig,
  removePidFile,
  saveConfig,
  stopRunningAgent,
  writePidFile,
} from './config.js';
import { AgentConnection, type ConnectionEvents, enrollWithHub } from './runtime/connection.js';
import { ProbeExecutor } from './runtime/executor.js';
import { checkNotRoot } from './runtime/privilege.js';
import { buildPatterns } from './runtime/scrubber.js';
import { createSystemChecker, scanForSoftware } from './system/scanner.js';
import { VERSION } from './version.js';

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
  console.log('  stop      Stop the background agent');
  console.log('  restart   Restart the agent in background');
  console.log('  status    Show agent status');
  console.log('  packs     Manage packs (list, scan, install, uninstall)');
  console.log('  service   Manage systemd service (install, uninstall, status)');
  console.log('  update    Check for and install agent updates');
  console.log('  mcp-bridge  stdio MCP bridge (for Claude Code integration)');
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

  const enabledPacks = buildEnabledPacks(
    packRegistry, config.disabledPacks ?? [],
  );
  const executor = new ProbeExecutor(enabledPacks, undefined, buildPatterns(config.scrubPatterns));
  const connection = new AgentConnection(config, executor, events);

  return { config, executor, connection };
}

async function cmdUpdate(): Promise<void> {
  console.log(`Current version: v${VERSION}`);
  console.log('Checking for updates...');

  const { latestVersion, updateAvailable } = await checkForUpdate();

  if (!updateAvailable) {
    console.log(`Already on the latest version (v${latestVersion}).`);
    return;
  }

  console.log(`New version available: v${latestVersion}`);
  performUpdate(latestVersion);
}

async function cmdEnroll(): Promise<void> {
  const hubUrl = getArg('--hub');
  const apiKey = getArg('--key');
  const existingConfig = loadConfig();
  const defaultName = existingConfig?.agentName
    ?? `${os.hostname()}-${crypto.randomBytes(3).toString('hex')}`;
  const agentName = getArg('--name') ?? defaultName;
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

  // Auto-detect packs
  const manifests = [...packRegistry.values()].map((p) => p.manifest);
  const checker = createSystemChecker();
  const scanResults = scanForSoftware(manifests, checker);
  const detectedNames = scanResults
    .filter((r) => r.detected)
    .map((r) => r.packName);
  const allNames = manifests.map((m) => m.name);
  const enabledNames = ['system', ...detectedNames.filter((n) => n !== 'system')];
  const disabledNames = allNames.filter((n) => !enabledNames.includes(n));

  config.disabledPacks = disabledNames;
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
  console.log('Pack detection:');
  for (const name of enabledNames) {
    console.log(`  ✓ ${name}`);
  }
  for (const name of disabledNames) {
    console.log(`  ✗ ${name} (not detected)`);
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
    onUpdateAvailable: (latestVersion, currentVersion) => {
      console.log(
        `Update available: v${currentVersion} → v${latestVersion}. Run "sonde update" to upgrade.`,
      );
    },
  });

  console.log(`Sonde Agent v${VERSION}`);
  console.log(`  Name: ${config.agentName}`);
  console.log(`  Hub:  ${config.hubUrl}`);
  console.log('');

  connection.start();
  writePidFile(process.pid);
  process.stdin.unref?.();

  const shutdown = () => {
    console.log('\nShutting down...');
    connection.stop();
    removePidFile();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function spawnBackgroundAgent(): number {
  const child = spawn(process.execPath, [process.argv[1]!, 'start', '--headless'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid!;
}

async function cmdManager(): Promise<void> {
  stopRunningAgent();

  let detached = false;
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { ManagerApp } = await import('./tui/manager/ManagerApp.js');

  const onDetach = () => {
    detached = true;
    spawnBackgroundAgent();
  };

  const { waitUntilExit } = render(
    createElement(ManagerApp, { createRuntime, onDetach }),
  );
  await waitUntilExit();

  if (detached) {
    console.log('Agent detached to background.');
    console.log('  sonde stop     — stop the background agent');
    console.log('  sonde start    — reattach the TUI');
    console.log('  sonde restart  — restart in background');
  }
}

function cmdStop(): void {
  if (isServiceInstalled() && getServiceStatus() === 'active') {
    const result = stopService();
    console.log(result.message);
    return;
  }

  if (stopRunningAgent()) {
    console.log('Agent stopped.');
  } else {
    console.log('No running agent found.');
  }
}

function cmdRestart(): void {
  if (isServiceInstalled() && getServiceStatus() === 'active') {
    const result = restartService();
    console.log(result.message);
    return;
  }

  stopRunningAgent();
  const pid = spawnBackgroundAgent();
  console.log(`Agent restarted in background (PID: ${pid}).`);
}

async function cmdStatus(): Promise<void> {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { StatusApp } = await import('./tui/status/StatusApp.js');
  const { waitUntilExit } = render(
    createElement(StatusApp, { respawnAgent: spawnBackgroundAgent }),
  );
  await waitUntilExit();
}

function handleServiceCommand(subArgs: string[]): void {
  const sub = subArgs[0];

  switch (sub) {
    case 'install': {
      const result = installService();
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }
    case 'uninstall': {
      const result = uninstallService();
      console.log(result.message);
      if (!result.success) process.exit(1);
      break;
    }
    case 'status': {
      const status = getServiceStatus();
      console.log(`sonde-agent service: ${status}`);
      break;
    }
    default:
      console.log('Usage: sonde service <command>');
      console.log('');
      console.log('Commands:');
      console.log('  install    Install systemd service (starts on boot)');
      console.log('  uninstall  Remove systemd service');
      console.log('  status     Show service status');
      if (sub) {
        console.error(`\nUnknown subcommand: ${sub}`);
        process.exit(1);
      }
      break;
  }
}

async function cmdInstall(): Promise<void> {
  const initialHubUrl = getArg('--hub');

  if (!process.stdin.isTTY) {
    console.log('\n[sonde] Interactive installer requires a terminal.');
    console.log('[sonde] Run the following command manually:\n');
    console.log(`  sonde install${initialHubUrl ? ` --hub ${initialHubUrl}` : ''}\n`);
    process.exit(1);
  }

  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { InstallerApp } = await import('./tui/installer/InstallerApp.js');
  const { waitUntilExit } = render(createElement(InstallerApp, { initialHubUrl }));
  await waitUntilExit();
}

if (command === '--version' || command === '-v' || hasFlag('--version')) {
  console.log(VERSION);
  process.exit(0);
}

switch (command) {
  case 'install':
    cmdInstall().catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
    break;
  case 'enroll':
    cmdEnroll().catch((err: Error & { code?: string }) => {
      if (err.code === 'ECONNREFUSED') {
        const hubUrl = getArg('--hub') ?? 'the hub';
        console.error(`Could not connect to hub at ${hubUrl}. Verify the hub is running.`);
      } else if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
        console.error('Authentication failed. Check your API key or enrollment token.');
      } else if (err.message?.includes('timed out')) {
        console.error('Enrollment timed out. The hub may be unreachable.');
      } else {
        console.error(`Enrollment failed: ${err.message}`);
      }
      process.exit(1);
    });
    break;
  case 'start':
    if (hasFlag('--headless')) {
      cmdStart();
    } else {
      cmdManager().catch((err: Error & { code?: string }) => {
        if (err.code === 'ECONNREFUSED') {
          console.error(
            'Could not connect to hub. Verify the hub is running and the URL is correct.',
          );
        } else {
          console.error(err.message);
        }
        process.exit(1);
      });
    }
    break;
  case 'stop':
    cmdStop();
    break;
  case 'restart':
    cmdRestart();
    break;
  case 'status':
    cmdStatus().catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
    break;
  case 'packs':
    handlePacksCommand(args.slice(1));
    break;
  case 'service':
    handleServiceCommand(args.slice(1));
    break;
  case 'update':
    cmdUpdate().catch((err: Error) => {
      console.error(`Update failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'mcp-bridge':
    import('./cli/mcp-bridge.js').then(({ startMcpBridge }) =>
      startMcpBridge().catch((err: Error) => {
        process.stderr.write(`[sonde-bridge] Fatal: ${err.message}\n`);
        process.exit(1);
      }),
    );
    break;
  default:
    if (command) {
      printUsage();
      if (command.startsWith('--')) {
        console.error(`\nUnknown flag: ${command}. Did you mean "sonde start ${command}"?`);
      } else {
        console.error(`\nUnknown command: ${command}`);
      }
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
