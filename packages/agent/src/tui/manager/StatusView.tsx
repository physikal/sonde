import { Box, Text } from 'ink';
import type { AgentConfig } from '../../config.js';
import type { AgentAuditLog } from '../../runtime/audit.js';
import type { ProbeExecutor } from '../../runtime/executor.js';
import type { ActivityEntry } from './ManagerApp.js';

interface StatusViewProps {
  config: AgentConfig;
  connected: boolean;
  agentId: string | undefined;
  executor: ProbeExecutor;
  auditLog: AgentAuditLog;
  activity: ActivityEntry[];
}

export function StatusView({
  config,
  connected,
  agentId,
  executor,
  auditLog,
  activity,
}: StatusViewProps): JSX.Element {
  const packs = executor.getLoadedPacks();
  const chainResult = auditLog.verifyChain();
  const recentEntries = auditLog.getRecent();
  const lastEntry = activity.length > 0 ? activity[activity.length - 1] : undefined;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Agent
        </Text>
        <Text>
          {'  '}Name: <Text color="cyan">{config.agentName}</Text>
        </Text>
        <Text>
          {'  '}ID: <Text color="cyan">{agentId ?? '(pending)'}</Text>
        </Text>
        <Text>
          {'  '}Hub: <Text color="cyan">{config.hubUrl}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Connection
        </Text>
        <Text>
          {'  '}Status:{' '}
          <Text color={connected ? 'green' : 'yellow'}>
            {connected ? 'Connected' : 'Connecting...'}
          </Text>
        </Text>
        <Text>
          {'  '}Packs loaded: <Text color="cyan">{packs.length}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Packs
        </Text>
        {packs.map((pack) => (
          <Text key={pack.name}>
            {'  '}
            <Text color="cyan">{pack.name}</Text> <Text color="gray">v{pack.version}</Text>{' '}
            <Text color="green">[{pack.status}]</Text>
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Activity
        </Text>
        <Text>
          {'  '}Total probes: <Text color="cyan">{activity.length}</Text>
        </Text>
        <Text>
          {'  '}Last:{' '}
          <Text color="gray">
            {lastEntry ? `${lastEntry.probe} (${lastEntry.durationMs}ms)` : 'No activity yet'}
          </Text>
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold color="white">
          Audit
        </Text>
        <Text>
          {'  '}Chain:{' '}
          <Text color={chainResult.valid ? 'green' : 'red'}>
            {chainResult.valid ? 'Valid' : `Broken at entry ${chainResult.brokenAt}`}
          </Text>
          <Text color="gray"> ({recentEntries.length} entries)</Text>
        </Text>
      </Box>
    </Box>
  );
}
