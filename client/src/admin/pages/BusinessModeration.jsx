import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import adminApi from '../../lib/adminApi';

export default function BusinessModeration() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 25, search: search.trim() || undefined };
      if (activeFilter === 'true' || activeFilter === 'false') params.active = activeFilter;
      const { data } = await adminApi.get('/admin/moderation/businesses', { params });
      setRows(data.businesses || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load businesses.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, activeFilter]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (b, nextActive) => {
    const reason = window.prompt(
      nextActive ? 'Optional note (reactivating):' : 'Reason for deactivating (recommended):'
    );
    try {
      await adminApi.put(`/admin/moderation/businesses/${b.id}`, {
        is_active: nextActive,
        reason: reason || undefined,
      });
      load();
    } catch (e) {
      window.alert(e.response?.data?.error || 'Update failed.');
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Businesses</h1>
      <p className="text-gray-400 text-sm mb-6">
        Deactivate a business to remove it from normal operations; owner account is unchanged.
      </p>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name, description, owner…"
          className="flex-1 min-w-[200px] max-w-md px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
        />
        <select
          value={activeFilter}
          onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
        >
          <option value="">All</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-gray-400">
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No businesses found.</td></tr>
            ) : (
              rows.map((b) => (
                <tr key={b.id} className="border-b border-slate-700/60 hover:bg-slate-700/20">
                  <td className="px-4 py-3 text-white font-medium">{b.business_name}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-200">{b.owner_name}</div>
                    <div className="text-xs text-gray-500">{b.owner_email}</div>
                    <Link to={`/admin/users/${b.user_id}`} className="text-xs text-orange-400 hover:underline">User</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {[b.address_city, b.address_state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${b.is_active ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                      {b.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {b.is_active ? (
                      <button
                        type="button"
                        onClick={() => toggle(b, false)}
                        className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(b, true)}
                        className="text-xs px-2 py-1 rounded bg-green-900/40 text-green-300 hover:bg-green-900/60"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 25 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded bg-slate-800 text-gray-300 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-gray-400 text-sm py-1">Page {page}</span>
          <button
            type="button"
            disabled={page * 25 >= total}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded bg-slate-800 text-gray-300 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
