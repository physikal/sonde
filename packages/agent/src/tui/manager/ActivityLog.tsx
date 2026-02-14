import { Box, Text } from 'ink';
import type { ActivityEntry } from './ManagerApp.js';

interface ActivityLogProps {
  activity: ActivityEntry[];
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'green';
    case 'error':
      return 'red';
    case 'timeout':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function ActivityLog({ activity }: ActivityLogProps): JSX.Element {
  if (activity.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="white">
          Activity
        </Text>
        <Box marginTop={1}>
          <Text color="gray">Waiting for probe activity...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        Activity ({activity.length} probes)
      </Text>
      <Box marginTop={1} flexDirection="column">
        {activity.map((entry, i) => (
          <Box key={`${entry.timestamp}-${i}`}>
            <Text color="gray">{formatTime(entry.timestamp)} </Text>
            <Text color="white">{entry.probe.padEnd(25)}</Text>
            <Text color={statusColor(entry.status)}>{entry.status.padEnd(10)}</Text>
            <Text color="gray">{entry.durationMs}ms</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
