import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useAuth } from '../../../hooks/useAuth';

/**
 * MoneyApprovals — dual-approval (maker-checker) queue for money movements.
 *
 * ADM-016: money movements at or above the configured threshold are queued
 * here instead of executing on a single admin's approval. A DIFFERENT admin
 * reviews each request and approves (fresh step-up challenge required, money
 * moves on approval) or rejects with a reason. Self-approval is blocked
 * server-side; the approve button is also disabled client-side for the
 * requester's own rows.
 */

const MOVEMENT_TYPE_LABELS = {
  job_refund: 'adminMoneyApprovals.typeJobRefund',
  marketplace_refund: 'adminMoneyApprovals.typeMarketplaceRefund',
  dispute_refund: 'adminMoneyApprovals.typeDisputeRefund',
  restaurant_payout: 'adminMoneyApprovals.typeRestaurantPayout',
  affiliate_payout: 'adminMoneyApprovals.typeAffiliatePayout',
};

function formatMoney(cents, currency) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

export default function MoneyApprovals() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await adminApi.get('/admin/money-approvals');
      setApprovals(data?.approvals || []);
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message || t('adminMoneyApprovals.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (approval) => {
    setNotice('');
    setBusyId(approval.id);
    try {
      // The checker re-authenticates at the moment money moves.
      let challengeId;
      try {
        const { data } = await adminApi.post('/admin/stepup-challenges/money-approval', {
          approvalId: approval.id,
        });
        challengeId = data?.challenge?.id;
      } catch (err) {
        throw new Error(t('adminMoneyApprovals.stepupFailed'));
      }
      if (!challengeId) throw new Error(t('adminMoneyApprovals.stepupFailed'));
      const code = window.prompt(t('adminMoneyApprovals.stepupPrompt'));
      if (!code || !code.trim()) throw new Error(t('adminMoneyApprovals.stepupRequired'));
      await adminApi.post(`/admin/money-approvals/${approval.id}/approve`, {
        stepupChallengeId: challengeId,
        stepupCode: code.trim(),
      });
      setNotice(t('adminMoneyApprovals.approved'));
      await load();
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message || t('adminMoneyApprovals.approveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (approval) => {
    setNotice('');
    const reason = window.prompt(t('adminMoneyApprovals.rejectReasonPrompt'));
    if (reason === null) return;
    if (!reason.trim()) {
      setLoadError(t('adminMoneyApprovals.rejectReasonRequired'));
      return;
    }
    setBusyId(approval.id);
    try {
      await adminApi.post(`/admin/money-approvals/${approval.id}/reject`, { reason: reason.trim() });
      setNotice(t('adminMoneyApprovals.rejected'));
      await load();
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message || t('adminMoneyApprovals.rejectFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const isOwn = (approval) => user?.id && String(approval.requestedBy) === String(user.id);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="text-emerald-400" size={24} />
            {t('adminMoneyApprovals.title')}
          </h1>
          <p className="text-gray-400 text-sm mt-1">{t('adminMoneyApprovals.subtitle')}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded border border-gray-600 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('adminMoneyApprovals.refresh')}
        </button>
      </div>

      {notice && (
        <div className="mb-4 flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 py-8 text-center">{t('adminMoneyApprovals.loading')}</p>
      ) : approvals.length === 0 ? (
        <div className="rounded border border-gray-700 bg-gray-800/50 px-6 py-10 text-center text-gray-400">
          {t('adminMoneyApprovals.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/80 text-left text-gray-300">
                <th className="px-4 py-3 font-medium">{t('adminMoneyApprovals.type')}</th>
                <th className="px-4 py-3 font-medium">{t('adminMoneyApprovals.reference')}</th>
                <th className="px-4 py-3 font-medium">{t('adminMoneyApprovals.amount')}</th>
                <th className="px-4 py-3 font-medium">{t('adminMoneyApprovals.requestedBy')}</th>
                <th className="px-4 py-3 font-medium">{t('adminMoneyApprovals.requestedAt')}</th>
                <th className="px-4 py-3 font-medium">{t('adminMoneyApprovals.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => {
                const own = isOwn(approval);
                const busy = busyId === approval.id;
                return (
                  <tr key={approval.id} className="border-t border-gray-700/60 text-gray-200">
                    <td className="px-4 py-3">
                      {MOVEMENT_TYPE_LABELS[approval.movementType]
                        ? t(MOVEMENT_TYPE_LABELS[approval.movementType])
                        : approval.movementType}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{approval.referenceKey}</td>
                    <td className="px-4 py-3 font-semibold text-white">
                      {formatMoney(approval.amountCents, approval.currencyCode)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{approval.requestedBy}</span>
                      {own && (
                        <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                          {t('adminMoneyApprovals.ownRequest')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDateTime(approval.requestedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(approval)}
                          disabled={busy || own}
                          title={own ? t('adminMoneyApprovals.cannotApproveOwn') : undefined}
                          className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          <CheckCircle2 size={14} /> {t('adminMoneyApprovals.approve')}
                        </button>
                        <button
                          onClick={() => handleReject(approval)}
                          disabled={busy}
                          className="flex items-center gap-1 rounded border border-red-500/50 px-3 py-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          <XCircle size={14} /> {t('adminMoneyApprovals.reject')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-gray-500">{t('adminMoneyApprovals.thresholdNote')}</p>
    </div>
  );
}
