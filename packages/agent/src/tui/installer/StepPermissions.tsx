import type { PackManifest } from '@sonde/shared';
import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import {
  type PermissionCheck,
  checkPackPermissions,
  createSystemChecker,
} from '../../system/scanner.js';

interface StepPermissionsProps {
  selectedPacks: PackManifest[];
  onNext: () => void;
  onBack: () => void;
}

interface PackPermission {
  name: string;
  check: PermissionCheck;
}

function getUserGroups(): string[] {
  try {
    if (typeof process.getgroups === 'function') {
      return process.getgroups().map(String);
    }
  } catch {
    // Not available on all platforms
  }
  return [];
}

export function StepPermissions({
  selectedPacks,
  onNext,
  onBack,
}: StepPermissionsProps): JSX.Element {
  const [results, setResults] = useState<PackPermission[]>([]);

  useEffect(() => {
    const checker = createSystemChecker();
    const groups = getUserGroups();
    const checks = selectedPacks.map((manifest) => ({
      name: manifest.name,
      check: checkPackPermissions(manifest, checker, groups),
    }));
    setResults(checks);
  }, [selectedPacks]);

  useInput((input, key) => {
    if (key.return) {
      onNext();
    } else if (input === 'b') {
      onBack();
    }
  });

  const issues = results.filter((r) => !r.check.satisfied);
  const allGood = issues.length === 0;

  return (
    <Box flexDirection="column">
      <Text bold>Permission Review</Text>
      <Box marginTop={1} flexDirection="column">
        {results.map((r) => (
          <Box key={r.name} flexDirection="column">
            <Text color={r.check.satisfied ? 'green' : 'yellow'}>
              {r.check.satisfied ? '  OK' : '  !!'} {r.name}
            </Text>
            {!r.check.satisfied && (
              <Box flexDirection="column" marginLeft={4}>
                {r.check.missingGroups.length > 0 && (
                  <>
                    <Text color="yellow">Missing groups: {r.check.missingGroups.join(', ')}</Text>
                    {r.check.missingGroups.map((g) => (
                      <Text key={g} color="gray">
                        {'  '}sudo usermod -aG {g} $(whoami)
                      </Text>
                    ))}
                  </>
                )}
                {r.check.missingCommands.length > 0 && (
                  <Text color="yellow">Missing commands: {r.check.missingCommands.join(', ')}</Text>
                )}
                {r.check.missingFiles.length > 0 && (
                  <Text color="yellow">Missing files: {r.check.missingFiles.join(', ')}</Text>
                )}
              </Box>
            )}
          </Box>
        ))}
      </Box>
      {!allGood && (
        <Box marginTop={1}>
          <Text color="yellow">
            Some packs have missing permissions. They may not work correctly.
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Enter: proceed | b: back to pack selection</Text>
      </Box>
    </Box>
  );
}
