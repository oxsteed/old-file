import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import LegalSubNav from '../components/LegalSubNav';

// Parked growth-erasure queue (Domain 8 #17): erasure rows the worker
// parked after repeated verification failures. They leave the worker's
// selection until an operator resets them to pending, which re-queues
// them for another erasure attempt. Same review pattern as the CCPA
// erasure-review page.
export default function AdminGrowthErasureParkedPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [resetting, setResetting] = useState(null);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/legal/growth-erasure-parked', {
      params: { limit, offset: (page - 1) * limit },
      signal,
    });
    return {
      rows: res.data.rows || [],
      pagination: res.data.pagination || { limit, offset: 0, total: 0, hasMore: false },
    };
  }, [page, limit]);

  const rows = data?.rows ?? [];
  const pagination = data?.pagination ?? { limit, offset: 0, total: 0, hasMore: false };

  const handleReset = async (rowId) => {
    if (resetting) return;
    setResetting(rowId);
    try {
      await adminApi.post(`/admin/legal/growth-erasure-parked/${rowId}/reset`);
      toast.success(t('adminGrowthErasureParked.resetDone'));
      reload();
    } catch {
      toast.error(t('adminGrowthErasureParked.resetFailed'));
    } finally {
      setResetting(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <LegalSubNav />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-gray-900 dark:text-white font-bold text-3xl mb-2">{t('adminGrowthErasureParked.title')}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">{t('adminGrowthErasureParked.subtitle')}</p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          aria-label={t('common.refresh')}
          className="p-2.5 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg hover:text-gray-900 dark:hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <AdminErrorState onRetry={reload} />}

      {!error && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">{t('adminGrowthErasureParked.table.id')}</th>
                <th className="px-4 py-3">{t('adminGrowthErasureParked.table.subjectKey')}</th>
                <th className="px-4 py-3">{t('adminGrowthErasureParked.table.reason')}</th>
                <th className="px-4 py-3">{t('adminGrowthErasureParked.table.attempts')}</th>
                <th className="px-4 py-3">{t('adminGrowthErasureParked.table.queuedAt')}</th>
                <th className="px-4 py-3">{t('adminGrowthErasureParked.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">{t('adminGrowthErasureParked.loading')}</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">{t('adminGrowthErasureParked.table.empty')}</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="px-4 py-3 font-mono text-sm">{row.id}</td>
                  <td className="px-4 py-3 font-mono text-sm break-all max-w-xs">{row.subject_key}</td>
                  <td className="px-4 py-3 text-sm">{row.reason || '-'}</td>
                  <td className="px-4 py-3">{row.verification_attempts}</td>
                  <td className="px-4 py-3 text-sm">{row.requested_at ? new Date(row.requested_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleReset(row.id)}
                      disabled={resetting === row.id}
                      className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50"
                    >
                      {resetting === row.id ? t('adminGrowthErasureParked.resetting') : t('adminGrowthErasureParked.reset')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && pagination.total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>{t('adminGrowthErasureParked.pagination', { from: pagination.offset + 1, to: pagination.offset + rows.length, total: pagination.total })}</span>
          <span className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              {t('adminGrowthErasureParked.pagination.previous')}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              {t('adminGrowthErasureParked.pagination.next')}
            </button>
          </span>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('adminGrowthErasureParked.note')}</p>
    </div>
  );
}
