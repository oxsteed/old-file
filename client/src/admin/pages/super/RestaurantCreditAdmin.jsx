import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { formatCreditDateTime } from '../../../lib/creditDateTime';

const PAGE_SIZE = 25;

function getErrorMessage(error, fallback, t) {
  return error?.response?.data?.message || error?.response?.data?.error || fallback || t('errors.generic');
}

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function dateTime(value, t) {
  return formatCreditDateTime(
    value,
    value ? (t ? t('adminRestaurantCreditUnknownTime') : 'Unknown time') : (t ? t('adminRestaurantCreditNoActivity') : 'No activity yet'),
  );
}

function shortId(value) {
  if (!value) return '-';
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function statusTone(status) {
  switch (status) {
    case 'active':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'suspended':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'closed':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    case 'pending':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'cancelled':
    case 'expired':
      return 'border-gray-700 bg-gray-800/70 text-gray-400';
    default:
      return 'border-gray-700 bg-gray-900/70 text-gray-400';
  }
}

const STATUS_LABEL_KEYS = {
  active: 'adminRestaurantCreditStatusActive',
  suspended: 'adminRestaurantCreditStatusSuspended',
  closed: 'adminRestaurantCreditStatusClosed',
  pending: 'adminRestaurantCreditStatusPending',
  approved: 'adminRestaurantCreditStatusApproved',
  cancelled: 'adminRestaurantCreditStatusCancelled',
  expired: 'adminRestaurantCreditStatusExpired',
  unknown: 'adminRestaurantCreditStatusUnknown',
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const key = STATUS_LABEL_KEYS[String(status || 'unknown').toLowerCase()];
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusTone(status)}`}>
      {key ? t(key) : String(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
          <p className={`mt-2 text-2xl font-semibold sm:text-3xl ${tone}`}>{value}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-800 bg-gray-900/80">
          <Icon className="h-4 w-4 text-gray-300" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500">{hint}</p>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/30 px-5 py-10 text-center">
      <Wallet className="mx-auto h-8 w-8 text-gray-700" />
      <p className="mt-3 text-sm font-semibold text-gray-300">{title}</p>
      {detail && <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500">{detail}</p>}
    </div>
  );
}

function SectionHeader({ eyebrow, title, detail, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-300">{eyebrow}</p>}
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        {detail && <p className="mt-1 text-sm leading-6 text-gray-500">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function ConfirmDialog({ modal, busy, error, onChange, onClose, onConfirm }) {
  const { t } = useTranslation();
  if (!modal) return null;
  const needsReason = ['decline', 'release', 'status'].includes(modal.kind);
  const requiresReason = modal.kind === 'decline' || modal.kind === 'release' || (modal.kind === 'status' && modal.status === 'suspended');
  const isApproval = modal.kind === 'approve';
  const isStatus = modal.kind === 'status';
  const canConfirm = !busy && (!requiresReason || modal.reason?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="restaurant-credit-dialog-title">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#111318] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">{t('adminRestaurantCreditConfirmAction')}</p>
            <h2 id="restaurant-credit-dialog-title" className="mt-2 text-xl font-semibold text-white">{modal.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-white" aria-label={t('adminRestaurantCreditCloseDialog')}>
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-400">{t('adminRestaurantCreditConfirmText')}</p>

        {isStatus && (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            {t('adminRestaurantCreditNewStatus')}
            <select
              value={modal.status || 'suspended'}
              onChange={(event) => onChange({ status: event.target.value })}
              className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white outline-none focus:border-orange-400"
            >
              <option value="suspended">{t('adminRestaurantCreditStatusSuspended')}</option>
              <option value="active">{t('adminRestaurantCreditStatusActive')}</option>
            </select>
          </label>
        )}

        {isApproval ? (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            {t('adminRestaurantCreditApprovalNote')} <span className="font-normal text-gray-500">({t('adminRestaurantCreditOptional')})</span>
            <textarea
              value={modal.approvalNote || ''}
              onChange={(event) => onChange({ approvalNote: event.target.value })}
              rows={3}
              maxLength={500}
              placeholder={t('adminRestaurantCreditApprovalNotePlaceholder')}
              className="mt-2 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white placeholder:text-gray-600 outline-none focus:border-orange-400"
            />
          </label>
        ) : needsReason ? (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            {t('adminRestaurantCreditReason')} {requiresReason ? <span className="text-orange-300">*</span> : <span className="font-normal text-gray-500">({t('adminRestaurantCreditOptional')})</span>}
            <textarea
              value={modal.reason || ''}
              onChange={(event) => onChange({ reason: event.target.value })}
              rows={3}
              maxLength={500}
              placeholder={t('adminRestaurantCreditReasonPlaceholder')}
              className="mt-2 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white placeholder:text-gray-600 outline-none focus:border-orange-400"
            />
          </label>
        ) : null}

        {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} disabled={!canConfirm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('adminRestaurantCreditConfirmActionBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletDetail({ detail, onStatus, onRelease }) {
  const { t } = useTranslation();
  const wallet = detail.wallet;
  const canSuspend = wallet.status === 'active';
  const canChangeStatus = wallet.status !== 'closed';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-300">{t('adminRestaurantCreditWalletDetail')}</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-white">{wallet.customerName || wallet.customerEmail || shortId(wallet.customerId)}</h2>
          <p className="mt-1 break-all text-xs text-gray-500">{wallet.customerEmail || wallet.customerId} · {wallet.restaurantName || shortId(wallet.restaurantId)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={wallet.status} />
          <button type="button" onClick={() => onStatus(wallet)} disabled={!canChangeStatus} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40">
            {wallet.status === 'closed' ? t('adminRestaurantCreditWalletClosed') : canSuspend ? t('adminRestaurantCreditSuspendWallet') : t('adminRestaurantCreditReactivateWallet')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-xs text-gray-500">{t('adminRestaurantCreditLedgerBalance')}</p><p className="mt-1 text-lg font-semibold text-white">{money(wallet.balanceCents, wallet.currencyCode)}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-xs text-gray-500">{t('adminRestaurantCreditReserved')}</p><p className="mt-1 text-lg font-semibold text-amber-300">{money(wallet.reservedCents, wallet.currencyCode)}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-xs text-gray-500">{t('adminRestaurantCreditAvailable')}</p><p className="mt-1 text-lg font-semibold text-emerald-300">{money(wallet.availableBalanceCents, wallet.currencyCode)}</p></div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-950/30 p-3 text-xs text-gray-500">
        <span className="font-semibold text-gray-300">{t('adminRestaurantCreditAccount')}:</span> {wallet.accountId} · <span className="font-semibold text-gray-300">{t('adminRestaurantCreditLedgerVersion')}:</span> {wallet.ledgerVersion} · <span className="font-semibold text-gray-300">{t('adminRestaurantCreditUpdated')}:</span> {dateTime(wallet.updatedAt, t)}
      </div>

      <HistorySection title={t('adminRestaurantCreditLoadRequests')} count={detail.loadRequests?.length}>
        {!detail.loadRequests?.length ? <p className="text-sm text-gray-500">{t('adminRestaurantCreditNoLoadRequests')}</p> : (
          <div className="space-y-2">
            {detail.loadRequests.slice(0, 8).map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3">
                <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={item.status} /><span className="text-sm font-semibold text-white">{money(item.amountCents, item.currencyCode)}</span></div><p className="mt-1 text-xs text-gray-500">{item.note || t('adminRestaurantCreditNoNote')} · {dateTime(item.createdAt, t)}</p></div>
                <span className="text-xs text-gray-600">#{item.id}</span>
              </div>
            ))}
          </div>
        )}
      </HistorySection>

      <HistorySection title={t('adminRestaurantCreditActiveHolds')} count={detail.holds?.filter((hold) => hold.status === 'active').length || 0}>
        {!detail.holds?.length ? <p className="text-sm text-gray-500">{t('adminRestaurantCreditNoHolds')}</p> : (
          <div className="space-y-2">
            {detail.holds.slice(0, 8).map((hold) => (
              <div key={hold.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3">
                <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={hold.status} /><span className="text-sm font-semibold text-white">{money(hold.amountCents, hold.currencyCode)}</span></div><p className="mt-1 text-xs text-gray-500">{hold.purpose || t('adminRestaurantCreditHoldPurpose')} · {dateTime(hold.createdAt, t)}</p></div>
                {hold.status === 'active' && <button type="button" onClick={() => onRelease(hold)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10">{t('adminRestaurantCreditReleaseHoldBtn')}</button>}
              </div>
            ))}
          </div>
        )}
      </HistorySection>

      <HistorySection title={t('adminRestaurantCreditTransfers')} count={detail.transfers?.length}>
        {!detail.transfers?.length ? <p className="text-sm text-gray-500">{t('adminRestaurantCreditNoTransfers')}</p> : (
          <div className="space-y-2">
            {detail.transfers.slice(0, 12).map((transfer) => {
              const outgoing = String(transfer.senderAccountId) === String(wallet.accountId);
              return <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={transfer.status} /><span className={`text-sm font-semibold ${outgoing ? 'text-red-300' : 'text-emerald-300'}`}>{outgoing ? '-' : '+'}{money(transfer.amountCents, transfer.currencyCode)}</span></div><p className="mt-1 text-xs text-gray-500">{outgoing ? t('adminRestaurantCreditTo') : t('adminRestaurantCreditFrom')} {t('adminRestaurantCreditWalletWord')} {shortId(outgoing ? transfer.recipientAccountId : transfer.senderAccountId)}{transfer.memo ? ` · ${transfer.memo}` : ''}</p></div><span className="text-xs text-gray-600">{dateTime(transfer.createdAt, t)}</span></div>;
            })}
          </div>
        )}
      </HistorySection>

      <HistorySection title={t('adminRestaurantCreditLedgerActivity')} count={detail.ledger?.length}>
        {!detail.ledger?.length ? <p className="text-sm text-gray-500">{t('adminRestaurantCreditNoLedger')}</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="min-w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColEntry')}</th><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColAmount')}</th><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColBalanceAfter')}</th><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColPosted')}</th></tr></thead><tbody className="divide-y divide-gray-800">
              {detail.ledger.slice(0, 20).map((entry) => <tr key={entry.id} className="text-gray-300"><td className="px-3 py-2"><span className="font-semibold text-white">{entry.entryType}</span><span className="ml-2 text-gray-600">#{entry.id}</span><p className="mt-1 max-w-[220px] truncate text-gray-500">{entry.description || t('adminRestaurantCreditNoDescription')}</p></td><td className="whitespace-nowrap px-3 py-2">{money(entry.amountCents, entry.currencyCode)}</td><td className="whitespace-nowrap px-3 py-2">{money(entry.balanceAfterCents, entry.currencyCode)}</td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{dateTime(entry.createdAt, t)}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </HistorySection>

      <HistorySection title={t('adminRestaurantCreditOperatorAudit')} count={detail.operatorAudit?.length}>
        {!detail.operatorAudit?.length ? <p className="text-sm text-gray-500">{t('adminRestaurantCreditNoOperatorActions')}</p> : (
          <div className="space-y-2">{detail.operatorAudit.slice(0, 12).map((event) => <div key={event.id} className="rounded-xl border border-gray-800 bg-gray-950/35 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-white">{String(event.actionType || t('adminRestaurantCreditOperatorAction')).replace(/_/g, ' ')}</span><span className="text-xs text-gray-600">{dateTime(event.createdAt, t)}</span></div><p className="mt-1 text-xs text-gray-500">{event.operatorName || event.operatorEmail || t('adminRestaurantCreditSystemOperator')} · correlation {shortId(event.correlationId)}</p></div>)}</div>
        )}
      </HistorySection>

      <HistorySection title={t('adminRestaurantCreditLinkedPayments')} count={detail.payments?.length}>
        {!detail.payments?.length ? <p className="text-sm text-gray-500">{t('adminRestaurantCreditNoPayments')}</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColPayment')}</th><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColAmount')}</th><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColStatus')}</th><th className="px-3 py-2 font-medium">{t('adminRestaurantCreditColCreated')}</th></tr></thead><tbody className="divide-y divide-gray-800">{detail.payments.slice(0, 12).map((payment) => <tr key={payment.id} className="text-gray-300"><td className="px-3 py-2"><span className="font-semibold text-white">{payment.paymentType || t('adminRestaurantCreditPayment')}</span><p className="mt-1 text-gray-500">{payment.reference || payment.foodOrderId || `#${payment.id}`}</p></td><td className="whitespace-nowrap px-3 py-2">{money(payment.amountCents, payment.currencyCode || wallet.currencyCode)}</td><td className="px-3 py-2"><StatusBadge status={payment.status} /></td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{dateTime(payment.createdAt, t)}</td></tr>)}</tbody></table></div>
        )}
      </HistorySection>
    </div>
  );
}

function HistorySection({ title, count, children }) {
  return <section className="rounded-2xl border border-gray-800 bg-gray-950/20 p-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">{title}</h3><span className="text-xs text-gray-600">{count || 0}</span></div>{children}</section>;
}

function ConversionPolicySection({ restaurants }) {
  const { t } = useTranslation();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/restaurant-conversion-policies');
      setPolicies(response.data?.policies || []);
    } catch (err) {
      setError(getErrorMessage(err, t('adminConversionPolicyLoadFailed'), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  const policyByRestaurantId = new Map((policies || []).map((policy) => [String(policy.restaurantId), policy]));

  const togglePolicy = async (restaurant, allow) => {
    setBusyId(restaurant.id);
    setNotice('');
    setError('');
    try {
      await adminApi.put('/admin/super/oxsteed-credit/restaurant-conversion-policies', {
        restaurantId: restaurant.id,
        allowRestaurantToOxsteed: allow,
      });
      setNotice(t('adminConversionPolicyQueued'));
      await loadPolicies();
    } catch (err) {
      setError(getErrorMessage(err, t('adminConversionPolicyQueueFailed'), t));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
      <SectionHeader
        eyebrow={t('adminConversionPolicyEyebrow')}
        title={t('adminConversionPolicyTitle')}
        detail={t('adminConversionPolicyDetail')}
        action={
          <button type="button" onClick={loadPolicies} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50">
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('common.retry')}
          </button>
        }
      />
      {notice && <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">{notice}</p>}
      {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
      <div className="mt-5">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div>
        ) : !restaurants.length ? (
          <EmptyState title={t('adminConversionPolicyEmpty')} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="min-w-[560px] w-full text-left text-xs">
              <thead className="bg-gray-950/70 text-gray-500">
                <tr>
                  <th className="px-3 py-3 font-medium">{t('adminConversionPolicyColRestaurant')}</th>
                  <th className="px-3 py-3 font-medium">{t('adminConversionPolicyColStatus')}</th>
                  <th className="px-3 py-3 font-medium">{t('adminConversionPolicyColAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {restaurants.map((restaurant) => {
                  const policy = policyByRestaurantId.get(String(restaurant.id));
                  const enabled = policy?.allowRestaurantToOxsteed === true;
                  return (
                    <tr key={restaurant.id} className="text-gray-300">
                      <td className="max-w-[260px] truncate px-3 py-3 font-semibold text-white">{restaurant.name || restaurant.id}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-gray-700 bg-gray-800/70 text-gray-400'}`}>
                          {enabled ? t('adminConversionPolicyEnabled') : t('adminConversionPolicyDisabled')}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          disabled={busyId === restaurant.id}
                          onClick={() => togglePolicy(restaurant, !enabled)}
                          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50 ${enabled ? 'border border-red-500/30 text-red-300 hover:bg-red-500/10' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                        >
                          {busyId === restaurant.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {enabled ? t('adminConversionPolicyDisable') : t('adminConversionPolicyEnable')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default function RestaurantCreditAdmin() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', restaurantId: '' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [modal, setModal] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        pageSize: PAGE_SIZE,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.restaurantId ? { restaurantId: filters.restaurantId } : {}),
      };
      const response = await adminApi.get('/admin/super/restaurant-credit/overview', { params });
      setData(response.data);
    } catch (err) {
      setError(getErrorMessage(err, t('adminRestaurantCreditLoadFailed'), t));
    } finally {
      setLoading(false);
    }
  }, [filters.q, filters.restaurantId, filters.status, page, t]);

  const loadDetail = useCallback(async (accountId) => {
    if (!accountId) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await adminApi.get(`/admin/super/restaurant-credit/wallets/${accountId}`);
      setDetail(response.data);
    } catch (err) {
      setDetail(null);
      setDetailError(getErrorMessage(err, t('adminRestaurantCreditDetailFailed'), t));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (selectedAccountId) loadDetail(selectedAccountId); }, [loadDetail, selectedAccountId]);

  const refresh = async () => {
    await loadOverview();
    if (selectedAccountId) await loadDetail(selectedAccountId);
  };

  const selectWallet = (accountId) => {
    setSelectedAccountId(accountId);
    setDetail(null);
    setDetailError('');
  };

  const openModal = (nextModal) => {
    setActionError('');
    setModal(nextModal);
  };

  const runAction = async () => {
    if (!modal) return;
    setActionBusy(true);
    setActionError('');
    try {
      let path = '';
      let body = {};
      if (modal.kind === 'approve') {
        path = `/admin/super/restaurant-credit/load-requests/${modal.request.id}/approve`;
        body = { approvalNote: modal.approvalNote?.trim() || undefined };
      } else if (modal.kind === 'decline') {
        path = `/admin/super/restaurant-credit/load-requests/${modal.request.id}/decline`;
        body = { reason: modal.reason.trim() };
      } else if (modal.kind === 'release') {
        path = `/admin/super/restaurant-credit/holds/${modal.hold.id}/release`;
        body = { reason: modal.reason.trim() };
      } else if (modal.kind === 'status') {
        path = `/admin/super/restaurant-credit/wallets/${modal.wallet.accountId}/status`;
        body = { status: modal.status, reason: modal.reason?.trim() || undefined };
      }
      await adminApi.post(path, body);
      setModal(null);
      await refresh();
    } catch (err) {
      setActionError(getErrorMessage(err, t('adminRestaurantCreditActionFailed'), t));
    } finally {
      setActionBusy(false);
    }
  };

  const summary = data?.summary || {};
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };
  const wallets = data?.wallets || [];
  const pendingRequests = data?.pendingRequests || [];
  // The server reports only a distinct currency count, not the single code.
  // When every wallet shares one currency, any wallet's code is authoritative;
  // never assume USD for a non-USD book.
  const singleWalletCurrency = wallets.find((wallet) => wallet.currencyCode)?.currencyCode;
  const summaryCurrency = Number(summary.currencyCount || 0) > 1 ? 'MULTI' : (singleWalletCurrency || 'USD');
  const summaryMoney = (cents) => summaryCurrency === 'MULTI' ? t('adminRestaurantCreditMultiple') : money(cents, summaryCurrency);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 pb-10">
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">{t('adminOneTruthSuperAdmin')}</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> {t('adminRestaurantCreditAuditProtected')}</span></div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t('adminRestaurantCreditTitle')}</h1>
            <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{t('adminRestaurantCreditSubtitle')}</p>
          </div>
          <button type="button" onClick={refresh} disabled={loading || detailLoading} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRestaurantCreditRefreshData')}</button>
        </div>
      </header>

      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300"><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><button type="button" onClick={loadOverview} className="rounded-lg border border-red-500/40 px-3 py-2 font-semibold hover:bg-red-500/10">{t('common.retry')}</button></div>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Wallet} label={t('adminRestaurantCreditWallets')} value={summary.totalWallets ?? '...'} hint={t('adminRestaurantCreditRestaurantsInScope', { count: summary.totalRestaurants || 0 })} />
        <MetricCard icon={CreditCard} label={t('adminRestaurantCreditLedgerBalance')} value={summaryMoney(summary.totalBalanceCents)} hint={t('adminRestaurantCreditActiveWallets', { count: summary.activeWallets || 0 })} />
        <MetricCard icon={CheckCircle2} label={t('adminRestaurantCreditAvailable')} value={summaryMoney(summary.totalAvailableCents)} hint={summaryCurrency === 'MULTI' ? t('adminRestaurantCreditMultipleCurrencies') : t('adminRestaurantCreditReservedAmount', { amount: summaryMoney(summary.totalReservedCents) })} tone="text-emerald-300" />
        <MetricCard icon={Clock3} label={t('adminRestaurantCreditPendingLoads')} value={summary.pendingLoadRequests ?? '...'} hint={summaryMoney(summary.pendingLoadAmountCents)} tone="text-sky-300" />
        <MetricCard icon={AlertTriangle} label={t('adminRestaurantCreditActiveHoldsLabel')} value={summary.activeHolds ?? '...'} hint={summaryMoney(summary.activeHoldAmountCents)} tone="text-amber-300" />
      </section>

      <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); setPage(1); setFilters((current) => ({ ...current, q: searchInput.trim() })); }}>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminRestaurantCreditSearchLabel')}</label>
            <div className="mt-2 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('adminRestaurantCreditSearchPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-10 py-3 text-sm text-white placeholder:text-gray-600 outline-none focus:border-orange-400" /></div><button type="submit" className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400">{t('common.search')}</button></div>
          </form>
          <label className="w-full lg:max-w-[220px]"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminRestaurantCreditWalletStatus')}</span><select value={filters.status} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, status: event.target.value })); }} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">{t('adminFranchiseAllStatuses')}</option><option value="active">{t('adminRestaurantCreditStatusActive')}</option><option value="suspended">{t('adminRestaurantCreditStatusSuspended')}</option><option value="closed">{t('adminRestaurantCreditStatusClosed')}</option></select></label>
          <label className="w-full lg:max-w-[260px]"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">{t('adminRestaurantCreditRestaurant')}</span><select value={filters.restaurantId} onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, restaurantId: event.target.value })); }} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">{t('adminRestaurantCreditAllRestaurants')}</option>{(data?.restaurants || []).map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}</select></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>{t('adminRestaurantCreditResultsNote', { count: pagination.total || 0 })}</span>{(filters.q || filters.status || filters.restaurantId) && <button type="button" onClick={() => { setSearchInput(''); setPage(1); setFilters({ q: '', status: '', restaurantId: '' }); }} className="font-semibold text-orange-300 hover:text-orange-200">{t('adminRestaurantCreditClearFilters')}</button>}</div>
      </section>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <section className="min-w-0 rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          <SectionHeader eyebrow={t('adminRestaurantCreditWalletDirectory')} title={t('adminRestaurantCreditWalletDirectoryTitle')} detail={t('adminRestaurantCreditWalletDirectoryText')} />
          <div className="mt-5">
            {loading && !data ? <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : !wallets.length ? <EmptyState title={t('adminRestaurantCreditNoWallets')} detail={t('adminRestaurantCreditNoWalletsText')} /> : <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[720px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurantCreditColCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantCreditColRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantCreditColBalance')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantCreditColAvailable')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantCreditColStatus')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantCreditColActivity')}</th></tr></thead><tbody className="divide-y divide-gray-800">{wallets.map((wallet) => <tr key={wallet.accountId} onClick={() => selectWallet(wallet.accountId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectWallet(wallet.accountId); }} tabIndex={0} className={`cursor-pointer text-gray-300 transition hover:bg-gray-900/70 focus:bg-gray-900/70 focus:outline-none ${String(selectedAccountId) === String(wallet.accountId) ? 'bg-orange-500/10' : ''}`}><td className="max-w-[220px] px-3 py-3"><p className="truncate font-semibold text-white">{wallet.customerName || wallet.customerEmail || shortId(wallet.customerId)}</p><p className="mt-1 truncate text-gray-600">{wallet.customerEmail || shortId(wallet.customerId)}</p></td><td className="max-w-[170px] truncate px-3 py-3 text-gray-400">{wallet.restaurantName || shortId(wallet.restaurantId)}</td><td className="whitespace-nowrap px-3 py-3 font-semibold text-white">{money(wallet.balanceCents, wallet.currencyCode)}</td><td className="whitespace-nowrap px-3 py-3 text-emerald-300">{money(wallet.availableBalanceCents, wallet.currencyCode)}</td><td className="px-3 py-3"><StatusBadge status={wallet.status} /></td><td className="whitespace-nowrap px-3 py-3 text-gray-500">{dateTime(wallet.lastActivityAt, t)}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 pt-4 text-xs text-gray-500"><span>{t('adminRestaurantCreditPage', { page: pagination.page || page, totalPages: pagination.totalPages || 1 })}</span><div className="flex gap-2"><button type="button" disabled={(pagination.page || page) <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> {t('common.previous')}</button><button type="button" disabled={(pagination.page || page) >= (pagination.totalPages || 1) || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40">{t('common.next')} <ChevronRight className="h-4 w-4" /></button></div></div>
        </section>

        <aside className="min-w-0 rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          {detailLoading ? <div className="flex items-center justify-center py-24 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : detailError ? <div className="space-y-3 py-16 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-red-400" /><p className="text-sm text-red-300">{detailError}</p><button type="button" onClick={() => loadDetail(selectedAccountId)} className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800">{t('common.retry')}</button></div> : detail ? <WalletDetail detail={detail} onStatus={(wallet) => openModal({ kind: 'status', title: wallet.status === 'active' ? t('adminRestaurantCreditSuspendWallet') : t('adminRestaurantCreditReactivateWallet'), wallet, status: wallet.status === 'active' ? 'suspended' : 'active', reason: '' })} onRelease={(hold) => openModal({ kind: 'release', title: t('adminRestaurantCreditReleaseHold'), hold, reason: '' })} /> : <div className="flex min-h-[360px] flex-col items-center justify-center text-center"><FileText className="h-9 w-9 text-gray-700" /><h2 className="mt-4 text-lg font-semibold text-white">{t('adminRestaurantCreditSelectWallet')}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-gray-500">{t('adminRestaurantCreditSelectWalletText')}</p></div>}
        </aside>
      </div>

      <ConversionPolicySection restaurants={data?.restaurants || []} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><SectionHeader eyebrow={t('adminRestaurantCreditMakerChecker')} title={t('adminRestaurantCreditPendingRequests')} detail={t('adminRestaurantCreditPendingRequestsText')} />{!pendingRequests.length ? <div className="mt-5"><EmptyState title={t('adminRestaurantCreditNoPendingRequests')} detail={t('adminRestaurantCreditNoPendingRequestsText')} /></div> : <div className="mt-5 space-y-3">{pendingRequests.slice(0, 8).map((request) => <div key={request.id} className="rounded-xl border border-gray-800 bg-gray-950/35 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={request.status} /><span className="text-base font-semibold text-white">{money(request.amountCents, request.currencyCode)}</span></div><p className="mt-2 text-sm text-gray-300">{request.customerName || request.customerEmail || shortId(request.customerId)}</p><p className="mt-1 text-xs text-gray-500">{request.restaurantName || shortId(request.restaurantId)} · requested by {request.requestedByName || shortId(request.requestedByUserId)} · {dateTime(request.createdAt, t)}</p>{request.note && <p className="mt-2 text-xs leading-5 text-gray-500">{request.note}</p>}</div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => openModal({ kind: 'decline', title: t('adminRestaurantCreditDeclineLoad'), request, reason: '' })} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">{t('adminRestaurantCreditDecline')}</button><button type="button" onClick={() => openModal({ kind: 'approve', title: t('adminRestaurantCreditApproveLoad'), request, approvalNote: '' })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">{t('common.approve')}</button></div></div></div>)}</div>}</section>
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><SectionHeader eyebrow={t('adminRestaurantCreditAuditStream')} title={t('adminRestaurantCreditRecentActivity')} detail={t('adminRestaurantCreditRecentActivityText')} />{!data?.recentActivity?.length ? <div className="mt-5"><EmptyState title={t('adminRestaurantCreditNoActivityYet')} detail={t('adminRestaurantCreditNoActivityYetText')} /></div> : <div className="mt-5 space-y-2">{data.recentActivity.slice(0, 10).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-950/35 p-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-white">{entry.entryType}</span><span className="text-xs text-gray-600">{entry.customerName || shortId(entry.customerId)} · {entry.restaurantName || shortId(entry.restaurantId)}</span></div><p className="mt-1 truncate text-xs text-gray-500">{entry.description || t('adminRestaurantCreditNoDescription')} · {dateTime(entry.createdAt, t)}</p></div><span className="whitespace-nowrap text-sm font-semibold text-gray-200">{money(entry.amountCents, entry.currencyCode)}</span></div>)}</div>}</section>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-950/20 p-4 text-sm leading-6 text-sky-200"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" /><p><span className="font-semibold">{t('adminRestaurantCreditControlBoundary')}:</span> {t('adminRestaurantCreditControlBoundaryText')}</p></div>

      <ConfirmDialog modal={modal} busy={actionBusy} error={actionError} onClose={() => { if (!actionBusy) setModal(null); }} onChange={(changes) => setModal((current) => ({ ...current, ...changes }))} onConfirm={runAction} />
    </main>
  );
}
