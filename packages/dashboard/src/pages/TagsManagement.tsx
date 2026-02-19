import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { TagBadge } from '../components/common/TagBadge';
import { useToast } from '../components/common/Toast';
import { apiFetch } from '../lib/api';
import { getTagColor } from '../lib/tag-colors';

interface TagEntry {
  tag: string;
  agentCount: number;
  integrationCount: number;
  totalCount: number;
}

type SortKey = 'tag' | 'agentCount' | 'integrationCount' | 'totalCount';
type SortDir = 'asc' | 'desc';

export function TagsManagement() {
  const { toast } = useToast();
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TagEntry | null>(null);

  const fetchTags = useCallback(async () => {
    try {
      const data = await apiFetch<{ tags: TagEntry[] }>('/tags');
      setTags(data.tags);
    } catch {
      toast('Failed to load tags', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = q ? tags.filter((t) => t.tag.toLowerCase().includes(q)) : tags;
    return [...list].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [tags, search, sortKey, sortDir]);

  const top10 = useMemo(
    () => [...tags].sort((a, b) => b.totalCount - a.totalCount).slice(0, 10),
    [tags],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'tag' ? 'asc' : 'desc');
    }
  };

  const handleRename = async (oldTag: string) => {
    const newName = editValue.trim();
    if (!newName || newName === oldTag) {
      setEditingTag(null);
      return;
    }
    try {
      await apiFetch(`/tags/${encodeURIComponent(oldTag)}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ newName }),
      });
      toast(`Renamed "${oldTag}" to "${newName}"`, 'success');
      setEditingTag(null);
      fetchTags();
    } catch {
      toast(`Failed to rename "${oldTag}"`, 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/tags/${encodeURIComponent(deleteTarget.tag)}`, {
        method: 'DELETE',
      });
      toast(`Deleted "${deleteTarget.tag}"`, 'success');
      setDeleteTarget(null);
      fetchTags();
    } catch {
      toast(`Failed to delete "${deleteTarget.tag}"`, 'error');
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, tag: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRename(tag);
    }
    if (e.key === 'Escape') {
      setEditingTag(null);
    }
  };

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  if (loading) {
    return (
      <div className="p-8 text-gray-400">Loading tags...</div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-white">Tags</h1>
        <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-400">
          {tags.length}
        </span>
      </div>

      {/* Top 10 */}
      {top10.length > 0 && (
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Most Used
          </h2>
          <div className="flex flex-wrap gap-2">
            {top10.map((t) => {
              const color = getTagColor(t.tag);
              return (
                <div
                  key={t.tag}
                  className="flex items-center gap-2 rounded-md border border-gray-800 px-3 py-1.5"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color.text }}
                  />
                  <span className="text-sm text-gray-300">{t.tag}</span>
                  <span className="text-xs text-gray-500">{t.totalCount}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Filter tags..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
      />

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/50">
            <tr>
              <th className="w-8 px-4 py-3" />
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300"
                onClick={() => toggleSort('tag')}
              >
                Tag{sortArrow('tag')}
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300"
                onClick={() => toggleSort('agentCount')}
              >
                Agents{sortArrow('agentCount')}
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300"
                onClick={() => toggleSort('integrationCount')}
              >
                Integrations{sortArrow('integrationCount')}
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300"
                onClick={() => toggleSort('totalCount')}
              >
                Total{sortArrow('totalCount')}
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'No tags match your filter.' : 'No tags found.'}
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const color = getTagColor(t.tag);
                return (
                  <tr key={t.tag} className="hover:bg-gray-900/30">
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: color.text }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {editingTag === t.tag ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, t.tag)}
                          onBlur={() => handleRename(t.tag)}
                          autoFocus
                          className="w-40 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTag(t.tag);
                            setEditValue(t.tag);
                          }}
                          className="cursor-pointer text-left"
                          title="Click to rename"
                        >
                          <TagBadge tag={t.tag} />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{t.agentCount}</td>
                    <td className="px-4 py-2.5 text-gray-400">{t.integrationCount}</td>
                    <td className="px-4 py-2.5 text-gray-300">{t.totalCount}</td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(t)}
                        className="text-gray-500 hover:text-red-400"
                        title="Delete tag"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h3 className="text-lg font-medium text-white">Delete Tag</h3>
            <p className="mt-2 text-sm text-gray-400">
              Remove <TagBadge tag={deleteTarget.tag} /> from{' '}
              {deleteTarget.agentCount} agent{deleteTarget.agentCount !== 1 ? 's' : ''} and{' '}
              {deleteTarget.integrationCount} integration{deleteTarget.integrationCount !== 1 ? 's' : ''}?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
