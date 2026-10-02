import { useState } from 'react';
import { Download }            from 'lucide-react';
import adminApi                from '../../../lib/adminApi';
import { useTranslation }     from 'react-i18next';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';

const TYPE_TABS = [
  { key: '',             labelKey: 'superFinancials.tabAll'           },
  { key: 'job_fee',      labelKey: 'superFinancials.tabJobFees'      },
  { key: 'subscription', labelKey: 'superFinancials.tabSubscriptions' },
  { key: 'refund',       labelKey: 'superFinancials.tabRefunds'       },
];

export default function Financials() {
  const { t } = useTranslation();
  const [type,    setType]    = useState('');
  const [page,    setPage]    = useState(1);
  const [exportError, setExportError] = useState('');

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/admin/financials', {
      signal,
      params: { type, page, limit: 30 },
    });
    return { ledger: data.ledger || [], totals: data.totals || null };
  }, [type, page]);
  const ledger = data?.ledger || [];
  const totals = data?.totals || null;

  const handleExport = async () => {
    try {
      const res = await adminApi.get('/admin/export/revenue', {
        responseType: 'blob'
      });
      const url  = URL.createObjectURL(res.data);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `oxsteed_revenue_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setExportError(err.response?.data?.error || t('superFinancials.errorExport'));
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('superFinancials.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {t('superFinancials.subtitle')}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700
                     text-gray-200 text-sm font-medium rounded-lg
                     hover:bg-gray-600 transition"
        >
          <Download size={15} />
          {t('superFinancials.exportCsv')}
        </button>
      </div>

      {exportError && (
        <div className="mb-6 px-4 py-3 bg-red-900/30 border border-red-700/60 rounded-xl text-red-300 text-sm">
          <span>{exportError}</span>
        </div>
      )}

      {!loading && error && (
        <div className="mb-6"><AdminErrorState onRetry={reload} /></div>
      )}

      {/* Revenue summary */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            {
              key: 'gross', labelKey: 'superFinancials.grossRevenue',
              value: `$${((totals.gross_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-green-400'
            },
            {
              key: 'fees', labelKey: 'superFinancials.jobFees',
              value: `$${((totals.job_fee_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-orange-400'
            },
            {
              key: 'subs', labelKey: 'superFinancials.subscriptions',
              value: `$${((totals.subscription_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-purple-400'
            },
            {
              key: 'refunds', labelKey: 'superFinancials.totalRefunds',
              value: `-$${((totals.total_refunds_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-red-400'
            },
          ].map(({ key, labelKey, value, color }) => (
            <div key={key}
                 className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">
                {t(labelKey)}
              </p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Type filter tabs */}
      <div className="flex gap-2 mb-6">
        {TYPE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setType(tab.key); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold
                        transition ${
              type === tab.key
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Ledger table */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl
                      overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400
                             text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">{t('superFinancials.colDate')}</th>
                <th className="px-4 py-3 text-left">{t('superFinancials.colType')}</th>
                <th className="px-4 py-3 text-left">{t('superFinancials.colUser')}</th>
                <th className="px-4 py-3 text-left">{t('superFinancials.colJob')}</th>
                <th className="px-4 py-3 text-right">{t('superFinancials.colAmount')}</th>
                <th className="px-4 py-3 text-left">{t('superFinancials.colDescription')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center
                                             text-gray-500">
                    {t('superFinancials.loading')}
                  </td>
                </tr>
              ) : !error && ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center
                                             text-gray-500">
                    {t('superFinancials.empty')}
                  </td>
                </tr>
              ) : ledger.map(entry => (
                <tr key={entry.id}
                    className="hover:bg-gray-750 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs
                                 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs
                                      font-medium ${
                      entry.source_type === 'subscription'
                        ? 'bg-purple-900 text-purple-300' :
                      entry.source_type === 'job_fee'
                        ? 'bg-orange-900 text-orange-300' :
                      entry.source_type === 'refund'
                        ? 'bg-red-900 text-red-300'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {t(`superFinancials.type.${entry.source_type}`, { defaultValue: String(entry.source_type).replace(/_/g, ' ') })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white text-xs font-medium">
                      {entry.user_name || '-'}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {entry.user_email || ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs
                                 max-w-32 truncate">
                    {entry.job_title || '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold font-mono text-sm ${
                      entry.amount_cents < 0
                        ? 'text-red-400'
                        : 'text-green-400'
                    }`}>
                      {entry.amount_cents < 0 ? '-' : '+'}
                      ${(Math.abs(entry.amount_cents) / 100)
                        .toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs
                                 max-w-xs truncate">
                    {entry.description || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3
                        border-t border-gray-700">
          <p className="text-xs text-gray-500">{t('superFinancials.page', { page })}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                         rounded-lg disabled:opacity-40 hover:bg-gray-600
                         transition"
            >
              {t('superFinancials.prev')}
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={ledger.length < 30}
              className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                         rounded-lg disabled:opacity-40 hover:bg-gray-600
                         transition"
            >
              {t('superFinancials.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
