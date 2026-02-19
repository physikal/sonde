import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useState } from 'react';
import { type ServiceResult, installService } from '../../cli/service.js';

interface StepServiceProps {
  onNext: () => void;
}

type Phase = 'prompt' | 'installing' | 'done';

export function StepService({ onNext }: StepServiceProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('prompt');
  const [result, setResult] = useState<ServiceResult | null>(null);
  const isLinux = process.platform === 'linux';

  useInput((input, key) => {
    if (!isLinux) {
      if (key.return) onNext();
      return;
    }

    if (phase === 'prompt') {
      if (input === 'y' || input === 'Y' || key.return) {
        setPhase('installing');
        // Run async to let the spinner render
        setTimeout(() => {
          const res = installService();
          setResult(res);
          setPhase('done');
        }, 0);
      } else if (input === 'n' || input === 'N') {
        setResult(null);
        setPhase('done');
      }
    }

    if (phase === 'done' && (key.return || input)) {
      onNext();
    }
  });

  if (!isLinux) {
    return (
      <Box flexDirection="column">
        <Text bold>Systemd Service</Text>
        <Box marginTop={1}>
          <Text color="gray">Skipped — systemd services are only available on Linux.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press Enter to continue.</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'installing') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Installing systemd service...</Text>
      </Box>
    );
  }

  if (phase === 'done') {
    if (result === null) {
      return (
        <Box flexDirection="column">
          <Text bold>Systemd Service</Text>
          <Box marginTop={1}>
            <Text color="gray">
              Skipped. You can set this up later with:{' '}
              <Text color="cyan">sonde service install</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">Press any key to continue.</Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Text bold>Systemd Service</Text>
        <Box marginTop={1}>
          <Text color={result.success ? 'green' : 'red'}>
            {result.success ? '  OK' : '  !!'} {result.message}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press any key to continue.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Systemd Service</Text>
      <Box marginTop={1}>
        <Text>Set up sonde-agent as a systemd service? (starts on boot)</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">y: install service | n: skip</Text>
      </Box>
    </Box>
  );
}
