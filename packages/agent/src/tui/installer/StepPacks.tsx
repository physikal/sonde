import { packRegistry } from '@sonde/packs';
import type { PackManifest } from '@sonde/shared';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ScanResult } from '../../system/scanner.js';

interface StepPacksProps {
  scanResults: ScanResult[];
  onNext: (packs: PackManifest[]) => void;
}

interface PackRow {
  manifest: PackManifest;
  detected: boolean;
  selected: boolean;
}

export function StepPacks({ scanResults, onNext }: StepPacksProps): JSX.Element {
  const detectedNames = new Set(scanResults.filter((r) => r.detected).map((r) => r.packName));

  const [rows, setRows] = useState<PackRow[]>(() =>
    [...packRegistry.values()].map((pack) => ({
      manifest: pack.manifest,
      detected: detectedNames.has(pack.manifest.name),
      selected: detectedNames.has(pack.manifest.name),
    })),
  );
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : rows.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
    } else if (_input === ' ') {
      setRows((prev) =>
        prev.map((row, i) => (i === cursor ? { ...row, selected: !row.selected } : row)),
      );
    } else if (key.return) {
      const selected = rows.filter((r) => r.selected).map((r) => r.manifest);
      onNext(selected);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="gray">Select packs to install. Detected software is pre-selected.</Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map((row, i) => {
          const isCursor = i === cursor;
          const checkbox = row.selected ? '[x]' : '[ ]';
          const probeCount = row.manifest.probes.length;
          return (
            <Box key={row.manifest.name}>
              <Text color={isCursor ? 'cyan' : 'white'} bold={isCursor}>
                {isCursor ? '> ' : '  '}
                {checkbox} {row.manifest.name}
              </Text>
              <Text color="gray">
                {' '}
                ({probeCount} probes) — {row.manifest.description}
              </Text>
              {row.detected && <Text color="green"> [detected]</Text>}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Up/Down: navigate | Space: toggle | Enter: confirm</Text>
      </Box>
    </Box>
  );
}
