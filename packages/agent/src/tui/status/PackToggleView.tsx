import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export interface PackRow {
  name: string;
  description: string;
  probeCount: number;
  detected: boolean;
  enabled: boolean;
}

interface PackToggleViewProps {
  initialRows: PackRow[];
  onConfirm: (enabledNames: string[]) => void;
  onBack: () => void;
}

export function PackToggleView({
  initialRows,
  onConfirm,
  onBack,
}: PackToggleViewProps): JSX.Element {
  const [rows, setRows] = useState<PackRow[]>(initialRows);
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : rows.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
    } else if (input === ' ') {
      setRows((prev) =>
        prev.map((row, i) => (i === cursor ? { ...row, enabled: !row.enabled } : row)),
      );
    } else if (key.return) {
      onConfirm(rows.filter((r) => r.enabled).map((r) => r.name));
    } else if (input === 'b') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="gray">Toggle packs on/off. Press Enter to save, b to go back.</Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map((row, i) => {
          const isCursor = i === cursor;
          const checkbox = row.enabled ? '[x]' : '[ ]';
          return (
            <Box key={row.name}>
              <Text color={isCursor ? 'cyan' : 'white'} bold={isCursor}>
                {isCursor ? '> ' : '  '}
                {checkbox} {row.name}
              </Text>
              <Text color="gray">
                {' '}
                ({row.probeCount} probes) — {row.description}
              </Text>
              {row.detected && <Text color="green"> [detected]</Text>}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Up/Down: navigate | Space: toggle | Enter: save | b: back</Text>
      </Box>
    </Box>
  );
}
