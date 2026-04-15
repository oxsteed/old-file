import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import adminApi from '../../lib/adminApi';

const STATUSES = ['', 'planned', 'funding', 'activating_soon', 'published', 'completed', 'cancelled'];

export default function PlannedNeedsAdmin() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminApi.get('/admin/moderation/planned-needs', {
        params: {
          page,
          limit: 25,
          status: status || undefined,
          search: search.trim() || undefined,
        },
      });
      setRows(data.needs || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load planned needs.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => { load(); }, [load]);

  const cancelAutopublish = async (id) => {
    const reason = window.prompt('Optional reason:') || '';
    try {
      await adminApi.post(`/admin/moderation/planned-needs/${id}/cancel-autopublish`, { reason });
      load();
    } catch (e) {
      window.alert(e.response?.data?.error || 'Failed.');
    }
  };

  const forceCancel = async (id) => {
    const reason = window.prompt('Reason for cancelling this planned need (required):');
    if (!reason?.trim()) return;
    try {
      const { data } = await adminApi.post(`/admin/moderation/planned-needs/${id}/force-cancel`, { reason });
      if (data.warning) window.alert(data.warning);
      load();
    } catch (e) {
      window.alert(e.response?.data?.error || 'Failed.');
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Planned needs</h1>
      <p className="text-gray-400 text-sm mb-6">
        Pull <code className="text-gray-500">activating_soon</code> back to funding, or force-cancel a need.
      </p>

      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>{s || 'All statuses'}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search title or user email…"
          className="flex-1 min-w-[200px] max-w-md px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-gray-400">
              <th className="px-4 py-3">Need</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No rows.</td></tr>
            ) : (
              rows.map((n) => (
                <tr key={n.id} className="border-b border-slate-700/60 hover:bg-slate-700/20">
                  <td className="px-4 py-3 text-white font-medium">{n.title}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-200">{n.user_name}</div>
                    <div className="text-xs text-gray-500">{n.user_email}</div>
                    <Link to={`/admin/users/${n.user_id}`} className="text-xs text-orange-400 hover:underline">User</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{n.due_date || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-slate-700 text-gray-300">{n.status}</span>
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    {n.status === 'activating_soon' && !n.published_job_id && (
                      <button
                        type="button"
                        onClick={() => cancelAutopublish(n.id)}
                        className="text-xs px-2 py-1 rounded bg-yellow-900/50 text-yellow-200 hover:bg-yellow-900/70"
                      >
                        Cancel autopublish
                      </button>
                    )}
                    {!['cancelled', 'completed', 'regenerated'].includes(n.status) && (
                      <button
                        type="button"
                        onClick={() => forceCancel(n.id)}
                        className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      >
                        Force cancel
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
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded bg-slate-800 text-gray-300 disabled:opacity-40">Previous</button>
          <span className="text-gray-400 text-sm py-1">Page {page}</span>
          <button type="button" disabled={page * 25 >= total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded bg-slate-800 text-gray-300 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
