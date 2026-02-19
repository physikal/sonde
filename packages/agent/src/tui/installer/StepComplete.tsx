import { packRegistry } from '@sonde/packs';
import type { PackManifest } from '@sonde/shared';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { buildEnabledPacks } from '../../cli/packs.js';
import { type AgentConfig, saveConfig } from '../../config.js';
import { enrollWithHub } from '../../runtime/connection.js';
import { ProbeExecutor } from '../../runtime/executor.js';
import type { HubConfig } from './InstallerApp.js';

interface StepCompleteProps {
  hubConfig: HubConfig;
  selectedPacks: PackManifest[];
}

export function StepComplete({ hubConfig, selectedPacks }: StepCompleteProps): JSX.Element {
  const { exit } = useApp();
  const [enrolling, setEnrolling] = useState(true);
  const [agentId, setAgentId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const selectedNames = new Set(selectedPacks.map((p) => p.name));
    const disabledPacks = [...packRegistry.keys()]
      .filter((name) => !selectedNames.has(name));
    const config: AgentConfig = {
      hubUrl: hubConfig.hubUrl,
      apiKey: hubConfig.apiKey,
      agentName: hubConfig.agentName,
      disabledPacks: disabledPacks.length > 0
        ? disabledPacks
        : undefined,
    };
    saveConfig(config);

    const enabledPacks = buildEnabledPacks(
      packRegistry, disabledPacks,
    );
    const executor = new ProbeExecutor(enabledPacks);

    enrollWithHub(config, executor)
      .then(({ agentId: id, apiKey: mintedKey }) => {
        config.agentId = id;
        if (mintedKey) {
          config.apiKey = mintedKey;
        }
        saveConfig(config);
        setAgentId(id);
        setEnrolling(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setEnrolling(false);
      });
  }, [hubConfig]);

  useInput(() => {
    if (!enrolling) {
      exit();
    }
  });

  if (enrolling) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Enrolling with hub at {hubConfig.hubUrl}...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Enrollment failed: {error}</Text>
        <Box marginTop={1}>
          <Text color="gray">Press any key to exit.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green" bold>
        Enrollment successful!
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text> Agent ID: {agentId}</Text>
        <Text> Hub URL: {hubConfig.hubUrl}</Text>
        <Text> Name: {hubConfig.agentName}</Text>
        <Text>
          {'  '}Packs: {selectedPacks.map((p) => p.name).join(', ') || '(none)'}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Next steps:</Text>
        <Text color="cyan"> sonde start</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Press any key to exit.</Text>
      </Box>
    </Box>
  );
}
