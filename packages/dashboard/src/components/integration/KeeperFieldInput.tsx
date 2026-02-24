import { useEffect, useState } from 'react';

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  sensitive?: boolean;
  tooltip?: string;
}

interface KeeperIntegration {
  id: string;
  name: string;
}

interface CredentialSource {
  type: 'direct' | 'keeper';
  keeperIntegrationId?: string;
  recordUid?: string;
  fieldType?: string;
}

interface KeeperFieldInputProps {
  field: CredentialField;
  value: string;
  onChange: (value: string) => void;
  keeperIntegrations: KeeperIntegration[];
  existingSource?: CredentialSource;
  visibleFields: Set<string>;
  toggleFieldVisibility: (key: string) => void;
}

type SourceMode = 'direct' | 'keeper';

const FIELD_TYPE_OPTIONS = [
  { value: 'login', label: 'Login' },
  { value: 'password', label: 'Password' },
  { value: 'url', label: 'URL' },
  { value: 'oneTimeCode', label: 'One-Time Code' },
  { value: 'custom', label: 'Custom' },
];

function parseKeeperRef(value: string): {
  keeperIntegrationId: string;
  recordUid: string;
  fieldType: string;
  isCustom: boolean;
} | null {
  const fieldMatch = value.match(/^keeper:\/\/([^/]+)\/([^/]+)\/field\/(.+)$/);
  if (fieldMatch?.[1] && fieldMatch[2] && fieldMatch[3]) {
    return {
      keeperIntegrationId: fieldMatch[1],
      recordUid: fieldMatch[2],
      fieldType: fieldMatch[3],
      isCustom: false,
    };
  }
  const customMatch = value.match(/^keeper:\/\/([^/]+)\/([^/]+)\/custom_field\/(.+)$/);
  if (customMatch?.[1] && customMatch[2] && customMatch[3]) {
    return {
      keeperIntegrationId: customMatch[1],
      recordUid: customMatch[2],
      fieldType: customMatch[3],
      isCustom: true,
    };
  }
  return null;
}

export function KeeperFieldInput({
  field,
  value,
  onChange,
  keeperIntegrations,
  existingSource,
  visibleFields,
  toggleFieldVisibility,
}: KeeperFieldInputProps) {
  const showKeeperOption = keeperIntegrations.length > 0 && field.sensitive === true;

  const initialMode: SourceMode = existingSource?.type === 'keeper' ? 'keeper' : 'direct';

  const [mode, setMode] = useState<SourceMode>(initialMode);
  const [keeperIntegrationId, setKeeperIntegrationId] = useState(
    existingSource?.keeperIntegrationId ??
      (keeperIntegrations.length === 1 && keeperIntegrations[0] ? keeperIntegrations[0].id : ''),
  );
  const [recordUid, setRecordUid] = useState(existingSource?.recordUid ?? '');
  const [fieldType, setFieldType] = useState(existingSource?.fieldType ?? 'password');
  const [isCustomFieldType, setIsCustomFieldType] = useState(false);
  const [customFieldLabel, setCustomFieldLabel] = useState('');

  useEffect(() => {
    if (existingSource?.type === 'keeper') {
      setMode('keeper');
      if (existingSource.keeperIntegrationId) {
        setKeeperIntegrationId(existingSource.keeperIntegrationId);
      }
      if (existingSource.recordUid) {
        setRecordUid(existingSource.recordUid);
      }
      if (existingSource.fieldType) {
        const parsed = parseKeeperRef(value);
        if (parsed?.isCustom) {
          setIsCustomFieldType(true);
          setCustomFieldLabel(parsed.fieldType);
          setFieldType('custom');
        } else {
          const knownTypes = FIELD_TYPE_OPTIONS.map((o) => o.value).filter((v) => v !== 'custom');
          if (knownTypes.includes(existingSource.fieldType)) {
            setFieldType(existingSource.fieldType);
          } else {
            setIsCustomFieldType(true);
            setCustomFieldLabel(existingSource.fieldType);
            setFieldType('custom');
          }
        }
      }
    }
  }, [existingSource, value]);

  const buildKeeperRef = (
    intId: string,
    uid: string,
    fType: string,
    isCustom: boolean,
    customLabel: string,
  ) => {
    if (!intId || !uid) return '';
    if (isCustom) {
      if (!customLabel) return '';
      return `keeper://${intId}/${uid}/custom_field/${customLabel}`;
    }
    return `keeper://${intId}/${uid}/field/${fType}`;
  };

  const updateKeeperValue = (
    nextIntId: string,
    nextUid: string,
    nextFieldType: string,
    nextIsCustom: boolean,
    nextCustomLabel: string,
  ) => {
    const ref = buildKeeperRef(nextIntId, nextUid, nextFieldType, nextIsCustom, nextCustomLabel);
    onChange(ref);
  };

  const handleModeSwitch = (newMode: SourceMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    if (newMode === 'direct') {
      onChange('');
      setRecordUid('');
      setFieldType('password');
      setIsCustomFieldType(false);
      setCustomFieldLabel('');
    } else {
      const intId =
        keeperIntegrations.length === 1 && keeperIntegrations[0]
          ? keeperIntegrations[0].id
          : keeperIntegrationId;
      setKeeperIntegrationId(intId);
      updateKeeperValue(intId, recordUid, fieldType, isCustomFieldType, customFieldLabel);
    }
  };

  if (!showKeeperOption) {
    return (
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase mb-1">{field.label}</p>
        <div className="relative">
          <input
            type={field.sensitive && !visibleFields.has(field.key) ? 'password' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none pr-16"
          />
          {field.sensitive && (
            <button
              type="button"
              onClick={() => toggleFieldVisibility(field.key)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
            >
              {visibleFields.has(field.key) ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {field.tooltip && <p className="mt-0.5 text-xs text-gray-500">{field.tooltip}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-gray-500 uppercase">{field.label}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => handleModeSwitch('direct')}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              mode === 'direct'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-300'
            }`}
          >
            Enter value
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('keeper')}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              mode === 'keeper'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-300'
            }`}
          >
            From Keeper
          </button>
        </div>
      </div>

      {mode === 'direct' ? (
        <>
          <div className="relative">
            <input
              type={field.sensitive && !visibleFields.has(field.key) ? 'password' : 'text'}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none pr-16"
            />
            {field.sensitive && (
              <button
                type="button"
                onClick={() => toggleFieldVisibility(field.key)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
              >
                {visibleFields.has(field.key) ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          {field.tooltip && <p className="mt-0.5 text-xs text-gray-500">{field.tooltip}</p>}
        </>
      ) : (
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Keeper Integration</p>
            <select
              value={keeperIntegrationId}
              onChange={(e) => {
                setKeeperIntegrationId(e.target.value);
                updateKeeperValue(
                  e.target.value,
                  recordUid,
                  fieldType,
                  isCustomFieldType,
                  customFieldLabel,
                );
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              {keeperIntegrations.length > 1 && (
                <option value="">Select a Keeper integration</option>
              )}
              {keeperIntegrations.map((ki) => (
                <option key={ki.id} value={ki.id}>
                  {ki.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Record UID</p>
            <input
              type="text"
              value={recordUid}
              onChange={(e) => {
                setRecordUid(e.target.value);
                updateKeeperValue(
                  keeperIntegrationId,
                  e.target.value,
                  fieldType,
                  isCustomFieldType,
                  customFieldLabel,
                );
              }}
              placeholder="Keeper record UID"
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-0.5 text-xs text-gray-500">
              The UID of the Keeper record containing this credential
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Field Type</p>
            <select
              value={isCustomFieldType ? 'custom' : fieldType}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  setIsCustomFieldType(true);
                  setFieldType('custom');
                  updateKeeperValue(
                    keeperIntegrationId,
                    recordUid,
                    'custom',
                    true,
                    customFieldLabel,
                  );
                } else {
                  setIsCustomFieldType(false);
                  setCustomFieldLabel('');
                  setFieldType(val);
                  updateKeeperValue(keeperIntegrationId, recordUid, val, false, '');
                }
              }}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              {FIELD_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {isCustomFieldType && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Custom Field Label</p>
              <input
                type="text"
                value={customFieldLabel}
                onChange={(e) => {
                  setCustomFieldLabel(e.target.value);
                  updateKeeperValue(keeperIntegrationId, recordUid, 'custom', true, e.target.value);
                }}
                placeholder="Custom field label in the record"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
