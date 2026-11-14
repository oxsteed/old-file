import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';

const NS = 'adminFranchiseRoyaltyFailures';

const STATUS_OPTIONS = [
  { value: 'open', labelKey: 'statusOpen' },
  { value: 'parked', labelKey: 'statusParked' },
  { value: 'resolved', labelKey: 'statusResolved' },
  { value: 'all', labelKey: 'statusAll' },
];

// Domain 8 #13: admin list for the franchise royalty failure outbox.
// Failed accruals used to be visible only by querying the table
// directly; parked rows (10 failed attempts) surface here so an
// operator can review them instead of the re-drive retrying forever.
export default function FranchiseRoyaltyFailuresPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/super/franchise-royalty-failures', {
      params: { status, limit, offset: (page - 1) * limit },
      signal,
    });
    return {
      failures: res.data.failures || [],
      totalCount: res.data.total || 0,
    };
  }, [status, page, limit]);

  const failures = data?.failures ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pages = Math.max(1, Math.ceil(totalCount / limit));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-gray-900 dark:text-white font-bold text-3xl mb-2">{t(`${NS}.title`)}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">{t(`${NS}.subtitle`)}</p>
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

      <div className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl p-4">
        <label className="block text-gray-600 dark:text-gray-400 text-sm mb-2">{t(`${NS}.statusFilterLabel`)}</label>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-full md:w-64 px-3 py-2 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(`${NS}.${opt.labelKey}`)}</option>
          ))}
        </select>
      </div>

      <div className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white dark:bg-gray-900 border-b border-gray-300 dark:border-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thSource`)}</th>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thAmount`)}</th>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thAttempts`)}</th>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thError`)}</th>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thNextRetry`)}</th>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thParkedAt`)}</th>
                <th className="px-6 py-4 text-left text-gray-600 dark:text-gray-400 font-semibold">{t(`${NS}.thCreatedAt`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && failures.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full" />
                    </div>
                  </td>
                </tr>
              ) : error ? null : failures.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-600 dark:text-gray-400">
                    {t(`${NS}.noEntries`)}
                  </td>
                </tr>
              ) : (
                failures.map((failure) => (
                  <tr key={failure.id} className="hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition">
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                      <p className="font-mono text-xs">{failure.source_type}:{failure.source_id}</p>
                      {(failure.city || failure.region) && (
                        <p className="text-gray-500 text-xs">{[failure.city, failure.region].filter(Boolean).join(', ')}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {(Number(failure.amount_cents) / 100).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{failure.attempts}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-xs max-w-xs truncate" title={failure.error || ''}>
                      {failure.error || '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                      {failure.next_retry_at ? new Date(failure.next_retry_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                      {failure.parked_at ? new Date(failure.parked_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                      {failure.created_at ? new Date(failure.created_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white dark:bg-gray-900 border-t border-gray-300 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t(`${NS}.pagination`, { from: totalCount === 0 ? 0 : (page - 1) * limit + 1, to: Math.min(page * limit, totalCount), total: totalCount })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(`${NS}.previous`)}
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(`${NS}.next`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
