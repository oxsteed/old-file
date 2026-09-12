import { useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, ScrollText } from 'lucide-react';
import adminApi                from '../../../lib/adminApi';

export default function AuditLog() {
  const [log,     setLog]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({
    action: '', target_type: ''
  });

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await adminApi.get('/admin/audit-log', {
          params: { page, limit: 50, ...filters }
        });
        setLog(data.log || []);
        setLastLoadedAt(new Date());
      } catch (err) {
        console.error(err);
        setLog([]);
        setError(err.response?.data?.error || 'Failed to load the audit log.');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [page, filters, retry]);

  const ACTION_COLORS = {
    user_banned:          'text-red-400',
    user_unbanned:        'text-green-400',
    user_verified:        'text-blue-400',
    user_role_changed:    'text-purple-400',
    job_cancel:           'text-red-400',
    job_flag:             'text-yellow-400',
    job_unflag:           'text-gray-400',
    manual_refund_issued: 'text-orange-400',
    setting_updated:      'text-cyan-400',
    feature_flag_toggled: 'text-indigo-400',
    data_exported:        'text-pink-400',
    report_dismiss:       'text-gray-400',
    report_warn_user:     'text-yellow-400',
    report_remove_content:'text-red-400',
    report_escalate:      'text-orange-400',
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-2">
              <ScrollText size={19} className="text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Full record of all admin actions - immutable.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setRetry(value => value + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          {lastLoadedAt && !loading && (
            <span className="text-[11px] text-gray-600">
              Updated {lastLoadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <input
          type="text"
          placeholder="Filter by action..."
          value={filters.action}
          onChange={e => { setPage(1); setFilters(f => ({ ...f, action: e.target.value })); }}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                     text-sm text-white placeholder-gray-500
                     focus:outline-none focus:border-orange-500 w-52"
        />
        <select
          value={filters.target_type}
          onChange={e => { setPage(1); setFilters(f => ({ ...f, target_type: e.target.value })); }}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                     text-sm text-gray-300 focus:outline-none
                     focus:border-orange-500"
        >
          <option value="">All Types</option>
          {['user','job','payout','setting','dispute'].map(t => (
            <option key={t} value={t} className="capitalize">{t}</option>
          ))}
        </select>
        {(filters.action || filters.target_type) && (
          <button
            type="button"
            onClick={() => { setPage(1); setFilters({ action: '', target_type: '' }); }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-sm text-gray-400 hover:text-white hover:border-gray-500 transition"
          >
            <RotateCcw size={14} />
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 mb-6 px-4 py-3 bg-red-900/30 border border-red-700/60 rounded-xl text-red-300 text-sm">
          <span>{error}</span>
          <button onClick={() => setRetry(value => value + 1)} className="px-3 py-1.5 rounded-lg bg-red-700/60 hover:bg-red-700 text-white text-xs font-semibold">
            Retry
          </button>
        </div>
      )}

      {/* Log table */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400
                             text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Timestamp</th>
                <th className="px-4 py-3 text-left">Admin</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Target</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center
                                             text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : log.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center
                                             text-gray-500">
                    No audit entries found.
                  </td>
                </tr>
              ) : log.map(entry => (
                <tr key={entry.id}
                    className="hover:bg-gray-750 transition-colors group">
                  <td className="px-4 py-3 text-gray-400 text-xs
                                 whitespace-nowrap font-mono">
                    {new Date(entry.created_at).toLocaleString('en-US', {
                      month:  'short', day:    'numeric',
                      hour:   '2-digit', minute: '2-digit',
                      second: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-white text-xs font-medium">
                        {entry.admin_name || 'System'}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {entry.admin_email || '-'}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono font-semibold ${
                      ACTION_COLORS[entry.action] || 'text-gray-300'
                    }`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {entry.target_type && (
                      <span className="capitalize">{entry.target_type}</span>
                    )}
                    {entry.target_id && (
                      <p className="font-mono text-gray-600 text-xs
                                    truncate max-w-24">
                        {entry.target_id.split('-')[0]}...
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs
                                 max-w-xs truncate">
                    {entry.description || '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                    {entry.ip_address || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3
                        border-t border-gray-700">
          <p className="text-xs text-gray-500">Page {page}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                         rounded-lg disabled:opacity-40 hover:bg-gray-600
                         transition"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={log.length < 50}
              className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                         rounded-lg disabled:opacity-40 hover:bg-gray-600
                         transition"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
