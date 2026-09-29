import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';

const PAYMENT_STATUSES = [
  '', 'pending', 'authorized', 'captured', 'released', 'refunded', 'failed', 'disputed',
];

function statusBadge(status) {
  switch (status) {
    case 'captured':
    case 'released':   return 'bg-green-500/20 text-green-400';
    case 'authorized': return 'bg-blue-500/20 text-blue-400';
    case 'pending':    return 'bg-yellow-500/20 text-yellow-300';
    case 'refunded':   return 'bg-purple-500/20 text-purple-400';
    case 'failed':     return 'bg-red-500/20 text-red-400';
    case 'disputed':   return 'bg-orange-500/20 text-orange-400';
    default:           return 'bg-gray-500/20 text-gray-400';
  }
}

function fmt(dollars) {
  if (dollars == null) return '-';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(dollars));
  } catch {
    return `$${Number(dollars).toFixed(2)}`;
  }
}

export default function PaymentsList() {
  const { t } = useTranslation();
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filters,    setFilters]    = useState({
    status: '', date_from: '', date_to: '', page: 1,
  });

  // Sequence-guarded + abortable: rapid filter changes can no longer resolve
  // out of order and clobber the table with stale results. A 403 still lands
  // on the dedicated permission panel; other failures surface an error banner.
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== '' && v !== 0)
    );
    try {
      const { data: res } = await adminApi.get('/admin/payments', { params, signal });
      return { payments: res.payments || [], total: res.total || 0 };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') throw err;
      if (err?.response?.status === 403) {
        return { payments: [], total: 0, forbidden: true };
      }
      const wrapped = new Error(err?.response?.data?.error || t('common.failedToLoad'));
      wrapped.cause = err;
      throw wrapped;
    }
  }, [filters, t]);
  const payments = data?.payments || [];
  const total = data?.total || 0;
  const forbidden = !!data?.forbidden;
  const errorMessage = error?.message || '';

  useEffect(() => {
    if (data && !data.forbidden) setLastUpdated(new Date());
  }, [data]);

  const fetchPayments = () => reload();

  const updateFilter = (key, value) =>
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const col = 'px-4 py-3 text-sm';

  if (forbidden) {
    return (
      <div className="p-6 lg:p-8">
        <div className="flex items-center gap-3 mb-6">
          <CreditCard size={22} className="text-orange-400" />
          <h1 className="text-2xl font-bold text-white">{t('adminPaymentsList.title')}</h1>
        </div>
        <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-xl p-6 text-center">
          <p className="text-yellow-300 text-sm">
            {t('adminPaymentsList.permissionRequired')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <CreditCard size={22} className="text-orange-400" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{t('adminPaymentsList.title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{t('adminPaymentsList.count', { count: total })}</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && !loading && (
            <span className="hidden sm:inline text-xs text-gray-500">
              {t('common.updated')} {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={fetchPayments}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={fetchPayments} className="font-semibold text-red-100 underline underline-offset-2 hover:text-white">
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filters.status}
          onChange={e => updateFilter('status', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                     focus:border-orange-500 focus:outline-none"
        >
          <option value="">{t('adminPaymentsList.allStatuses')}</option>
          {PAYMENT_STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>
              {t(`adminPaymentsList.status.${s}`, { defaultValue: s.charAt(0).toUpperCase() + s.slice(1) })}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs">{t('adminPaymentsList.from')}</label>
          <input
            type="date"
            value={filters.date_from}
            onChange={e => updateFilter('date_from', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                       focus:border-orange-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs">{t('adminPaymentsList.to')}</label>
          <input
            type="date"
            value={filters.date_to}
            onChange={e => updateFilter('date_to', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                       focus:border-orange-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.payer')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.payee')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.job')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.amount')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.fee')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.payout')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.status')}</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">{t('adminPaymentsList.columns.created')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">{t('adminPaymentsList.loading')}</td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">{t('adminPaymentsList.empty')}</td>
                </tr>
              ) : payments.map(p => (
                <tr key={p.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                  <td className={col}>
                    <p className="text-white text-sm">{p.payer_name || '-'}</p>
                    <p className="text-gray-500 text-xs">{p.payer_email || '-'}</p>
                  </td>
                  <td className={col}>
                    <p className="text-white text-sm">{p.payee_name || '-'}</p>
                    <p className="text-gray-500 text-xs">{p.payee_email || '-'}</p>
                  </td>
                  <td className={`${col} max-w-[160px]`}>
                    {p.job_id ? (
                      <Link
                        to={`/admin/jobs/${p.job_id}`}
                        className="text-orange-400 hover:text-orange-300 text-xs truncate block"
                      >
                        {p.job_title || `Job #${p.job_id}`}
                      </Link>
                    ) : (
                      <span className="text-gray-500 text-xs italic">{t('adminPaymentsList.noJob')}</span>
                    )}
                  </td>
                  <td className={`${col} text-white font-medium`}>{fmt(p.amount)}</td>
                  <td className={`${col} text-gray-400`}>{fmt(p.platform_fee)}</td>
                  <td className={`${col} text-gray-400`}>{fmt(p.helper_payout)}</td>
                  <td className={col}>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(p.status)}`}>
                      {p.status || '-'}
                    </span>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>{t('adminPaymentsList.pageSummary', { page: filters.page, total })}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setFilters(p => ({ ...p, page: Math.max(1, p.page - 1) }))}
              disabled={filters.page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {t('adminPaymentsList.prev')}
            </button>
            <button
              onClick={() => setFilters(p => ({ ...p, page: p.page + 1 }))}
              disabled={payments.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {t('adminPaymentsList.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
