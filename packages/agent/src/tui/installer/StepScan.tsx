import { packRegistry } from '@sonde/packs';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { type ScanResult, createSystemChecker, scanForSoftware } from '../../system/scanner.js';

interface StepScanProps {
  onNext: (results: ScanResult[]) => void;
}

export function StepScan({ onNext }: StepScanProps): JSX.Element {
  const [scanning, setScanning] = useState(true);
  const [results, setResults] = useState<ScanResult[]>([]);

  useEffect(() => {
    const manifests = [...packRegistry.values()].map((p) => p.manifest);
    const checker = createSystemChecker();
    const scanResults = scanForSoftware(manifests, checker);
    setResults(scanResults);
    setScanning(false);

    const timer = setTimeout(() => {
      onNext(scanResults);
    }, 1500);
    return () => clearTimeout(timer);
  }, [onNext]);

  if (scanning) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Scanning system for known software...</Text>
      </Box>
    );
  }

  const detected = results.filter((r) => r.detected);
  const notDetected = results.filter((r) => !r.detected);

  return (
    <Box flexDirection="column">
      <Text color="green">Scan complete!</Text>
      <Box marginTop={1} flexDirection="column">
        {detected.length > 0 && (
          <>
            <Text bold>Detected:</Text>
            {detected.map((r) => (
              <Text key={r.packName} color="green">
                {'  '}
                {r.packName} — {formatMatches(r)}
              </Text>
            ))}
          </>
        )}
        {notDetected.length > 0 && (
          <Box marginTop={detected.length > 0 ? 1 : 0} flexDirection="column">
            <Text bold>Not detected:</Text>
            {notDetected.map((r) => (
              <Text key={r.packName} color="gray">
                {'  '}
                {r.packName}
              </Text>
            ))}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Continuing to pack selection...</Text>
      </Box>
    </Box>
  );
}

function formatMatches(r: ScanResult): string {
  const parts: string[] = [];
  if (r.matchedCommands.length > 0) parts.push(`commands: ${r.matchedCommands.join(', ')}`);
  if (r.matchedFiles.length > 0) parts.push(`files: ${r.matchedFiles.join(', ')}`);
  if (r.matchedServices.length > 0) parts.push(`services: ${r.matchedServices.join(', ')}`);
  return parts.join('; ');
}
