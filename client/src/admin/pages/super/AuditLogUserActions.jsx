import { useEffect, useMemo, useState } from 'react';
import { ScrollText, Download, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';
import AuditLogFilter from '../../../components/AuditLogFilter';

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
  admin_id: '',
  target_user_id: '',
  action_type: '',
  region_id: '',
  from_date: '',
  to_date: '',
};

function ts(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function buildQuery(filters, page) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.append(k, v);
  });
  params.append('limit',  PAGE_SIZE);
  params.append('offset', page * PAGE_SIZE);
  return params.toString();
}

export default function AuditLogUserActions() {
  const [filters,   setFilters]   = useState(EMPTY_FILTERS);
  const [page,      setPage]      = useState(0);
  const [logs,      setLogs]      = useState([]);
  const [total,     setTotal]     = useState(0);
  const [regions,   setRegions]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [exporting, setExporting] = useState(false);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  // Load regions for filter dropdown (super admins only - silently fail otherwise)
  useEffect(() => {
    adminApi.get('/admin/super/regions')
      .then(({ data }) => setRegions(data.regions || []))
      .catch(() => setRegions([]));
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery(filters, page);
      const { data } = await adminApi.get(`/admin/super/audit-log/user-actions?${qs}`);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit log.');
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, [page, filters]);

  const handleFilterChange = (newFilters) => {
    setPage(0);
    setFilters(newFilters);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && params.append(k, v));
      const response = await adminApi.get(
        `/admin/super/audit-log/user-actions/export?${params.toString()}`,
        { responseType: 'blob' }
      );
      const url  = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `user-actions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to export.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-orange-900/40 border border-orange-800">
            <ScrollText size={20} className="text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">User-action audit log</h1>
            <p className="text-sm text-gray-400">
              Per-field changes made to user accounts by administrators.
            </p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || logs.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-100 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export CSV
        </button>
      </div>

      <AuditLogFilter
        value={filters}
        onChange={handleFilterChange}
        regions={regions}
      />

      {error && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-md bg-red-950 border border-red-800 text-red-300 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading…
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed border-gray-800 text-gray-500">
          No audit log entries match your filters.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-xs uppercase text-gray-400">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Admin</th>
                  <th className="text-left px-4 py-3">Target user</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Field</th>
                  <th className="text-left px-4 py-3">Old → New</th>
                  <th className="text-left px-4 py-3">Region</th>
                  <th className="text-left px-4 py-3">Notified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-gray-900/40 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-300">
                      {ts(l.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-100">{l.admin_name || '-'}</div>
                      <div className="text-xs text-gray-500">{l.admin_email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-100">{l.target_name || '-'}</div>
                      <div className="text-xs text-gray-500">{l.target_email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-300 font-mono">
                        {l.action_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                      {l.field_name || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-red-300 line-through max-w-xs truncate">
                        {l.old_value ?? '-'}
                      </div>
                      <div className="text-green-300 max-w-xs truncate">
                        {l.new_value ?? '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {l.region_name || (l.region_id ? `#${l.region_id}` : '-')}
                    </td>
                    <td className="px-4 py-3">
                      {l.user_notified ? (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-green-900 text-green-300">
                          yes
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 text-xs text-gray-400">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                Page {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
