import type { PackManifest } from '@sonde/shared';
import { Box, Text } from 'ink';
import { useState } from 'react';
import type { ScanResult } from '../../system/scanner.js';
import { StepComplete } from './StepComplete.js';
import { StepHub } from './StepHub.js';
import { StepPacks } from './StepPacks.js';
import { StepPermissions } from './StepPermissions.js';
import { StepScan } from './StepScan.js';

type Step = 'hub' | 'scan' | 'packs' | 'permissions' | 'complete';

export interface HubConfig {
  hubUrl: string;
  apiKey: string;
  agentName: string;
}

const STEP_LABELS: Record<Step, string> = {
  hub: 'Hub Connection',
  scan: 'System Scan',
  packs: 'Pack Selection',
  permissions: 'Permissions',
  complete: 'Complete',
};

interface InstallerAppProps {
  initialHubUrl?: string;
}

export function InstallerApp({ initialHubUrl }: InstallerAppProps): JSX.Element {
  const [step, setStep] = useState<Step>('hub');
  const [hubConfig, setHubConfig] = useState<HubConfig>({ hubUrl: '', apiKey: '', agentName: '' });
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [selectedPacks, setSelectedPacks] = useState<PackManifest[]>([]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Sonde Installer
        </Text>
        <Text color="gray"> — {STEP_LABELS[step]}</Text>
      </Box>

      {step === 'hub' && (
        <StepHub
          initialHubUrl={initialHubUrl}
          onNext={(config) => {
            setHubConfig(config);
            setStep('scan');
          }}
        />
      )}

      {step === 'scan' && (
        <StepScan
          onNext={(results) => {
            setScanResults(results);
            setStep('packs');
          }}
        />
      )}

      {step === 'packs' && (
        <StepPacks
          scanResults={scanResults}
          onNext={(packs) => {
            setSelectedPacks(packs);
            setStep('permissions');
          }}
        />
      )}

      {step === 'permissions' && (
        <StepPermissions
          selectedPacks={selectedPacks}
          onNext={() => setStep('complete')}
          onBack={() => setStep('packs')}
        />
      )}

      {step === 'complete' && <StepComplete hubConfig={hubConfig} selectedPacks={selectedPacks} />}
    </Box>
  );
}
