import { type ChangeEvent, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface CsvEntry {
  name: string;
  tags: string[];
}

interface ImportResult {
  updated: number;
  notFound: string[];
}

interface CsvImportModalProps {
  type: 'agent' | 'integration';
  onClose: () => void;
  onImported: () => void;
}

function parseCsv(text: string): CsvEntry[] {
  const entries: CsvEntry[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header row if it looks like one
    if (/^name[,;]/i.test(trimmed)) continue;

    // Split on first comma or semicolon to get name
    const firstSep = trimmed.search(/[,;]/);
    if (firstSep < 0) continue;

    const name = trimmed.slice(0, firstSep).trim();
    const rest = trimmed.slice(firstSep + 1).trim();
    if (!name || !rest) continue;

    // Tags can be comma or semicolon separated
    const tags = rest
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tags.length > 0) {
      entries.push({ name, tags });
    }
  }

  return entries;
}

export function CsvImportModal({ type, onClose, onImported }: CsvImportModalProps) {
  const [entries, setEntries] = useState<CsvEntry[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseCsv(text);
      setEntries(parsed);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const data = await apiFetch<ImportResult>('/tags/import', {
        method: 'POST',
        body: JSON.stringify({ type, entries }),
      });
      setResult(data);
      onImported();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-white">
            Import Tags ({type === 'agent' ? 'Agents' : 'Integrations'})
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            &times;
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-400">
          CSV format: name,tag1,tag2,tag3 (one row per {type})
        </p>

        <div className="mt-4">
          <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-700 p-4 text-sm text-gray-400 hover:border-gray-500">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFile}
              className="hidden"
            />
            {fileName ?? 'Choose CSV file'}
          </label>
        </div>

        {entries.length > 0 && !result && (
          <>
            <div className="mt-4 max-h-48 overflow-y-auto rounded border border-gray-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-800 text-gray-500">
                  <tr>
                    <th className="px-3 py-1.5">Name</th>
                    <th className="px-3 py-1.5">Tags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {entries.map((entry) => (
                    <tr key={entry.name} className="bg-gray-950">
                      <td className="px-3 py-1.5 text-white">{entry.name}</td>
                      <td className="px-3 py-1.5 text-gray-400">
                        {entry.tags.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'} found
            </p>
          </>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm">
            <p className="text-emerald-300">
              {result.updated} {result.updated === 1 ? 'entry' : 'entries'} updated
            </p>
            {result.notFound.length > 0 && (
              <p className="mt-1 text-amber-300">
                Not found: {result.notFound.join(', ')}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && entries.length > 0 && (
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
