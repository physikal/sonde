import { packRegistry } from '@sonde/packs';
import { Box, Text, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { getServiceStatus, isServiceInstalled, restartService } from '../../cli/service.js';
import {
  getConfigPath,
  loadConfig,
  readPidFile,
  saveConfig,
  stopRunningAgent,
} from '../../config.js';
import { createSystemChecker, scanForSoftware } from '../../system/scanner.js';
import { VERSION } from '../../version.js';
import type { PackRow } from './PackToggleView.js';
import { PackToggleView } from './PackToggleView.js';
import { StatusInfoView } from './StatusInfoView.js';

type View = 'status' | 'packs';

interface StatusAppProps {
  respawnAgent: () => void;
}

export function StatusApp({ respawnAgent }: StatusAppProps): JSX.Element {
  const { exit } = useApp();
  const [view, setView] = useState<View>('status');
  const [message, setMessage] = useState<string | undefined>();

  const initial = useMemo(() => {
    const config = loadConfig();
    const configPath = getConfigPath();
    const serviceInstalled = isServiceInstalled();
    const serviceStatus = serviceInstalled ? getServiceStatus() : 'not-installed';
    const daemonPid = readPidFile();

    const manifests = [...packRegistry.values()].map((p) => p.manifest);
    const disabledSet = new Set(config?.disabledPacks ?? []);
    const checker = createSystemChecker();
    const scanResults = scanForSoftware(manifests, checker);
    const scanMap = new Map(scanResults.map((r) => [r.packName, r.detected]));

    const packRows: PackRow[] = manifests.map((m) => ({
      name: m.name,
      description: m.description,
      probeCount: m.probes.length,
      detected: scanMap.get(m.name) ?? false,
      enabled: !disabledSet.has(m.name),
    }));

    const enabledPackNames = packRows.filter((r) => r.enabled).map((r) => r.name);

    return {
      config,
      configPath,
      serviceInstalled,
      serviceStatus,
      daemonPid,
      packRows,
      enabledPackNames,
    };
  }, []);

  const [packRows, setPackRows] = useState(initial.packRows);
  const [enabledPackNames, setEnabledPackNames] = useState(initial.enabledPackNames);

  useInput((input) => {
    if (view !== 'status') return;
    if (input === 'p' && initial.config) {
      setMessage(undefined);
      setView('packs');
    } else if (input === 'q') {
      exit();
    }
  });

  function handlePackConfirm(enabledNames: string[]): void {
    const config = loadConfig();
    if (!config) return;

    const allNames = packRows.map((r) => r.name);
    const enabledSet = new Set(enabledNames);
    const disabledPacks = allNames.filter((n) => !enabledSet.has(n));

    config.disabledPacks = disabledPacks;
    saveConfig(config);

    let resultMessage: string;
    const svcInstalled = isServiceInstalled();
    const svcStatus = svcInstalled ? getServiceStatus() : '';

    if (svcInstalled && svcStatus === 'active') {
      const result = restartService();
      resultMessage = result.success
        ? 'Packs saved. Service restarted.'
        : `Packs saved. ${result.message}`;
    } else if (readPidFile() !== undefined) {
      stopRunningAgent();
      respawnAgent();
      resultMessage = 'Packs saved. Agent restarted.';
    } else {
      resultMessage = 'Packs saved. Changes take effect on next start.';
    }

    const updatedRows = packRows.map((r) => ({
      ...r,
      enabled: enabledSet.has(r.name),
    }));
    setPackRows(updatedRows);
    setEnabledPackNames(enabledNames);
    setMessage(resultMessage);
    setView('status');
  }

  function handlePackBack(): void {
    setView('status');
  }

  const enrolled = initial.config !== undefined;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Sonde Agent Status
        </Text>
      </Box>

      {message && (
        <Box marginBottom={1}>
          <Text color="green">{message}</Text>
        </Box>
      )}

      {view === 'status' && (
        <StatusInfoView
          config={initial.config}
          version={VERSION}
          configPath={initial.configPath}
          serviceInstalled={initial.serviceInstalled}
          serviceStatus={initial.serviceStatus}
          daemonPid={initial.daemonPid}
          enabledPackNames={enabledPackNames}
        />
      )}

      {view === 'packs' && (
        <PackToggleView
          initialRows={packRows}
          onConfirm={handlePackConfirm}
          onBack={handlePackBack}
        />
      )}

      <Box marginTop={1}>
        {enrolled && (
          <>
            <Text color={view === 'packs' ? 'cyan' : 'gray'} bold={view === 'packs'}>
              p:packs
            </Text>
            <Text> </Text>
          </>
        )}
        <Text color="gray">q:quit</Text>
      </Box>
    </Box>
  );
}
