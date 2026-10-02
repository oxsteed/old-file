import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Search, Download, Trash2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import { useHasGrant } from '../lib/GrantGuard';
import { adminDate } from '../lib/formatters';

const STATUSES = ['', 'published', 'accepted', 'in_progress', 'completed', 'cancelled', 'disputed'];

function statusLabel(status, t) {
  return t(`adminJobs.status.${status}`, { defaultValue: status.replace(/_/g, ' ') });
}

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
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const { allowed: canExport } = useHasGrant('export_data');
  const { allowed: canDelete } = useHasGrant('delete_jobs');

  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filters, setFilters] = useState({ search: '', status: '', page: 1 });
  const [exportError, setExportError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Abortable jobs load. A failed refetch keeps the previous list on screen and
  // surfaces a retryable error instead of clearing the table.
  const { data: jobsData, error, loading, reload } = useAbortableFetch(async (signal) => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
    const { data } = await adminApi.get('/admin/jobs', { params, signal });
    return { jobs: data.jobs || [], total: data.total || 0 };
  }, [filters]);

  useEffect(() => {
    if (jobsData) {
      setJobs(jobsData.jobs);
      setTotal(jobsData.total);
      setLastUpdated(new Date());
    }
  }, [jobsData]);

  const fetchJobs = reload;

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const exportCSV = async () => {
    setExportError('');
    try {
      const { data } = await adminApi.get('/admin/export/jobs', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = `jobs_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.response?.data?.error || t('adminJobs.exportFailed'));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteReason.trim()) { setDeleteError(t('adminJobs.reasonRequired')); return; }
    setDeleteLoading(true); setDeleteError('');
    try {
      await adminApi.delete(`/admin/jobs/${deleting.id}`, { data: { reason: deleteReason } });
      setJobs(prev => prev.filter(j => j.id !== deleting.id));
      setTotal(prev => prev - 1);
      setDeleting(null); setDeleteReason('');
    } catch (err) {
      setDeleteError(err.response?.data?.error || t('adminJobs.deleteFailed'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const col = 'px-4 py-3 text-sm';

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('adminJobs.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminJobs.total', { count: total })}</p>
          {lastUpdated && <p className="mt-1 text-xs text-gray-600">{t('adminJobs.updated', { time: adminDate(lastUpdated, { hour: 'numeric', minute: '2-digit' }) })}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={fetchJobs} disabled={loading}
            className="flex items-center gap-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {t('adminJobs.refresh')}
          </button>
          {(isSuper || canExport) && <button type="button" onClick={exportCSV}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">
            <Download size={16} /> {t('adminJobs.exportCsv')}
          </button>}
        </div>
      </div>
      {exportError && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{exportError}</span>
          <button type="button" onClick={exportCSV} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10">{t('adminJobs.tryAgain')}</button>
        </div>
      )}

      {error && (
        <div className="mb-6"><AdminErrorState onRetry={fetchJobs} /></div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="text" placeholder={t('adminJobs.searchPlaceholder')} aria-label={t('adminJobs.searchAria')}
            value={filters.search} onChange={e => updateFilter('search', e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none" />
        </div>
          <select value={filters.status} onChange={e => updateFilter('status', e.target.value)} aria-label={t('adminJobs.statusFilterAria')}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none">
          <option value="">{t('adminJobs.allStatuses')}</option>
          {STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>{statusLabel(s, t)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.title')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.client')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.helper')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.budget')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.status')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.created')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminJobs.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && jobs.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-12">{t('adminJobs.loading')}</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-12">{t('adminJobs.empty')}</td></tr>
            ) : jobs.map(job => (
              <tr key={job.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                <td className={`${col} text-white font-medium max-w-[200px]`}>
                  <Link to={`/admin/jobs/${job.id}`}
                    className="block truncate hover:text-orange-300 transition-colors">
                    {job.title}
                  </Link>
                  <span className="text-gray-500 text-xs">{job.location_city}{job.location_state ? `, ${job.location_state}` : ''}</span>
                </td>
                <td className={`${col} text-gray-300`}>{job.client_name || t('common.notAvailable', { defaultValue: 'N/A' })}</td>
                <td className={`${col} text-gray-300`}>{job.helper_name || <span className="text-gray-500 italic">{t('adminJobs.unassigned')}</span>}</td>
                <td className={`${col} text-white`}>
                  {job.budget_type === 'open' ? <span className="text-gray-400 italic">{t('adminJobs.open')}</span>
                    : job.budget_min ? `$${Number(job.budget_min).toLocaleString()}`
                    : '-'}
                </td>
                <td className={col}>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(job.status)}`}>
                    {statusLabel(job.status || 'unknown', t)}
                  </span>
                </td>
                <td className={`${col} text-gray-400`}>
                  {job.created_at ? adminDate(job.created_at) : t('common.notAvailable', { defaultValue: 'N/A' })}
                </td>
                {(isSuper || canDelete) ? (
                  <td className={col}>
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/jobs/${job.id}`}
                        className="text-xs text-orange-400 hover:text-orange-300 font-medium transition">
                        {t('common.view')} →
                      </Link>
                      <button
                        onClick={() => { setDeleting(job); setDeleteReason(''); setDeleteError(''); }}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                        title={t('adminJobs.deleteTitle')}
                      >
                        <Trash2 size={13} /> {t('common.delete')}
                      </button>
                    </div>
                  </td>
                ) : (
                  <td className={col}>
                    <Link to={`/admin/jobs/${job.id}`}
                      className="text-xs text-orange-400 hover:text-orange-300 font-medium transition">
                      {t('common.view')} →
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
          <span>{t('adminJobs.pageTotal', { page: filters.page, total })}</span>
          <div className="flex gap-2">
            <button onClick={() => setFilters(p => ({ ...p, page: Math.max(1, p.page - 1) }))}
              disabled={filters.page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors">
              ← {t('common.previous')}
            </button>
            <button onClick={() => setFilters(p => ({ ...p, page: p.page + 1 }))}
              disabled={jobs.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors">
              {t('common.next')} →
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
                <h3 className="font-bold text-white text-base">{t('adminJobs.deleteTitle')}</h3>
                <p className="text-gray-400 text-sm">{t('adminJobs.deleteIrreversible')}</p>
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
                {t('adminJobs.deleteReason')} <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={3}
                value={deleteReason}
                onChange={e => { setDeleteReason(e.target.value); setDeleteError(''); }}
                placeholder={t('adminJobs.deleteReasonPlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm p-2.5 placeholder-gray-500 focus:border-red-500 focus:outline-none resize-none"
              />
              {deleteError && <p className="text-red-400 text-xs mt-1">{deleteError}</p>}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setDeleting(null)} disabled={deleteLoading}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">
                {t('common.cancel')}
              </button>
              <button onClick={handleDeleteConfirm} disabled={deleteLoading || !deleteReason.trim()}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {deleteLoading ? t('adminJobs.deleting') : <><Trash2 size={14} /> {t('adminJobs.deleteJob')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
