import { type FormEvent, useEffect, useState } from 'react';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface McpInstructionsData {
  customPrefix: string;
  preview: string;
}

export function McpInstructions() {
  const { toast } = useToast();
  const [customPrefix, setCustomPrefix] = useState('');
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<McpInstructionsData>('/settings/mcp-instructions')
      .then((data) => {
        setCustomPrefix(data.customPrefix);
        setPreview(data.preview);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await apiFetch<{ ok: boolean; preview: string }>(
        '/settings/mcp-instructions',
        {
          method: 'PUT',
          body: JSON.stringify({ customPrefix }),
        },
      );
      setPreview(result.preview);
      toast('MCP instructions saved', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : 'Failed to save MCP instructions';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 p-8">
        <h1 className="text-2xl font-semibold text-white">
          MCP Prompt
        </h1>
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          <p className="text-sm text-gray-400">Loading...</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-white">MCP Prompt</h1>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">
          Custom Prefix
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          Add organization-specific guidance that will be prepended to
          the instructions sent to AI clients. This appears before the
          core Sonde instructions in the MCP handshake.
        </p>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <textarea
            value={customPrefix}
            onChange={(e) => setCustomPrefix(e.target.value)}
            maxLength={2000}
            rows={6}
            placeholder="e.g. You are assisting the ACME Corp infrastructure team. Our critical systems are tagged #prod. Always check #prod agents first when asked about outages."
            className="block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {customPrefix.length}/2000 characters
            </span>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">
          Full Instructions Preview
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          This is the complete instructions string sent to AI clients
          during the MCP handshake. It includes your custom prefix, the
          core Sonde guidance, and any active integrations.
        </p>
        <pre className="mt-4 max-h-96 overflow-auto rounded-md border border-gray-700 bg-gray-800/50 p-4 text-sm text-gray-300 font-mono whitespace-pre-wrap">
          {preview}
        </pre>
      </section>
    </div>
  );
}
