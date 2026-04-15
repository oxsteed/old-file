import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import adminApi from '../../lib/adminApi';

export default function ToolRentalModeration() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [avail, setAvail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 25, search: search.trim() || undefined };
      if (avail === 'true' || avail === 'false') params.available = avail;
      const { data } = await adminApi.get('/admin/moderation/tool-rentals', { params });
      setRows(data.tools || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load listings.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, avail]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (t, next) => {
    const reason = window.prompt('Optional note for audit log:') || '';
    try {
      await adminApi.put(`/admin/moderation/tool-rentals/${t.id}`, {
        is_available: next,
        reason: reason || undefined,
      });
      load();
    } catch (e) {
      window.alert(e.response?.data?.error || 'Update failed.');
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Tool rentals</h1>
      <p className="text-gray-400 text-sm mb-6">Disable a listing to hide it from browse results.</p>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search title, description, owner email…"
          className="flex-1 min-w-[200px] max-w-md px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
        />
        <select
          value={avail}
          onChange={(e) => { setAvail(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
        >
          <option value="">All</option>
          <option value="true">Available</option>
          <option value="false">Unavailable</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-gray-400">
              <th className="px-4 py-3">Listing</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Rate</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No listings.</td></tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id} className="border-b border-slate-700/60 hover:bg-slate-700/20">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.category || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-200">{t.owner_name}</div>
                    <div className="text-xs text-gray-500">{t.owner_email}</div>
                    <Link to={`/admin/users/${t.user_id}`} className="text-xs text-orange-400 hover:underline">User</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {t.daily_rate != null ? `$${Number(t.daily_rate).toFixed(2)}/day` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${t.is_available ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-gray-400'}`}>
                      {t.is_available ? 'available' : 'unavailable'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {t.is_available ? (
                      <button
                        type="button"
                        onClick={() => toggle(t, false)}
                        className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(t, true)}
                        className="text-xs px-2 py-1 rounded bg-green-900/40 text-green-300 hover:bg-green-900/60"
                      >
                        Enable
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
