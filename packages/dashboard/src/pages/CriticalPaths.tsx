import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';

interface CriticalPath {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  createdAt: string;
}

export function CriticalPaths() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [paths, setPaths] = useState<CriticalPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchPaths = useCallback(() => {
    setLoading(true);
    apiFetch<{ paths: CriticalPath[] }>('/critical-paths')
      .then((data) => setPaths(data.paths))
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : 'Failed to load critical paths', 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchPaths();
  }, [fetchPaths]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const result = await apiFetch<{ id: string }>('/critical-paths', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
        }),
      });
      toast('Critical path created', 'success');
      navigate(`/critical-paths/${result.id}`);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to create critical path', 'error');
    } finally {
      setCreating(false);
    }
  };

  const filtered = search
    ? paths.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase()),
      )
    : paths;

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Critical Paths</h1>
          <p className="mt-1 text-sm text-gray-400">
            {paths.length} path{paths.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          {showCreate ? 'Cancel' : 'Create Critical Path'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-6">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase text-gray-500">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. storefront"
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-0.5 text-[11px] text-gray-500">
                Letters, numbers, dots, hyphens, and underscores only
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-gray-500">
                Description
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g. Storefront request path from LB to DB"
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mt-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or description..."
          className="w-64 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Path cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="col-span-full py-8 text-center text-gray-500">
            {search ? 'No paths match your search.' : 'No critical paths configured yet.'}
          </p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/critical-paths/${p.id}`)}
              className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-left transition-colors hover:border-gray-700 hover:bg-gray-800/50"
            >
              <h3 className="text-base font-semibold text-white">{p.name}</h3>
              {p.description && (
                <p className="mt-1 text-sm text-gray-400 line-clamp-2">
                  {p.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                <span>
                  {p.stepCount} step{p.stepCount !== 1 ? 's' : ''}
                </span>
                <span>Created {new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
