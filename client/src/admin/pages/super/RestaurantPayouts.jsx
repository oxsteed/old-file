import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

const TABS = ['requested', 'approved', 'completed', 'failed', 'rejected'];

function formatMoney(cents, currency) {
  const n = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`;
  }
}

export default function RestaurantPayouts() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('requested');
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const abortableFetch = useAbortableFetch();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await abortableFetch(adminApi.get('/admin/restaurant-payouts', { params: { status: tab } }));
      setPayouts(data?.payouts || []);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err?.message || 'Failed to load payouts.');
    } finally {
      setLoading(false);
    }
  }, [tab, abortableFetch]);

  useEffect(() => { load(); }, [load]);

  const act = async (payout, action) => {
    setBusyId(payout.id);
    try {
      await adminApi.post(`/admin/restaurant-payouts/${payout.id}/${action}`, {});
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-white text-xl font-bold mb-1">
        {t('restaurantPayouts.title', 'Restaurant wallet payouts')}
      </h1>
      <p className="text-gray-400 text-sm mb-4">
        {t('restaurantPayouts.subtitle', 'Approve wallet-earnings payouts to restaurants. Approval executes a Stripe Transfer to the restaurant\u2019s Connect account immediately.')}
      </p>

      <div className="flex gap-2 mb-4">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === key ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
          >
            {t(`restaurantPayouts.tab.${key}`, key)}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400">{t('common.loading', 'Loading…')}</p>}
      {error && <AdminErrorState message={error} onRetry={load} />}
      {!loading && !error && payouts.length === 0 && (
        <p className="text-gray-500">{t('restaurantPayouts.empty', 'No payouts in this state.')}</p>
      )}

      {!loading && !error && payouts.length > 0 && (
        <div className="space-y-2">
          {payouts.map((p) => (
            <div key={p.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-white font-semibold">{p.restaurant_name || `#${p.restaurant_id}`}</p>
                <p className="text-gray-400 text-sm">
                  {formatMoney(p.amount_cents, p.currency_code)}
                  {' · '}
                  {p.created_at ? new Date(p.created_at).toLocaleString() : ''}
                  {p.failure_reason && <span className="text-red-400"> · {p.failure_reason}</span>}
                </p>
              </div>
              {tab === 'requested' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirm({ payout: p, action: 'approve' })}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    {t('restaurantPayouts.approve', 'Approve & pay')}
                  </button>
                  <button
                    onClick={() => setConfirm({ payout: p, action: 'reject' })}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 disabled:opacity-50"
                  >
                    {t('restaurantPayouts.reject', 'Reject')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'approve'
            ? t('restaurantPayouts.confirmApproveTitle', 'Approve and pay?')
            : t('restaurantPayouts.confirmRejectTitle', 'Reject payout?')}
          message={confirm.action === 'approve'
            ? t('restaurantPayouts.confirmApproveBody', 'This will immediately transfer {{amount}} to the restaurant\u2019s Stripe account and post the ledger entry. This cannot be undone.', { amount: formatMoney(confirm.payout.amount_cents, confirm.payout.currency_code) })
            : t('restaurantPayouts.confirmRejectBody', 'The restaurant will be able to request again.')}
          confirmLabel={confirm.action === 'approve'
            ? t('restaurantPayouts.approve', 'Approve & pay')
            : t('restaurantPayouts.reject', 'Reject')}
          onConfirm={() => act(confirm.payout, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
