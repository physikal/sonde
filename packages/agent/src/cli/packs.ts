import type { Pack } from '@sonde/packs';
import { packRegistry } from '@sonde/packs';
import type { PackManifest } from '@sonde/shared';
import {
  type PermissionCheck,
  type ScanResult,
  type SystemChecker,
  checkPackPermissions,
  createSystemChecker,
  scanForSoftware,
} from '../system/scanner.js';

export interface PackState {
  /** Packs currently loaded/active on this agent */
  installed: Map<string, Pack>;
  /** All available packs from the registry */
  available: ReadonlyMap<string, Pack>;
}

export interface PackCommandDeps {
  state: PackState;
  checker: SystemChecker;
  getUserGroups: () => string[];
  log: (msg: string) => void;
}

function createDefaultDeps(): PackCommandDeps {
  return {
    state: {
      installed: new Map(packRegistry),
      available: packRegistry,
    },
    checker: createSystemChecker(),
    getUserGroups: getProcessUserGroups,
    log: console.log,
  };
}

function getProcessUserGroups(): string[] {
  // On Unix, process.getgroups() returns numeric GIDs
  // For MVP, we return an empty array — real implementation would
  // map GIDs to group names via /etc/group
  try {
    if (typeof process.getgroups === 'function') {
      return process.getgroups().map(String);
    }
  } catch {
    // Not available on all platforms
  }
  return [];
}

export function cmdPacksList(deps?: PackCommandDeps): void {
  const { state, log } = deps ?? createDefaultDeps();

  if (state.installed.size === 0) {
    log('No packs installed.');
    return;
  }

  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

  log('Installed packs:');
  log('');
  for (const [name, pack] of state.installed) {
    const probeCount = pack.manifest.probes.length;
    log(`  ${bold(name)} v${pack.manifest.version} (${probeCount} probes)`);
    log(`    ${pack.manifest.description}`);
    for (const probe of pack.manifest.probes) {
      log(`    - ${name}.${probe.name}: ${probe.description}`);
    }
    log('');
  }
  log(`  Manage: sonde packs install ${bold('<name>')} | uninstall ${bold('<name>')}`);
}

export function cmdPacksScan(deps?: PackCommandDeps): ScanResult[] {
  const { state, checker, log } = deps ?? createDefaultDeps();

  const manifests = [...state.available.values()].map((p) => p.manifest);
  const results = scanForSoftware(manifests, checker);

  log('Software scan results:');
  log('');

  const detected = results.filter((r) => r.detected);
  const notDetected = results.filter((r) => !r.detected);

  if (detected.length > 0) {
    log('  Detected:');
    for (const r of detected) {
      const installed = state.installed.has(r.packName);
      const status = installed ? '(installed)' : '(available)';
      const matches: string[] = [];
      if (r.matchedCommands.length > 0) matches.push(`commands: ${r.matchedCommands.join(', ')}`);
      if (r.matchedFiles.length > 0) matches.push(`files: ${r.matchedFiles.join(', ')}`);
      if (r.matchedServices.length > 0) matches.push(`services: ${r.matchedServices.join(', ')}`);
      log(`    ${r.packName} ${status} [${matches.join('; ')}]`);
    }
    log('');
  }

  if (notDetected.length > 0) {
    log('  Not detected:');
    for (const r of notDetected) {
      log(`    ${r.packName}`);
    }
    log('');
  }

  return results;
}

export function cmdPacksInstall(
  name: string,
  deps?: PackCommandDeps,
): { success: boolean; permissions?: PermissionCheck } {
  const { state, checker, getUserGroups, log } = deps ?? createDefaultDeps();

  const pack = state.available.get(name);
  if (!pack) {
    log(`Error: Pack "${name}" not found.`);
    log(`Available packs: ${[...state.available.keys()].join(', ')}`);
    return { success: false };
  }

  if (state.installed.has(name)) {
    log(`Pack "${name}" is already installed.`);
    return { success: true };
  }

  // Check permissions
  const userGroups = getUserGroups();
  const permissions = checkPackPermissions(pack.manifest, checker, userGroups);

  if (!permissions.satisfied) {
    log(`Pack "${name}" requires additional permissions:`);
    if (permissions.missingGroups.length > 0) {
      log(`  Missing groups: ${permissions.missingGroups.join(', ')}`);
      log('  To grant access:');
      for (const group of permissions.missingGroups) {
        log(`    sudo usermod -aG ${group} $(whoami)`);
      }
    }
    if (permissions.missingCommands.length > 0) {
      log(`  Missing commands: ${permissions.missingCommands.join(', ')}`);
      log('  Install the required software before enabling this pack.');
    }
    if (permissions.missingFiles.length > 0) {
      log(`  Missing files: ${permissions.missingFiles.join(', ')}`);
    }
    return { success: false, permissions };
  }

  state.installed.set(name, pack);
  log(`Pack "${name}" installed successfully.`);
  log(`  ${pack.manifest.probes.length} probes now available.`);
  return { success: true, permissions };
}

export function cmdPacksUninstall(name: string, deps?: PackCommandDeps): boolean {
  const { state, log } = deps ?? createDefaultDeps();

  if (!state.installed.has(name)) {
    log(`Error: Pack "${name}" is not installed.`);
    return false;
  }

  state.installed.delete(name);
  log(`Pack "${name}" uninstalled.`);
  return true;
}

export function handlePacksCommand(subArgs: string[]): void {
  const subcommand = subArgs[0];

  switch (subcommand) {
    case 'list':
      cmdPacksList();
      break;
    case 'scan':
      cmdPacksScan();
      break;
    case 'install': {
      const name = subArgs[1];
      if (!name) {
        console.error('Usage: sonde packs install <name>');
        process.exit(1);
      }
      const result = cmdPacksInstall(name);
      if (!result.success) process.exit(1);
      break;
    }
    case 'uninstall': {
      const name = subArgs[1];
      if (!name) {
        console.error('Usage: sonde packs uninstall <name>');
        process.exit(1);
      }
      if (!cmdPacksUninstall(name)) process.exit(1);
      break;
    }
    default:
      console.log('Usage: sonde packs <command>');
      console.log('');
      console.log('Commands:');
      console.log('  list        Show installed packs and their probes');
      console.log('  scan        Detect available software, suggest packs');
      console.log('  install     Load and activate a pack');
      console.log('  uninstall   Remove a pack');
      if (subcommand) {
        console.error(`\nUnknown packs command: ${subcommand}`);
        process.exit(1);
      }
      break;
  }
}
