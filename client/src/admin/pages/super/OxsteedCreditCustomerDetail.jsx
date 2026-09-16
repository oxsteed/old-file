import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock3, Download, RefreshCw, ShieldCheck, Store, WalletCards, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { formatCreditMinorUnits } from '../../../lib/creditCurrency';
import { beginCreditRequest, invalidateCreditRequest, isCurrentCreditRequest } from './creditRequestGuards';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { localizeCreditStatus } from '../../../lib/creditStatus';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';

const money = formatCreditMinorUnits;

function dateTime(value) {
  return formatCreditDateTime(value, value ? 'Unknown date' : 'Not posted');
}

function statusClass(status) {
  if (['active', 'posted'].includes(status)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (['pending', 'captured', 'released'].includes(status)) return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (['suspended', 'expired', 'reversed', 'voided'].includes(status)) return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  const { t } = useTranslation('credit');
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{localizeCreditStatus(status, t)}</span>;
}

function transactionLabel(transaction, t) {
  const labels = {
    load: t('adminTransactionCreditGrant'),
    purchase: t('adminTransactionRestaurantPurchase'),
    refund: t('adminTransactionPurchaseRefund'),
    transfer: t('adminTransactionCustomerTransfer'),
    adjustment: t('adminTransactionAccountAdjustment'),
    settlement: t('adminTransactionPartnerSettlement'),
    fee: t('adminTransactionCreditFee'),
    expiration: t('adminTransactionCreditExpiration'),
    chargeback: t('adminTransactionChargeback'),
  };
  return labels[transaction.transactionType] || String(transaction.transactionType || 'ledger_transaction').replace(/_/g, ' ');
}

export default function OxsteedCreditCustomerDetail({ account, onClose, busy = false }) {
  const { t } = useTranslation('credit');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [eligibilityError, setEligibilityError] = useState('');
  const loadRequestRef = useRef(0);

  const downloadStatement = async () => {
    if (!account?.customerId || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}/statement.csv`, { params: { currencyCode: account.currencyCode }, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-customer-${account.customerId}-statement.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminUnableDownloadCustomerStatement')));
    } finally {
      setDownloading(false);
    }
  };

  const load = async () => {
    if (!account?.customerId) return;
    const requestId = beginCreditRequest(loadRequestRef);
    setLoading(true);
    setError('');
    setEligibilityError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}`, { params: { currencyCode: account.currencyCode } });
      let eligibleResponse = null;
      try {
        eligibleResponse = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}/eligible-partners`, { params: { currencyCode: account.currencyCode, limit: 50, offset: 0 } });
      } catch (eligibilityLoadError) {
        if (isCurrentCreditRequest(loadRequestRef, requestId)) setEligibilityError(safeCreditErrorMessage(eligibilityLoadError, t('adminUnableLoadEligibility')));
      }
      if (!isCurrentCreditRequest(loadRequestRef, requestId)) return;
      setDetail({
        ...(response.data || {}),
        eligiblePartners: eligibleResponse?.data?.partners || [],
        eligiblePartnerPagination: eligibleResponse?.data?.pagination || null,
      });
    } catch (err) {
      if (isCurrentCreditRequest(loadRequestRef, requestId)) setError(safeCreditErrorMessage(err, t('adminUnableLoadCustomerProfile')));
    } finally {
      if (isCurrentCreditRequest(loadRequestRef, requestId)) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!account?.customerId) return undefined;
    const requestId = beginCreditRequest(loadRequestRef);
    setDetail(null);
    setError('');
    setEligibilityError('');
    setLoading(true);
    const loadProfile = async () => {
      try {
        const response = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}`, { params: { currencyCode: account.currencyCode } });
        let eligibleResponse = null;
        try {
          eligibleResponse = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${account.customerId}/eligible-partners`, { params: { currencyCode: account.currencyCode, limit: 50, offset: 0 } });
        } catch (eligibilityLoadError) {
          if (mounted && isCurrentCreditRequest(loadRequestRef, requestId)) setEligibilityError(safeCreditErrorMessage(eligibilityLoadError, t('adminUnableLoadEligibility')));
        }
        if (mounted && isCurrentCreditRequest(loadRequestRef, requestId)) setDetail({ ...(response.data || {}), eligiblePartners: eligibleResponse?.data?.partners || [], eligiblePartnerPagination: eligibleResponse?.data?.pagination || null });
      } catch (err) {
        if (mounted && isCurrentCreditRequest(loadRequestRef, requestId)) setError(safeCreditErrorMessage(err, t('adminUnableLoadCustomerProfile')));
      } finally {
        if (mounted && isCurrentCreditRequest(loadRequestRef, requestId)) setLoading(false);
      }
    };
    loadProfile();
    return () => { mounted = false; invalidateCreditRequest(loadRequestRef); };
  }, [account?.customerId, account?.currencyCode]);

  const profile = detail?.account || account;
  const transactions = detail?.transactions || [];
  const holds = detail?.holds || [];
  const entitlements = detail?.entitlements || [];
  const auditEvents = detail?.auditEvents || [];
  const disputes = detail?.disputes || [];
  const riskLimits = detail?.riskLimits || null;
  const eligiblePartners = detail?.eligiblePartners || [];
  const eligiblePartnerPagination = detail?.eligiblePartnerPagination || null;

  return <section className="rounded-2xl border border-sky-500/25 bg-[#0e1622] p-4 shadow-lg shadow-sky-950/10 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">{t('adminCustomer360')}</p>
        <h2 className="mt-1 text-lg font-semibold text-white">{t('adminCreditProfileAccess')}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-400">{t('adminCustomerProfileDescription')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={downloadStatement} disabled={loading || downloading || busy || !account} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {downloading ? t('adminPreparingStatement') : t('adminDownloadStatement')}</button>
        <button type="button" onClick={load} disabled={loading || busy || !account} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {t('adminRefreshProfile')}</button>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800"><X className="h-3.5 w-3.5" /> {t('adminClose')}</button>
      </div>
    </div>

    {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs text-red-300">{error}</div>}
    {loading && !detail && <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-10 text-center text-sm text-gray-500">{t('adminLoadingCustomerProfile')}</div>}
    {!loading && !error && detail && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3 sm:col-span-2"><div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-orange-400" /><strong className="text-sm text-white">{profile.name || t('adminUnnamedCustomer')}</strong></div><p className="mt-1 text-xs text-gray-500">{profile.email || t('adminNoEmail')}</p><p className="mt-2 break-all font-mono text-[10px] text-gray-700">{profile.customerId}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminBalance')}</span><strong className="mt-2 block text-lg text-white">{money(profile.balanceCents, profile.currencyCode)}</strong></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminAvailable')}</span><strong className="mt-2 block text-lg text-emerald-300">{money(profile.availableBalanceCents, profile.currencyCode)}</strong></div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/45 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminWalletState')}</span><div className="mt-2"><Badge status={profile.status} /></div><p className="mt-2 text-[10px] text-gray-600">{t('adminLedgerVersion', { version: profile.ledgerVersion || 0, currency: profile.currencyCode })}</p></div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-gray-800 bg-gray-950/35 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">{t('adminSpendPermissions')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminRestaurantAssignments')}</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">{t('adminRecords', { count: entitlements.length })}</span></div>
          <div className="mt-3 space-y-2">{!entitlements.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">{t('adminNoCustomerAssignments')}</p> : entitlements.map((entitlement) => <div key={entitlement.id} className="rounded-lg border border-gray-800 bg-gray-950/55 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2"><Store className="h-4 w-4 text-sky-300" /><strong className="text-sm text-white">{entitlement.restaurantName || t('adminRestaurantFallback', { id: entitlement.restaurantId })}</strong></div><Badge status={entitlement.status} /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500"><span>{entitlement.currencyCode || 'USD'}</span><span>{t('adminAgreementVersion', { version: entitlement.agreementVersion || '?' })}</span>{entitlement.maxTransactionCents ? <span>{t('adminMaxAmount', { amount: money(entitlement.maxTransactionCents, entitlement.currencyCode) })}</span> : null}{entitlement.dailyLimitCents ? <span>{t('adminDailyAmount', { amount: money(entitlement.dailyLimitCents, entitlement.currencyCode) })}</span> : null}</div>{entitlement.reason && <p className="mt-2 text-[11px] leading-4 text-gray-600">{entitlement.reason}</p>}</div>)}</div>
          <div className="mt-5 border-t border-gray-800 pt-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">{t('adminEffectiveAccess')}</p><h4 className="mt-1 text-sm font-semibold text-white">{t('adminWhereCustomerCanSpend')}</h4></div><span className="rounded-full border border-emerald-500/25 px-2 py-1 text-[10px] font-semibold text-emerald-300">{eligibilityError ? '—' : t('adminRestaurants', { count: eligiblePartners.length, suffix: !eligibilityError && eligiblePartnerPagination?.hasMore ? '+' : '' })}</span></div><p className="mt-2 text-[11px] leading-5 text-gray-500">{t('adminEligibilityDescription')}</p>{eligibilityError && <div role="alert" aria-live="assertive" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs text-red-300"><span>{eligibilityError}</span><button type="button" onClick={load} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetry')}</button></div>}<div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">{!eligiblePartners.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">{eligibilityError ? t('adminEligibilityUnavailable') : t('adminNoSpendableRestaurants')}</p> : eligiblePartners.map((partner) => <div key={partner.partnerId} className="rounded-lg border border-emerald-500/15 bg-emerald-950/10 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><strong className="text-sm text-white">{partner.restaurantName || t('adminPartnerRestaurant')}</strong></div><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">{t('adminSpendableNow')}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500"><span>{[partner.city, partner.state].filter(Boolean).join(', ') || t('adminLocationNotListed')}</span><span>{partner.currencyCode || profile.currencyCode}</span>{partner.allowedOrderTypes?.length ? <span>{partner.allowedOrderTypes.join(', ')}</span> : null}{partner.maxTransactionCents ? <span>{t('adminMaxAmount', { amount: money(partner.maxTransactionCents, partner.currencyCode) })}</span> : null}{partner.dailyCustomerLimitCents ? <span>{t('adminDailyAmount', { amount: money(partner.dailyCustomerLimitCents, partner.currencyCode) })}</span> : null}</div></div>)}</div></div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/35 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">{t('adminReservedFunds')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminHoldsAuthorizations')}</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">{t('adminRecords', { count: holds.length })}</span></div>
          <div className="mt-3 space-y-2">{!holds.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">{t('adminNoHolds')}</p> : holds.map((hold) => <div key={hold.id} className="rounded-lg border border-gray-800 bg-gray-950/55 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-white">{hold.restaurantName || t('adminRestaurantAuthorization')}</strong><p className="mt-1 text-xs text-gray-500">{money(hold.amountCents, hold.currencyCode)} · {t('adminExpires', { date: dateTime(hold.expiresAt) })}</p></div><Badge status={hold.status} /></div>{hold.referenceId && <p className="mt-2 break-all font-mono text-[10px] text-gray-700">{t('adminReference')}: {hold.referenceId}</p>}{hold.captureReason && <p className="mt-2 text-[11px] leading-4 text-sky-200">{t('adminCapturedBy', { actor: hold.captureActorType || t('adminOperator') })}: {hold.captureReason}</p>}{hold.releaseReason && <p className="mt-2 text-[11px] leading-4 text-gray-400">{t('adminReleasedBy', { actor: hold.releaseActorType || t('adminOperator') })}: {hold.releaseReason}</p>}</div>)}</div>
        </div>
      </div>

      {riskLimits && <div className="mt-5 rounded-xl border border-violet-500/20 bg-violet-950/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">{t('adminRiskGuardrails')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminTodaysCreditUsage')}</h3><p className="mt-1 text-[11px] leading-5 text-gray-500">{t('adminReadOnlyUsageDescription', { date: dateTime(riskLimits.resetsAt) })}</p></div>
          <span className="rounded-full border border-violet-500/25 px-2 py-1 text-[10px] font-semibold text-violet-300">{riskLimits.currencyCode || profile.currencyCode}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{t('adminSpendAmount')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.spending?.centsUsed, riskLimits.currencyCode)}</strong><p className="mt-1 text-[11px] text-gray-500">{t('adminRemainingAmount', { amount: money(riskLimits.spending?.centsRemaining, riskLimits.currencyCode) })}</p></div>
          <div className="rounded-lg border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{t('adminSpendMovements')}</span><strong className="mt-2 block text-lg text-white">{riskLimits.spending?.countUsed || 0} / {riskLimits.spending?.countLimit || 0}</strong><p className="mt-1 text-[11px] text-gray-500">{t('adminRemainingToday', { count: riskLimits.spending?.countRemaining || 0 })}</p></div>
          <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">{t('adminTransferAmount')}</span><strong className="mt-2 block text-lg text-white">{riskLimits.transfers?.enabled ? money(riskLimits.transfers?.centsUsed, riskLimits.currencyCode) : t('adminDisabled')}</strong><p className="mt-1 text-[11px] text-gray-500">{riskLimits.transfers?.enabled ? t('adminRemainingAmount', { amount: money(riskLimits.transfers?.centsRemaining, riskLimits.currencyCode) }) : t('adminCustomerTransfersDisabled')}</p></div>
          <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">{t('adminTransferMovements')}</span><strong className="mt-2 block text-lg text-white">{riskLimits.transfers?.enabled ? `${riskLimits.transfers?.countUsed || 0} / ${riskLimits.transfers?.countLimit || 0}` : t('adminDisabled')}</strong><p className="mt-1 text-[11px] text-gray-500">{riskLimits.transfers?.enabled ? t('adminRemainingToday', { count: riskLimits.transfers?.countRemaining || 0 }) : t('adminNoOutboundTransfers')}</p></div>
        </div>
      </div>}

      <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">{t('adminCustomerReviews')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminCreditDisputes')}</h3></div><span className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500"><AlertTriangle className="h-3 w-3 text-amber-300" /> {t('adminRecords', { count: disputes.length })}</span></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{!disputes.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600 md:col-span-2">{t('adminNoCustomerDisputes')}</p> : disputes.map((dispute) => <div key={dispute.id} className="rounded-lg border border-gray-800 bg-gray-950/55 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-sm text-white">{dispute.restaurantName || t('adminOxsteedCreditTransaction')}</strong><Badge status={dispute.status} /></div><p className="mt-2 text-[11px] font-semibold capitalize text-amber-200">{String(dispute.reasonCode || 'other').replace(/_/g, ' ')}</p>{dispute.amountCents !== null && dispute.amountCents !== undefined && <p className="mt-1 text-[11px] text-gray-500">{money(dispute.amountCents, dispute.currencyCode || profile.currencyCode)} · {String(dispute.transactionType || 'transaction').replace(/_/g, ' ')}</p>}<p className="mt-1 text-[11px] leading-4 text-gray-400">{dispute.description}</p><p className="mt-2 break-all font-mono text-[10px] text-gray-700">{t('adminTransactionReference', { id: dispute.transactionId, date: dateTime(dispute.openedAt) })}</p>{dispute.resolution && <p className="mt-2 text-[11px] leading-4 text-emerald-300">{t('adminResolution')}: {dispute.resolution}</p>}</div>)}</div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/35 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">{t('adminLedgerActivity')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminRecentWalletTransactions')}</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">{t('adminLatest', { count: transactions.length })}</span></div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-800"><table className="min-w-[920px] w-full text-left text-xs"><thead className="bg-gray-950/75 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminWhen')}</th><th className="px-3 py-3 font-medium">{t('adminActivity')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminStatus')}</th><th className="px-3 py-3 font-medium">{t('adminAmountLabel')}</th><th className="px-3 py-3 font-medium">{t('adminReference')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!transactions.length ? <tr><td colSpan="6" className="px-3 py-8 text-center text-gray-600">{t('adminNoLedgerActivity')}</td></tr> : transactions.map((transaction) => { const debit = transaction.direction === 'debit'; return <tr key={transaction.id}><td className="px-3 py-3 text-gray-500">{dateTime(transaction.postedAt || transaction.createdAt)}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 text-white">{debit ? <ArrowUpRight className="h-3.5 w-3.5 text-amber-300" /> : <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-300" />}{transactionLabel(transaction, t)}</span><p className="mt-1 text-gray-600">{transaction.description || transaction.actorType || t('adminLedgerEntry')}</p>{transaction.reason && <p className="mt-1 max-w-[260px] text-[11px] leading-4 text-amber-200/80">{t('adminReason')}: {transaction.reason}</p>}</td><td className="px-3 py-3 text-gray-400">{transaction.restaurantName || t('adminOxsteedCredit')}</td><td className="px-3 py-3"><Badge status={transaction.status} /></td><td className={`px-3 py-3 font-semibold ${debit ? 'text-amber-300' : 'text-emerald-300'}`}>{debit ? '-' : '+'}{money(transaction.amountCents, transaction.currencyCode)}</td><td className="max-w-[220px] break-all px-3 py-3 font-mono text-[10px] text-gray-600">{transaction.orderId ? t('adminFoodOrder', { id: transaction.orderId }) : transaction.referenceId || transaction.id}</td></tr>; })}</tbody></table></div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/35 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">{t('adminControlHistory')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminCustomerCreditAuditEvents')}</h3></div><span className="rounded-full border border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500">{t('adminLatest', { count: auditEvents.length })}</span></div>
        <div className="mt-3 space-y-2">{!auditEvents.length ? <p className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-xs text-gray-600">{t('adminNoCustomerControls')}</p> : auditEvents.slice(0, 20).map((event) => <div key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/55 px-3 py-3"><div><strong className="font-mono text-[11px] text-orange-300">{event.actionType}</strong><p className="mt-1 text-xs text-gray-400">{event.reason || t('adminNoReasonRecorded')}</p><p className="mt-1 text-[10px] text-gray-700">{event.resourceType} · {event.resourceId} · {event.actorUserId || t('adminSystem')}</p></div><span className="text-[10px] text-gray-600">{dateTime(event.createdAt)}</span></div>)}</div>
      </div>
    </>}
  </section>;
}
