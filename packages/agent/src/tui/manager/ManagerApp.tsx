import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { AgentConfig } from '../../config.js';
import { saveConfig } from '../../config.js';
import type { AgentConnection, ConnectionEvents } from '../../runtime/connection.js';
import type { ProbeExecutor } from '../../runtime/executor.js';
import { ActivityLog } from './ActivityLog.js';
import { AuditView } from './AuditView.js';
import { PackManager } from './PackManager.js';
import { StatusView } from './StatusView.js';

type View = 'status' | 'packs' | 'activity' | 'audit';

export interface ActivityEntry {
  timestamp: string;
  probe: string;
  status: string;
  durationMs: number;
}

interface Runtime {
  config: AgentConfig;
  executor: ProbeExecutor;
  connection: AgentConnection;
}

interface ManagerAppProps {
  createRuntime: (events: ConnectionEvents) => Runtime;
  onDetach?: () => void;
}

const MAX_ACTIVITY = 50;

export function ManagerApp({ createRuntime, onDetach }: ManagerAppProps): JSX.Element {
  const { exit } = useApp();
  const [view, setView] = useState<View>('status');
  const [connected, setConnected] = useState(false);
  const [agentId, setAgentId] = useState<string | undefined>();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const runtimeRef = useRef<Runtime | null>(null);

  useEffect(() => {
    const runtime = createRuntime({
      onConnected: (id) => {
        setConnected(true);
        setAgentId(id);
      },
      onDisconnected: () => {
        setConnected(false);
      },
      onError: () => {},
      onRegistered: (id) => {
        runtime.config.agentId = id;
        saveConfig(runtime.config);
      },
      onProbeCompleted: (probe, status, durationMs) => {
        setActivity((prev) => {
          const entry: ActivityEntry = {
            timestamp: new Date().toISOString(),
            probe,
            status,
            durationMs,
          };
          const next = [...prev, entry];
          return next.length > MAX_ACTIVITY ? next.slice(-MAX_ACTIVITY) : next;
        });
      },
    });

    runtimeRef.current = runtime;
    runtime.connection.start();

    return () => {
      runtime.connection.stop();
    };
  }, [createRuntime]);

  useInput((input) => {
    switch (input) {
      case 's':
        setView('status');
        break;
      case 'p':
        setView('packs');
        break;
      case 'l':
        setView('activity');
        break;
      case 'a':
        setView('audit');
        break;
      case 'q':
        runtimeRef.current?.connection.stop();
        onDetach?.();
        exit();
        break;
    }
  });

  const runtime = runtimeRef.current;
  const config = runtime?.config;
  const executor = runtime?.executor;
  const auditLog = runtime?.connection.getAuditLog();

  const statusColor = connected ? 'green' : 'yellow';
  const statusText = connected ? 'Connected' : 'Connecting...';
  const displayId = agentId ? ` (${agentId})` : '';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Sonde Agent
        </Text>
        <Text> </Text>
        <Text color={statusColor}>{statusText}</Text>
        <Text color="gray">{displayId}</Text>
      </Box>

      {view === 'status' && config && executor && auditLog && (
        <StatusView
          config={config}
          connected={connected}
          agentId={agentId}
          executor={executor}
          auditLog={auditLog}
          activity={activity}
        />
      )}

      {view === 'packs' && executor && <PackManager executor={executor} />}

      {view === 'activity' && <ActivityLog activity={activity} />}

      {view === 'audit' && auditLog && <AuditView auditLog={auditLog} />}

      <Box marginTop={1}>
        <Text color={view === 'status' ? 'cyan' : 'gray'} bold={view === 'status'}>
          s:status
        </Text>
        <Text> </Text>
        <Text color={view === 'packs' ? 'cyan' : 'gray'} bold={view === 'packs'}>
          p:packs
        </Text>
        <Text> </Text>
        <Text color={view === 'activity' ? 'cyan' : 'gray'} bold={view === 'activity'}>
          l:activity
        </Text>
        <Text> </Text>
        <Text color={view === 'audit' ? 'cyan' : 'gray'} bold={view === 'audit'}>
          a:audit
        </Text>
        <Text> </Text>
        <Text color="gray">q:detach</Text>
      </Box>
    </Box>
  );
}
