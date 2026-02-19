import { Box, Text } from 'ink';
import type { AgentConfig } from '../../config.js';

interface StatusInfoViewProps {
  config: AgentConfig | undefined;
  version: string;
  configPath: string;
  serviceInstalled: boolean;
  serviceStatus: string;
  daemonPid: number | undefined;
  enabledPackNames: string[];
}

export function StatusInfoView({
  config,
  version,
  configPath,
  serviceInstalled,
  serviceStatus,
  daemonPid,
  enabledPackNames,
}: StatusInfoViewProps): JSX.Element {
  if (!config) {
    return (
      <Box flexDirection="column">
        <Text>
          Not enrolled. Run <Text color="cyan">sonde enroll</Text> or{' '}
          <Text color="cyan">sonde install</Text> to get started.
        </Text>
      </Box>
    );
  }

  const processStatus = serviceInstalled
    ? `service ${serviceStatus}`
    : daemonPid
      ? `running (PID ${daemonPid})`
      : 'stopped';

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
          {'  '}Hub: <Text color="cyan">{config.hubUrl}</Text>
        </Text>
        <Text>
          {'  '}ID: <Text color="cyan">{config.agentId ?? '(not assigned)'}</Text>
        </Text>
        <Text>
          {'  '}Config: <Text color="cyan">{configPath}</Text>
        </Text>
        <Text>
          {'  '}Version: <Text color="cyan">v{version}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Process
        </Text>
        <Text>
          {'  '}Status:{' '}
          <Text color={daemonPid || serviceStatus === 'active' ? 'green' : 'yellow'}>
            {processStatus}
          </Text>
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text bold color="white">
          Packs ({enabledPackNames.length})
        </Text>
        {enabledPackNames.map((name) => (
          <Text key={name}>
            {'  '}
            <Text color="cyan">{name}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
