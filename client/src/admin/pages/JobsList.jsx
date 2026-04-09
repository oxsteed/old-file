import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import adminApi from '../../lib/adminApi';

const STATUSES = ['', 'published', 'accepted', 'in_progress', 'completed', 'cancelled', 'disputed'];

function statusStyle(status) {
  switch (status) {
    case 'completed':   return 'bg-green-500/20 text-green-600 dark:text-green-400';
    case 'published':   return 'bg-blue-500/20 text-blue-700 dark:text-blue-400';
    case 'in_progress': return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
    case 'cancelled':   return 'bg-red-500/20 text-red-700 dark:text-red-400';
    case 'disputed':    return 'bg-purple-500/20 text-purple-700 dark:text-purple-400';
    case 'accepted':    return 'bg-orange-500/20 text-orange-700 dark:text-orange-400';
    default:            return 'bg-gray-500/20 text-gray-600 dark:text-gray-400';
  }
}

export default function JobsList() {
  const { user: me } = useAuth();
  const isSuper = me?.role === 'super_admin';

  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', page: 1 });

  // Delete modal state
  const [deleting, setDeleting] = useState(null); // job object
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
      const { data } = await adminApi.get('/admin/jobs', { params });
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const exportCSV = async () => {
    try {
      const { data } = await adminApi.get('/admin/jobs/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = `jobs_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch (err) { console.error('Export failed:', err); }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteReason.trim()) { setDeleteError('A reason is required.'); return; }
    setDeleteLoading(true); setDeleteError('');
    try {
      await adminApi.delete(`/admin/jobs/${deleting.id}`, { data: { reason: deleteReason } });
      setJobs(prev => prev.filter(j => j.id !== deleting.id));
      setTotal(prev => prev - 1);
      setDeleting(null); setDeleteReason('');
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete job.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const col = 'px-4 py-3 text-sm';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-gray-400 text-sm">{total} total jobs</p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="text" placeholder="Search jobs by title or ID..."
            value={filters.search} onChange={e => updateFilter('search', e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none" />
        </div>
        <select value={filters.status} onChange={e => updateFilter('status', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none">
          <option value="">All Statuses</option>
          {STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">TITLE</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">CLIENT</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">HELPER</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">BUDGET</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">STATUS</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">CREATED</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-12">Loading…</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-12">No jobs found.</td></tr>
            ) : jobs.map(job => (
              <tr key={job.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                <td className={`${col} text-white font-medium max-w-[200px]`}>
                  <Link to={`/admin/jobs/${job.id}`}
                    className="block truncate hover:text-orange-300 transition-colors">
                    {job.title}
                  </Link>
                  <span className="text-gray-500 text-xs">{job.location_city}{job.location_state ? `, ${job.location_state}` : ''}</span>
                </td>
                <td className={`${col} text-gray-300`}>{job.client_name || 'N/A'}</td>
                <td className={`${col} text-gray-300`}>{job.helper_name || <span className="text-gray-500 italic">Unassigned</span>}</td>
                <td className={`${col} text-white`}>
                  {job.budget_type === 'open' ? <span className="text-gray-400 italic">Open</span>
                    : job.budget_min ? `$${Number(job.budget_min).toLocaleString()}`
                    : '—'}
                </td>
                <td className={col}>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(job.status)}`}>
                    {(job.status || 'unknown').replace(/_/g,' ')}
                  </span>
                </td>
                <td className={`${col} text-gray-400`}>
                  {job.created_at ? new Date(job.created_at).toLocaleDateString() : 'N/A'}
                </td>
                {isSuper ? (
                  <td className={col}>
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/jobs/${job.id}`}
                        className="text-xs text-orange-400 hover:text-orange-300 font-medium transition">
                        View →
                      </Link>
                      <button
                        onClick={() => { setDeleting(job); setDeleteReason(''); setDeleteError(''); }}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                        title="Permanently delete this job"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </td>
                ) : (
                  <td className={col}>
                    <Link to={`/admin/jobs/${job.id}`}
                      className="text-xs text-orange-400 hover:text-orange-300 font-medium transition">
                      View →
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Page {filters.page} · {total} total</span>
          <div className="flex gap-2">
            <button onClick={() => setFilters(p => ({ ...p, page: Math.max(1, p.page - 1) }))}
              disabled={filters.page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors">
              ← Prev
            </button>
            <button onClick={() => setFilters(p => ({ ...p, page: p.page + 1 }))}
              disabled={jobs.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !deleteLoading && setDeleting(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Permanently Delete Job</h3>
                <p className="text-gray-400 text-sm">This action cannot be undone.</p>
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-4">
              <p className="text-white text-sm font-medium truncate">{deleting.title}</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {deleting.client_name} · {(deleting.status || '').replace(/_/g,' ')}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Reason for deletion <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={3}
                value={deleteReason}
                onChange={e => { setDeleteReason(e.target.value); setDeleteError(''); }}
                placeholder="Explain why this job is being permanently removed…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm p-2.5 placeholder-gray-500 focus:border-red-500 focus:outline-none resize-none"
              />
              {deleteError && <p className="text-red-400 text-xs mt-1">{deleteError}</p>}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setDeleting(null)} disabled={deleteLoading}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} disabled={deleteLoading || !deleteReason.trim()}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {deleteLoading ? 'Deleting…' : <><Trash2 size={14} /> Delete Job</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
