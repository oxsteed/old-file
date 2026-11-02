// Admin pay-run visibility (finding 25): list every restaurant's pay runs
// with status, totals, and linked payout totals, plus a detail view showing
// the actual payout links. A finalized run with no links is visibly
// unpaid; only a paid run (links covering total pay) reads as paid.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import AuditQueuePager from '../../lib/AuditQueuePager';

const PAGE_SIZE = 50;
const STATUSES = ['all', 'draft', 'finalized', 'paid', 'voided'];

function formatMoney(cents, currency) {
  const n = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`;
  }
}

export default function RestaurantPayRuns() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('all');
  const [restaurantId, setRestaurantId] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/restaurant-pay-runs', {
      signal,
      params: {
        ...(status !== 'all' ? { status } : {}),
        ...(restaurantId.trim() ? { restaurant_id: restaurantId.trim() } : {}),
        limit: PAGE_SIZE,
        offset,
      },
    });
    setTotal(Number(body?.total || 0));
    return { payRuns: body?.payRuns || [] };
  }, [status, restaurantId, offset]);

  const payRuns = data?.payRuns || [];

  const loadDetail = useCallback(async (id) => {
    setDetailError('');
    try {
      const { data: body } = await adminApi.get(`/admin/restaurant-pay-runs/${id}`);
      setDetail(body?.payRun || null);
    } catch (err) {
      setDetailError(err?.response?.data?.error || err.message || t('restaurantPayRuns.detailFailed'));
    }
  }, [t]);

  useEffect(() => { setOffset(0); }, [status, restaurantId]);

  return (
    <div className="p-6">
      <h1 className="text-white text-xl font-bold mb-1">{t('restaurantPayRuns.title')}</h1>
      <p className="text-gray-400 text-sm mb-4">{t('restaurantPayRuns.subtitle')}</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUSES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setStatus(key); setDetail(null); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${status === key ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
          >
            {t(`restaurantPayRuns.status.${key}`)}
          </button>
        ))}
        <input
          value={restaurantId}
          onChange={(event) => setRestaurantId(event.target.value)}
          placeholder={t('restaurantPayRuns.restaurantFilter')}
          inputMode="numeric"
          className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm text-white placeholder:text-gray-500"
        />
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={loadError?.message || t('restaurantPayRuns.loadFailed')} onRetry={reload} />
      )}
      {!loading && !loadError && payRuns.length === 0 && (
        <p className="text-gray-500">{t('restaurantPayRuns.empty')}</p>
      )}

      {!loading && !loadError && payRuns.length > 0 && (
        <div className="space-y-3">
          {payRuns.map((run) => {
            const totals = run.totals || {};
            const totalPay = Number(totals.total_pay_cents || 0);
            const linked = Number(run.linked_payout_cents || 0);
            return (
              <div key={run.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-white font-semibold">
                      {run.restaurant_name || t('restaurantPayRuns.unknownRestaurant')} · {t('restaurantPayRuns.run', { id: run.id })}
                      {' · '}{t(`restaurantPayRuns.status.${run.status}`)}
                    </p>
                    <p className="text-gray-400 text-sm mt-1">
                      {t('restaurantPayRuns.period', { from: String(run.period_from || '').slice(0, 10), to: String(run.period_to || '').slice(0, 10) })}
                      {' · '}{t('restaurantPayRuns.totalPay', { amount: formatMoney(totalPay, run.totals?.currency || 'USD') })}
                      {' · '}{t('restaurantPayRuns.linked', { amount: formatMoney(linked, run.totals?.currency || 'USD'), count: run.payout_link_count || 0 })}
                    </p>
                    {run.status === 'finalized' && linked < totalPay && (
                      <p className="text-amber-300 text-sm mt-1">{t('restaurantPayRuns.finalizedUnpaid')}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => (detail?.id === run.id ? setDetail(null) : loadDetail(run.id))}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 shrink-0"
                  >
                    {detail?.id === run.id ? t('restaurantPayRuns.hideDetail') : t('restaurantPayRuns.showDetail')}
                  </button>
                </div>
                {detail?.id === run.id && (
                  <div className="mt-4 border-t border-slate-700 pt-4 space-y-2">
                    {detailError && <p className="text-red-400 text-sm">{detailError}</p>}
                    {(detail.payoutLinks || []).length === 0 && (
                      <p className="text-gray-400 text-sm">{t('restaurantPayRuns.noLinks')}</p>
                    )}
                    {(detail.payoutLinks || []).map((link) => (
                      <p key={link.id} className="text-gray-300 text-sm">
                        {t('restaurantPayRuns.linkLine', {
                          payout: link.restaurant_payout_id,
                          amount: formatMoney(link.amount_cents, link.currency_code),
                          status: link.payout_status || '',
                        })}
                      </p>
                    ))}
                    {(detail.lines || []).length > 0 && (
                      <p className="text-gray-400 text-sm">{t('restaurantPayRuns.employees', { count: detail.lines.length })}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !loadError && total > 0 && (
        <AuditQueuePager offset={offset} limit={PAGE_SIZE} total={total} busy={loading} onChange={setOffset} />
      )}
    </div>
  );
}
