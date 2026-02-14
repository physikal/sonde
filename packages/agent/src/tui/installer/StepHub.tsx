import os from 'node:os';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';
import type { HubConfig } from './InstallerApp.js';

interface StepHubProps {
  onNext: (config: HubConfig) => void;
  initialHubUrl?: string;
}

type Field = 'hubUrl' | 'apiKey' | 'agentName';
const FIELDS: Field[] = ['hubUrl', 'apiKey', 'agentName'];
const FIELD_LABELS: Record<Field, string> = {
  hubUrl: 'Hub URL',
  apiKey: 'API Key',
  agentName: 'Agent Name',
};

export function StepHub({ onNext, initialHubUrl }: StepHubProps): JSX.Element {
  const [activeField, setActiveField] = useState<Field>(initialHubUrl ? 'apiKey' : 'hubUrl');
  const [hubUrl, setHubUrl] = useState(initialHubUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [agentName, setAgentName] = useState(os.hostname());
  const [error, setError] = useState('');

  const values: Record<Field, string> = { hubUrl, apiKey, agentName };
  const setters: Record<Field, (v: string) => void> = {
    hubUrl: setHubUrl,
    apiKey: setApiKey,
    agentName: setAgentName,
  };

  useInput((_input, key) => {
    if (key.tab || (key.return && activeField !== FIELDS[FIELDS.length - 1])) {
      const currentIdx = FIELDS.indexOf(activeField);
      const nextIdx = (currentIdx + 1) % FIELDS.length;
      const nextField = FIELDS[nextIdx];
      if (nextField) setActiveField(nextField);
      setError('');
      return;
    }

    if (key.return && activeField === FIELDS[FIELDS.length - 1]) {
      // Validate and submit
      if (!hubUrl.trim()) {
        setError('Hub URL is required');
        setActiveField('hubUrl');
        return;
      }
      try {
        new URL(hubUrl.trim());
      } catch {
        setError('Invalid URL format');
        setActiveField('hubUrl');
        return;
      }
      if (!apiKey.trim()) {
        setError('API Key is required');
        setActiveField('apiKey');
        return;
      }
      onNext({
        hubUrl: hubUrl.trim(),
        apiKey: apiKey.trim(),
        agentName: agentName.trim() || os.hostname(),
      });
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="gray">Enter your hub connection details. Tab to move between fields.</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.map((field) => (
          <Box key={field}>
            <Box width={14}>
              <Text color={activeField === field ? 'cyan' : 'white'}>
                {activeField === field ? '> ' : '  '}
                {FIELD_LABELS[field]}:
              </Text>
            </Box>
            <Box>
              {activeField === field ? (
                <TextInput
                  value={values[field]}
                  onChange={setters[field]}
                  placeholder={field === 'hubUrl' ? 'http://localhost:3000' : ''}
                />
              ) : (
                <Text color="gray">
                  {field === 'apiKey' && values[field]
                    ? '*'.repeat(values[field].length)
                    : values[field] || '(empty)'}
                </Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Tab: next field | Enter: submit</Text>
      </Box>
    </Box>
  );
}
