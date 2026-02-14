import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import type { AgentAuditEntry, AgentAuditLog } from '../../runtime/audit.js';

interface AuditViewProps {
  auditLog: AgentAuditLog;
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

export function AuditView({ auditLog }: AuditViewProps): JSX.Element {
  const [entries, setEntries] = useState<AgentAuditEntry[]>([]);
  const [chainValid, setChainValid] = useState(true);
  const [totalEntries, setTotalEntries] = useState(0);

  useEffect(() => {
    const all = auditLog.getRecent();
    setTotalEntries(all.length);
    setEntries(auditLog.getRecent(100));
    setChainValid(auditLog.verifyChain().valid);
  }, [auditLog]);

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        Audit Chain:{' '}
        <Text color={chainValid ? 'green' : 'red'}>{chainValid ? 'Valid' : 'Broken'}</Text>
        <Text color="gray"> ({totalEntries} entries)</Text>
      </Text>

      {entries.length === 0 ? (
        <Box marginTop={1}>
          <Text color="gray">No audit entries yet.</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text bold color="gray">
              {'Time      Probe                     Status     Duration  Hash'}
            </Text>
          </Box>
          {entries.map((entry, i) => (
            <Box key={`${entry.timestamp}-${i}`}>
              <Text color="gray">{formatTime(entry.timestamp)} </Text>
              <Text color="white">{entry.probe.padEnd(25)}</Text>
              <Text color={statusColor(entry.status)}>{entry.status.padEnd(11)}</Text>
              <Text color="gray">{String(entry.durationMs).padStart(4)}ms </Text>
              <Text color="gray">
                {entry.prevHash ? `${entry.prevHash.slice(0, 7)}...` : '(genesis)'}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
