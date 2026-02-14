import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { DetectRules, PackManifest } from '@sonde/shared';

export interface ScanResult {
  packName: string;
  detected: boolean;
  matchedCommands: string[];
  matchedFiles: string[];
  matchedServices: string[];
}

/** Abstraction for testability */
export interface SystemChecker {
  commandExists(cmd: string): boolean;
  fileExists(path: string): boolean;
  serviceExists(service: string): boolean;
}

/** Real system checker using PATH lookup and fs */
export function createSystemChecker(): SystemChecker {
  return {
    commandExists(cmd: string): boolean {
      try {
        execFileSync('which', [cmd], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    fileExists(filePath: string): boolean {
      return fs.existsSync(filePath);
    },
    serviceExists(service: string): boolean {
      try {
        execFileSync('systemctl', ['cat', service], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Scans the system against pack detect rules.
 * Returns a ScanResult per manifest with which checks matched.
 */
export function scanForSoftware(manifests: PackManifest[], checker: SystemChecker): ScanResult[] {
  const results: ScanResult[] = [];

  for (const manifest of manifests) {
    const detect = manifest.detect;
    if (!detect) {
      results.push({
        packName: manifest.name,
        detected: false,
        matchedCommands: [],
        matchedFiles: [],
        matchedServices: [],
      });
      continue;
    }

    const result = checkDetectRules(manifest.name, detect, checker);
    results.push(result);
  }

  return results;
}

function checkDetectRules(
  packName: string,
  detect: DetectRules,
  checker: SystemChecker,
): ScanResult {
  const matchedCommands: string[] = [];
  const matchedFiles: string[] = [];
  const matchedServices: string[] = [];

  for (const cmd of detect.commands ?? []) {
    if (checker.commandExists(cmd)) {
      matchedCommands.push(cmd);
    }
  }

  for (const file of detect.files ?? []) {
    if (checker.fileExists(file)) {
      matchedFiles.push(file);
    }
  }

  for (const service of detect.services ?? []) {
    if (checker.serviceExists(service)) {
      matchedServices.push(service);
    }
  }

  // Detected if at least one check passed
  const detected =
    matchedCommands.length > 0 || matchedFiles.length > 0 || matchedServices.length > 0;

  return { packName, detected, matchedCommands, matchedFiles, matchedServices };
}

export interface PermissionCheck {
  satisfied: boolean;
  missingGroups: string[];
  missingCommands: string[];
  missingFiles: string[];
}

/**
 * Checks if the current user has the required permissions for a pack.
 */
export function checkPackPermissions(
  manifest: PackManifest,
  checker: SystemChecker,
  userGroups: string[],
): PermissionCheck {
  const groupSet = new Set(userGroups);
  const missingGroups = manifest.requires.groups.filter((g) => !groupSet.has(g));
  const missingCommands = manifest.requires.commands.filter((c) => !checker.commandExists(c));
  const missingFiles = manifest.requires.files.filter((f) => !checker.fileExists(f));

  return {
    satisfied:
      missingGroups.length === 0 && missingCommands.length === 0 && missingFiles.length === 0,
    missingGroups,
    missingCommands,
    missingFiles,
  };
}
