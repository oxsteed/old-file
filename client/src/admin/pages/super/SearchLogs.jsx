import { useEffect, useState } from 'react';
import { Search, BarChart2, Loader2 } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

function ts(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function StatsBar({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Total Searches',   value: stats.total_searches   },
    { label: 'Unique Admins',    value: stats.unique_admins    },
    { label: 'Avg Results',      value: stats.avg_results      },
    { label: 'Last 24h',         value: stats.searches_24h     },
    { label: 'Last 7d',          value: stats.searches_7d      },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
      {items.map(({ label, value }) => (
        <div key={label}
          className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-white">{value ?? '—'}</p>
          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

export default function SearchLogs() {
  const [logs,    setLogs]    = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [total,   setTotal]   = useState(0);
  const [offset,  setOffset]  = useState(0);
  const [filters, setFilters] = useState({ q: '', admin_id: '' });
  const [topTab,  setTopTab]  = useState('queries'); // 'queries' | 'admins'

  const LIMIT = 50;

  const fetchLogs = async (params = {}) => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/super/search-logs', {
        params: { limit: LIMIT, offset, ...filters, ...params },
      });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { data } = await adminApi.get('/admin/super/search-stats');
      setStats(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, filters]);

  const handleFilterChange = (key, val) => {
    setOffset(0);
    setFilters(f => ({ ...f, [key]: val }));
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Search size={20} className="text-orange-400" />
            Search Audit Log
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Every admin search is recorded here — who searched, what, and when.
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800
                     hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition"
        >
          <BarChart2 size={12} />
          Refresh Stats
        </button>
      </div>

      {/* Stats bar */}
      {stats && <StatsBar stats={stats.summary} />}

      {/* Top lists */}
      {stats && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl mb-6 overflow-hidden">
          <div className="flex border-b border-gray-800">
            {['queries', 'admins'].map(tab => (
              <button
                key={tab}
                onClick={() => setTopTab(tab)}
                className={`px-4 py-2.5 text-xs font-semibold capitalize transition ${
                  topTab === tab
                    ? 'text-orange-400 border-b-2 border-orange-400'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Top {tab === 'queries' ? 'Queries' : 'Searchers'} (30d)
              </button>
            ))}
          </div>
          {topTab === 'queries' && (
            <div className="divide-y divide-gray-800">
              {(stats.top_queries || []).map((q, i) => (
                <div key={i}
                  className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-gray-600 w-5 text-right shrink-0">
                      {i + 1}
                    </span>
                    <p className="text-sm text-white font-mono truncate">{q.query}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-orange-400 font-semibold">
                      ×{q.search_count}
                    </span>
                    <span className="text-xs text-gray-500 hidden sm:block">
                      {ts(q.last_searched_at)}
                    </span>
                  </div>
                </div>
              ))}
              {!stats.top_queries?.length && (
                <p className="text-gray-500 text-sm text-center py-4">No data yet.</p>
              )}
            </div>
          )}
          {topTab === 'admins' && (
            <div className="divide-y divide-gray-800">
              {(stats.top_admins || []).map((a, i) => (
                <div key={i}
                  className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-gray-600 w-5 text-right shrink-0">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{a.admin_name}</p>
                      <p className="text-xs text-gray-500 truncate">{a.admin_email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-orange-400 font-semibold">
                      {a.search_count} searches
                    </span>
                    <span className="text-xs text-gray-500 hidden sm:block">
                      {ts(a.last_search_at)}
                    </span>
                  </div>
                </div>
              ))}
              {!stats.top_admins?.length && (
                <p className="text-gray-500 text-sm text-center py-4">No data yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Filter by query text…"
          value={filters.q}
          onChange={e => handleFilterChange('q', e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                     text-sm text-white placeholder-gray-500
                     focus:outline-none focus:border-orange-500 w-52"
        />
        <input
          type="text"
          placeholder="Filter by admin ID…"
          value={filters.admin_id}
          onChange={e => handleFilterChange('admin_id', e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                     text-sm text-white placeholder-gray-500
                     focus:outline-none focus:border-orange-500 w-64"
        />
      </div>

      {/* Log table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400">Admin</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400">Query</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400">Types</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 text-right">Results</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center">
                    <Loader2 size={20} className="animate-spin text-orange-400 mx-auto" />
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500 text-sm">
                    No search logs found.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-800/40 transition">
                    <td className="px-4 py-3">
                      <p className="text-white text-xs font-medium">{log.admin_name}</p>
                      <p className="text-gray-500 text-xs">{log.admin_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-orange-300 text-xs">{log.query}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(log.entity_types || []).map(t => (
                          <span key={t}
                            className="px-1.5 py-0.5 bg-gray-700 text-gray-300
                                       text-xs rounded capitalize">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-white text-xs">
                      {log.result_count}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs whitespace-nowrap">
                      {ts(log.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-800 flex items-center
                          justify-between">
            <p className="text-xs text-gray-500">
              Page {currentPage} of {totalPages} · {total} entries
            </p>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs
                           text-gray-300 rounded-lg transition disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset(o => o + LIMIT)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs
                           text-gray-300 rounded-lg transition disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
