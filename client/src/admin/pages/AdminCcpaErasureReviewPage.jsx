import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import LegalSubNav from '../components/LegalSubNav';

// Erasure review queue: privacy erasure jobs that could not complete
// (financial blocker, restricted money-audit reference, or an exhausted
// job) and now sit in needs_review. Requeueing re-runs completion for
// the parent request, which re-pends the job for another erasure attempt.
export default function AdminCcpaErasureReviewPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [requeuing, setRequeuing] = useState(null);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/legal/ccpa-erasure-review', {
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

  const handleRequeue = async (requestId) => {
    if (requeuing) return;
    setRequeuing(requestId);
    try {
      await adminApi.put(`/admin/legal/ccpa-requests/${requestId}`, { status: 'completed' });
      toast.success(t('adminCcpaErasureReview.requeueDone'));
      reload();
    } catch {
      toast.error(t('adminCcpaErasureReview.requeueFailed'));
    } finally {
      setRequeuing(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <LegalSubNav />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-gray-900 dark:text-white font-bold text-3xl mb-2">{t('adminCcpaErasureReview.title')}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">{t('adminCcpaErasureReview.subtitle')}</p>
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
                <th className="px-4 py-3">{t('adminCcpaErasureReview.table.requestId')}</th>
                <th className="px-4 py-3">{t('adminCcpaErasureReview.table.attempts')}</th>
                <th className="px-4 py-3">{t('adminCcpaErasureReview.table.lastError')}</th>
                <th className="px-4 py-3">{t('adminCcpaErasureReview.table.queuedAt')}</th>
                <th className="px-4 py-3">{t('adminCcpaErasureReview.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">{t('adminCcpaErasureReview.loading')}</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">{t('adminCcpaErasureReview.table.empty')}</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.request_id} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="px-4 py-3 font-mono text-sm">{row.request_id}</td>
                  <td className="px-4 py-3">{row.attempts}</td>
                  <td className="px-4 py-3 text-sm break-words max-w-md">{row.last_error || '-'}</td>
                  <td className="px-4 py-3 text-sm">{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRequeue(row.request_id)}
                      disabled={requeuing === row.request_id}
                      className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-semibold disabled:opacity-50"
                    >
                      {requeuing === row.request_id ? t('adminCcpaErasureReview.requeuing') : t('adminCcpaErasureReview.requeue')}
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
          <span>{t('adminCcpaErasureReview.pagination', { from: pagination.offset + 1, to: pagination.offset + rows.length, total: pagination.total })}</span>
          <span className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              {t('adminCcpaErasureReview.pagination.previous')}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasMore}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              {t('adminCcpaErasureReview.pagination.next')}
            </button>
          </span>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('adminCcpaErasureReview.note')}</p>
    </div>
  );
}
