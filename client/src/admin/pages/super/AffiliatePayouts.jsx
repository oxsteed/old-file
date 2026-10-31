import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

const TABS = ['all', 'pending', 'processing', 'completed', 'failed', 'reversed'];
const PAGE_SIZE = 20;

function formatMoney(cents) {
  const n = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  } catch {
    return `${n.toFixed(2)} USD`;
  }
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

export default function AffiliatePayouts() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/affiliate/payouts', {
      signal,
      params: { ...(tab !== 'all' ? { status: tab } : {}), limit: PAGE_SIZE, offset },
    });
    return {
      payouts: body?.payouts || [],
      total: Number(body?.pagination?.total || 0),
    };
  }, [tab, offset]);

  const payouts = data?.payouts || [];
  const total = data?.total || 0;

  useEffect(() => { setOffset(0); }, [tab]);

  const switchTab = useCallback((next) => {
    setTab(next);
    setNotice('');
    setActionError('');
  }, []);

  const process = useCallback(async (payout) => {
    setBusyId(payout.id);
    setNotice('');
    setActionError('');
    try {
      // Auth audit item 6: the server binds the challenge to this payout's
      // payable amount, so the issue call must name the payout. The
      // challenge is emailed (affiliate_payout_process is not a TOTP
      // action), so the prompt says so; the shared step-up helper's
      // prompt names the authenticator app and would mislead here.
      const challengeResponse = await adminApi.post(`/affiliate/${payout.id}/stepup-challenges`, {});
      const challengeId = challengeResponse.data?.challenge?.id;
      if (!challengeId) throw new Error(t('affiliatePayouts.stepupFailed'));
      const code = window.prompt(t('affiliatePayouts.stepupPrompt'));
      if (!code?.trim()) throw new Error(t('affiliatePayouts.stepupRequired'));
      const { data: body } = await adminApi.post(`/affiliate/${payout.id}/process`, {
        stepupChallengeId: challengeId,
        stepupCode: code.trim(),
      });
      setConfirm(null);
      // ADM-016: above-threshold payouts queue for a second admin (202)
      // instead of executing immediately.
      if (body?.code === 'money_movement_pending_approval') {
        setNotice(t('affiliatePayouts.queuedNotice'));
      } else {
        setNotice(t('affiliatePayouts.processedNotice'));
      }
      reload();
    } catch (err) {
      setActionError(err?.response?.data?.error?.message || err?.message || t('affiliatePayouts.loadFailed'));
    } finally {
      setBusyId(null);
    }
  }, [reload, t]);

  return (
    <div className="p-6">
      <h1 className="text-white text-xl font-bold mb-1">
        {t('affiliatePayouts.title')}
      </h1>
      <p className="text-gray-400 text-sm mb-4">
        {t('affiliatePayouts.subtitle')}
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === key ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
          >
            {t(`affiliatePayouts.tab.${key}`)}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={loadError?.message || t('affiliatePayouts.loadFailed')} onRetry={reload} />
      )}
      {actionError && (
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {notice}
        </div>
      )}
      {!loading && !loadError && payouts.length === 0 && (
        <p className="text-gray-500">{t('affiliatePayouts.empty')}</p>
      )}

      {!loading && !loadError && payouts.length > 0 && (
        <div className="space-y-2">
          {payouts.map((p) => {
            const affiliateName = `${p.affiliate_first_name || ''} ${p.affiliate_last_name || ''}`.trim()
              || `#${p.affiliate_program_id}`;
            return (
              <div key={p.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white font-semibold">{affiliateName}</p>
                  <p className="text-gray-400 text-sm">
                    {formatMoney(p.payable_cents)}
                    {' · '}
                    {t(`affiliatePayouts.status.${p.status}`)}
                    {' · '}
                    {formatDate(p.period_start)}
                    {' – '}
                    {formatDate(p.period_end)}
                    {p.created_at ? ` · ${new Date(p.created_at).toLocaleString()}` : ''}
                    {p.failed_reason && <span className="text-red-400"> · {p.failed_reason}</span>}
                  </p>
                </div>
                {p.status === 'pending' && (
                  <button
                    onClick={() => setConfirm(p)}
                    disabled={busyId === p.id}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-orange-500 text-white disabled:opacity-50 shrink-0"
                  >
                    {busyId === p.id ? t('affiliatePayouts.processing') : t('affiliatePayouts.process')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !loadError && total > 0 && (
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-800 text-gray-300 disabled:opacity-50"
          >
            {t('affiliatePayouts.prev')}
          </button>
          <span className="text-gray-400 text-sm">{t('affiliatePayouts.total', { total })}</span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + payouts.length >= total}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-800 text-gray-300 disabled:opacity-50"
          >
            {t('affiliatePayouts.next')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={t('affiliatePayouts.confirmTitle')}
        message={confirm ? t('affiliatePayouts.confirmBody', { amount: formatMoney(confirm.payable_cents) }) : ''}
        confirmLabel={t('affiliatePayouts.process')}
        onConfirm={() => process(confirm)}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
