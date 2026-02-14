import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { ProbeExecutor } from '../../runtime/executor.js';

interface PackManagerProps {
  executor: ProbeExecutor;
}

export function PackManager({ executor }: PackManagerProps): JSX.Element {
  const packs = executor.getLoadedPacks();
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : packs.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < packs.length - 1 ? prev + 1 : 0));
    }
  });

  const selectedPack = packs[cursor];
  const fullPack = selectedPack ? executor.getPackByName(selectedPack.name) : undefined;

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        Packs ({packs.length} loaded)
      </Text>
      <Box marginTop={1} flexDirection="column">
        {packs.map((pack, i) => {
          const isCursor = i === cursor;
          return (
            <Box key={pack.name}>
              <Text color={isCursor ? 'cyan' : 'white'} bold={isCursor}>
                {isCursor ? '> ' : '  '}
                {pack.name}
              </Text>
              <Text color="gray"> v{pack.version}</Text>
              <Text color="green"> [{pack.status}]</Text>
            </Box>
          );
        })}
      </Box>

      {fullPack && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">
            {fullPack.manifest.name}
          </Text>
          <Text color="gray">
            {'  '}
            {fullPack.manifest.description}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {fullPack.manifest.probes.map((probe) => (
              <Text key={probe.name}>
                {'  '}
                <Text color="white">{probe.name}</Text>
                <Text color="gray"> — {probe.description}</Text>
              </Text>
            ))}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">Up/Down: navigate</Text>
      </Box>
    </Box>
  );
}
