import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import AuditQueuePager from '../../lib/AuditQueuePager';
import ConfirmDialog from '../../lib/ConfirmDialog';

const TABS = ['requested', 'approved', 'processing', 'completed', 'failed', 'rejected'];
const PAGE_SIZE = 50;

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
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const abortableFetch = useAbortableFetch();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await abortableFetch(adminApi.get('/admin/restaurant-payouts', { params: { status: tab, limit: PAGE_SIZE, offset } }));
      setPayouts(data?.payouts || []);
      const nextTotal = Number(data?.total ?? 0);
      setTotal(nextTotal);
      // An action on the last page can empty it; step back to the last
      // non-empty page instead of showing a false-empty list.
      if (nextTotal > 0 && offset >= nextTotal) {
        setOffset(Math.floor((nextTotal - 1) / PAGE_SIZE) * PAGE_SIZE);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err?.message || 'Failed to load payouts.');
    } finally {
      setLoading(false);
    }
  }, [tab, offset, abortableFetch]);

  useEffect(() => { load(); }, [load]);

  const act = async (payout, action) => {
    setBusyId(payout.id);
    try {
      let body = {};
      if (action === 'approve') {
        // ADM-113: single-admin approval moves arbitrary sums via Stripe
        // Transfer; the approver must prove a fresh step-up challenge.
        // Auth audit item 6: the server binds the challenge to this
        // payout's amount, so the issue call must name the payout.
        const challengeResponse = await adminApi.post('/admin/restaurant-payouts/stepup-challenges', { payoutId: payout.id });
        const challengeId = challengeResponse.data?.challenge?.id;
        if (!challengeId) throw new Error(t('restaurantPayouts.stepupFailed'));
        const code = window.prompt(t('restaurantPayouts.stepupPrompt'));
        if (!code || !code.trim()) throw new Error(t('restaurantPayouts.stepupRequired'));
        body = { stepupChallengeId: challengeId, stepupCode: code.trim() };
      }
      // Finding 47: the approve POST carries a per-approval
      // Idempotency-Key so a retried approval replays instead of
      // re-entering the dual-approval gate.
      const { data } = await adminApi.post(`/admin/restaurant-payouts/${payout.id}/${action}`, body, {
        headers: action === 'approve' ? { 'Idempotency-Key': `restaurant-payout-approve-${payout.id}` } : {},
      });
      setConfirm(null);
      // ADM-016: above-threshold payouts queue for a second admin (202)
      // instead of executing immediately.
      if (data?.code === 'money_movement_pending_approval') {
        setNotice(t('restaurantPayouts.pendingApproval'));
      } else {
        setNotice('');
      }
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
        {t('restaurantPayouts.subtitleQueued')}
      </p>

      <div className="flex gap-2 mb-4">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => { setTab(key); setOffset(0); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === key ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
          >
            {t(`restaurantPayouts.tab.${key}`, key)}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400">{t('common.loading', 'Loading…')}</p>}
      {error && <AdminErrorState message={error} onRetry={load} />}
      {notice && (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {notice}
        </div>
      )}
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
                  {p.transfer_attempts != null && Number(p.transfer_attempts) > 0 && <span className="text-gray-400"> · {t('restaurantPayouts.transferAttempts', { count: p.transfer_attempts })}</span>}
                </p>
              </div>
              {tab === 'processing' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => act(p, 'retry')}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
                  >
                    {t('restaurantPayouts.retry')}
                  </button>
                  <button
                    onClick={() => setConfirm({ payout: p, action: 'fail' })}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                  >
                    {t('restaurantPayouts.fail')}
                  </button>
                </div>
              )}
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

      {!loading && !error && total > 0 && (
        <AuditQueuePager offset={offset} limit={PAGE_SIZE} total={total} busy={loading || !!busyId} onChange={setOffset} />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'approve'
            ? t('restaurantPayouts.confirmApproveTitle')
            : confirm.action === 'fail'
              ? t('restaurantPayouts.confirmFailTitle')
              : t('restaurantPayouts.confirmRejectTitle')}
          message={confirm.action === 'approve'
            ? t('restaurantPayouts.confirmApproveBodyQueued', { amount: formatMoney(confirm.payout.amount_cents, confirm.payout.currency_code) })
            : confirm.action === 'fail'
              ? t('restaurantPayouts.confirmFailBody')
              : t('restaurantPayouts.confirmRejectBody')}
          confirmLabel={confirm.action === 'approve'
            ? t('restaurantPayouts.approve')
            : confirm.action === 'fail'
              ? t('restaurantPayouts.fail')
              : t('restaurantPayouts.reject')}
          onConfirm={() => act(confirm.payout, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
