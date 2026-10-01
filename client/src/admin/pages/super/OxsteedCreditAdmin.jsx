import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CreditCard,
  Download,
  FileCheck2,
  History,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Store,
  WalletCards,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import i18n from '../../../i18n';
import { DEFAULT_CREDIT_CURRENCIES, formatCreditMinorUnits, parseCreditMajorAmount, parseOptionalCreditMajorAmount } from '../../../lib/creditCurrency';
import OxsteedCreditEntitlements from './OxsteedCreditEntitlements';
import OxsteedCreditCards from './OxsteedCreditCards';
import OxsteedCreditMoneyOut from './OxsteedCreditMoneyOut';
import OxsteedCreditCustomerDetail from './OxsteedCreditCustomerDetail';
import OxsteedCreditPartnerLedger from './OxsteedCreditPartnerLedger';
import { createStableIdempotencyKeyStore } from './creditIdempotency';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { localizeCreditOrderTypes, localizeCreditStatus } from '../../../lib/creditStatus';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';

const DEFAULT_CURRENCY_OPTIONS = DEFAULT_CREDIT_CURRENCIES;
const CUSTOMER_ACCOUNT_PAGE_SIZE = 50;
const PARTNER_DIRECTORY_PAGE_SIZE = 50;
const CREDIT_WORKER_NAMES = [
  'oxsteed-credit-notification-outbox',
  'oxsteed-credit-hold-expiry',
  'oxsteed-credit-entitlement-expiry',
  'oxsteed-credit-reconciliation',
  'oxsteed-credit-settlement-cycle',
  'oxsteed-credit-integrity',
  'oxsteed-credit-compliance-monitor',
  'restaurant-credit-wallet-watchdog',
];

const money = formatCreditMinorUnits;
const dollarsToCents = parseCreditMajorAmount;

const CREDIT_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useCreditDialogFocusTrap(dialogRef, open, onEscape) {
  const restoreFocusRef = useRef(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const getFocusable = () => [...dialog.querySelectorAll(CREDIT_FOCUSABLE_SELECTOR)]
      .filter((element) => element.getClientRects().length > 0);
    const focusable = getFocusable();
    (focusable[0] || dialog).focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const currentFocusable = getFocusable();
      if (!currentFocusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [dialogRef, open]);
}

function dateTime(value) {
  const language = typeof document !== 'undefined' && document.documentElement?.lang;
  const fallbackKey = value ? 'adminUnknownDate' : 'adminNoActivity';
  const fallback = i18n.t(`credit:${fallbackKey}`, { defaultValue: value ? 'Unknown date' : 'No activity' });
  return formatCreditDateTime(value, fallback, language);
}

function statusClass(status) {
  if (status === 'enabled') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'balanced') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'pending' || status === 'pending_approval') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'running') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'difference' || status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'suspended') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'terminated' || status === 'expired' || status === 'revoked') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  const { t } = useTranslation('credit');
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{localizeCreditStatus(status, t)}</span>;
}

function IntegritySummary({ integrity }) {
  const { t } = useTranslation('credit');
  if (!integrity || typeof integrity !== 'object') return null;
  const failures = Object.entries(integrity).filter(([, value]) => Number(value) > 0);
  if (failures.length) {
    return <p className="mt-2 inline-flex items-center gap-1.5 font-semibold text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {t('adminHashIntegrityFailed', { details: failures.map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${value}`).join(', ') })}</p>;
  }
  return <p className="mt-2 inline-flex items-center gap-1.5 font-semibold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> {t('adminHashIntegrityVerified')}</p>;
}

function Metric({ icon: Icon, label, value, detail, tone = 'text-white' }) {
  return <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">{label}</span><Icon className="h-4 w-4 text-orange-400" /></div><strong className={`mt-3 block text-2xl font-semibold ${tone}`}>{value}</strong><span className="mt-1 block text-xs text-gray-600">{detail}</span></div>;
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function buildGeography(form) {
  const fields = [
    ['cities', form.coverageCities],
    ['states', form.coverageStates],
    ['postalCodes', form.coveragePostalCodes],
    ['countries', form.coverageCountries],
  ];
  return fields.reduce((result, [key, value]) => {
    const values = splitList(value);
    if (values.length) result[key] = values;
    return result;
  }, {});
}

function geographyLabel(geography, t) {
  const labels = [
    ['cities', 'adminCities'],
    ['states', 'adminStatesRegions'],
    ['postalCodes', 'adminPostalCodes'],
    ['countries', 'adminCountries'],
  ].flatMap(([key, label]) => Array.isArray(geography?.[key]) && geography[key].length
    ? [`${t(label)}: ${geography[key].join(', ')}`]
    : []);
  return labels.join(' · ');
}

const TRANSACTION_TRANSLATION_KEYS = {
  load: 'transactionLoad',
  purchase: 'transactionPurchase',
  refund: 'transactionRefund',
  transfer: 'transactionTransfer',
  adjustment: 'transactionAdjustment',
  expiration: 'transactionExpiration',
  chargeback: 'transactionChargeback',
  fee: 'transactionFee',
  settlement: 'transactionSettlement',
  settlement_reversal: 'transactionSettlementReversal',
  funding: 'transactionFunding',
  reserve_release: 'transactionReserveRelease',
  cash_out: 'transactionCashOut',
  conversion_debit: 'transactionConversionDebit',
  conversion_fee: 'transactionConversionFee',
  conversion_credit: 'transactionConversionCredit',
};

const NOTIFICATION_TRANSLATION_KEYS = {
  transaction_posted: 'notificationTransactionPosted',
  hold_created: 'notificationHoldCreated',
  hold_captured: 'notificationHoldCaptured',
  hold_released: 'notificationHoldReleased',
  hold_expired: 'notificationHoldExpired',
};

function creditTransactionLabel(transaction, t) {
  const transactionType = String(transaction?.transactionType || '').toLowerCase();
  const translationKey = TRANSACTION_TRANSLATION_KEYS[transactionType] || 'transactionUnknown';
  return t(translationKey);
}

function creditNotificationLabel(notification, t) {
  const eventType = String(notification?.eventType || '').toLowerCase();
  return t(NOTIFICATION_TRANSLATION_KEYS[eventType] || 'notificationUnknown');
}

function transactionPartyLabel(transaction, t) {
  if (transaction?.debitCustomerId) return `${t('adminCustomer')} ${transaction.debitCustomerId}`;
  if (transaction?.creditCustomerId) return `${t('adminCustomer')} ${transaction.creditCustomerId}`;
  if (transaction?.partnerId) return `${t('adminPartner')} ${transaction.partnerId}`;
  return t('adminSystemMovement');
}

function disputeReasonLabel(value, t) {
  return {
    incorrect_amount: t('disputeIncorrectAmount'),
    unauthorized: t('disputeUnauthorized'),
    duplicate: t('disputeDuplicate'),
    restaurant_issue: t('disputeRestaurantIssue'),
    other: t('other'),
  }[value] || t('other');
}

const ADMIN_SECTION_TRANSLATIONS = {
  'Agreement lifecycle': {
    eyebrow: 'adminAgreementLifecycle',
    title: 'adminActivePendingTerms',
    detail: 'adminAgreementLifecycleDescription',
  },
  'Settlement & controls': {
    eyebrow: 'adminSettlementAndControls',
    title: 'adminPartnerPayablesReconciliation',
    detail: 'adminSettlementControlsDescription',
  },
  'Reconciliation history': {
    eyebrow: 'adminReconciliationHistory',
    title: 'adminLedgerCheckHistory',
    detail: 'adminReconciliationHistoryDescription',
  },
  'External reconciliation': {
    eyebrow: 'adminExternalReconciliationHistory',
    title: 'adminExternalReconciliationTitle',
    detail: 'adminExternalReconciliationDescription',
  },
  'Compliance queue': {
    eyebrow: 'adminComplianceQueue',
    title: 'adminComplianceQueueTitle',
    detail: 'adminComplianceQueueDescription',
  },
  Disputes: {
    eyebrow: 'adminCreditDisputes',
    title: 'adminCreditDisputeQueue',
    detail: 'adminDisputeQueueDescription',
  },
  'Pending actions': {
    eyebrow: 'adminMakerCheckerQueue',
    title: 'adminPendingActionQueue',
    detail: 'adminPendingActionQueueDescription',
  },
  'Audit history': {
    eyebrow: 'adminAuditHistory',
    title: 'adminCreditControlTrail',
    detail: 'adminAuditHistoryDescription',
  },
  'Payout recovery': {
    eyebrow: 'adminPayoutRecovery',
    title: 'adminReversePaidSettlement',
    detail: 'adminPayoutRecoveryDescription',
  },
      'Partner enrollment': {
        eyebrow: 'adminPartnerEnrollment',
        title: 'adminAddRestaurantPartner',
        detail: 'adminPartnerEnrollmentDescription',
      },
      'Agreement builder': {
        eyebrow: 'adminAgreementBuilder',
        title: 'adminCreateSpendingAgreement',
        detail: 'adminAgreementBuilderDescription',
      },
  'Partner network': {
    eyebrow: 'adminPartnerNetwork',
    title: 'adminRestaurantsAndAgreements',
    detail: 'adminPartnerNetworkDescription',
  },
  'Audit history controls': {
    eyebrow: 'adminAuditHistoryControls',
    title: 'adminSearchControlTrail',
    detail: 'adminSearchControlTrailDetail',
  },
  'Coverage watch': {
    eyebrow: 'adminCoverageWatch',
    title: 'adminPartnerAgreementHealth',
    detail: 'adminPartnerAgreementHealthDetail',
  },
  'Delivery watch': {
    eyebrow: 'adminDeliveryWatch',
    title: 'adminCreditCustomerNotifications',
    detail: 'adminCreditCustomerNotificationsDetail',
  },
  'Ledger activity': {
    eyebrow: 'adminLedgerActivity',
    title: 'adminCreditTransactionHistory',
    detail: 'adminCreditTransactionHistoryDetail',
  },
  'Risk guardrails': {
    eyebrow: 'adminRiskGuardrails',
    title: 'adminFundingSpendingTransferLimits',
    detail: 'adminFundingSpendingTransferLimitsDetail',
  },
};

function Section({ eyebrow, title, detail, children, action }) {
  const { t } = useTranslation('credit');
  const translation = ADMIN_SECTION_TRANSLATIONS[eyebrow];
  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{translation ? t(translation.eyebrow, { defaultValue: eyebrow }) : eyebrow}</p><h2 className="mt-1 text-lg font-semibold text-white">{translation ? t(translation.title, { defaultValue: title }) : title}</h2>{detail && <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{translation ? t(translation.detail, { defaultValue: detail }) : detail}</p>}</div>{action}</div>{children}</section>;
}

function SettlementControls({
  selectablePartners,
  settlementForm,
  setSettlementForm,
  loadSettlementAgreements,
  loadingSettlementAgreements,
  settlementAgreements,
  settlementAgreementOptionsError,
  busy,
  createSettlement,
  reconciliationReason,
  setReconciliationReason,
  runReconciliation,
  reconciliation,
  settlements,
  transitionSettlement,
}) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Settlement & controls" title="Partner payables and reconciliation" detail="Create a period snapshot, approve it only after review, and mark it paid only with a traceable external payment reference. The reconciliation compares every account balance to its immutable journal entries; its integrity scope is always the all-time ledger for the selected currency.">
    <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <form onSubmit={createSettlement} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSettlementPartner')}</span>
          <select required value={settlementForm.partnerId} onChange={(event) => { const nextPartner = selectablePartners.find((partner) => String(partner.partnerId) === event.target.value); setSettlementForm({ ...settlementForm, partnerId: event.target.value, agreementId: '', currencyCode: nextPartner?.settlementCurrencyCode || 'USD' }); loadSettlementAgreements(event.target.value); }} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">{t('adminSelectPartner')}</option>
            {selectablePartners.filter((partner) => partner.status === 'active').map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminRestaurantFallback', { id: partner.restaurantId })} · {partner.settlementCurrencyCode || 'USD'}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSettlementAgreement')}</span>
          <select required value={settlementForm.agreementId} onChange={(event) => setSettlementForm({ ...settlementForm, agreementId: event.target.value })} disabled={loadingSettlementAgreements || !settlementForm.partnerId} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">{loadingSettlementAgreements ? t('adminLoadingAgreements') : t('adminSelectAgreement')}</option>
            {settlementAgreements.map((agreement) => <option key={agreement.id} value={agreement.id}>v{agreement.version} · {localizeCreditStatus(agreement.status, t)}</option>)}
          </select>
          {settlementAgreementOptionsError && <p className="mt-2 text-xs font-semibold text-red-300">{settlementAgreementOptionsError}</p>}
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrency')}</span>
          <input value={settlementForm.currencyCode} readOnly className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-3 text-sm font-semibold text-sky-300 outline-none" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPeriodStarts')}</span>
          <input required type="datetime-local" value={settlementForm.periodStart} onChange={(event) => setSettlementForm({ ...settlementForm, periodStart: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPeriodEnds')}</span>
          <input required type="datetime-local" value={settlementForm.periodEnd} onChange={(event) => setSettlementForm({ ...settlementForm, periodEnd: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPaymentReferenceOptional')}</span>
          <input value={settlementForm.paymentReference} onChange={(event) => setSettlementForm({ ...settlementForm, paymentReference: event.target.value })} placeholder={t('adminPaymentReferencePlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReasonForSnapshot')}</span>
          <input required maxLength={1000} value={settlementForm.reason} onChange={(event) => setSettlementForm({ ...settlementForm, reason: event.target.value })} placeholder={t('adminReasonForSnapshotPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
        </label>
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> {t('adminCreateSnapshot')}</button>
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReasonForReconciliation')}</span>
            <input maxLength={1000} value={reconciliationReason} onChange={(event) => setReconciliationReason(event.target.value)} placeholder={t('adminReasonForReconciliationPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
          </label>
          <button type="button" disabled={busy} onClick={runReconciliation} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> {t('adminReconcileLedger')}</button>
        </div>
        {reconciliation && <div className={`rounded-xl border px-3 py-3 text-xs sm:col-span-2 ${reconciliation.status === 'balanced' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' : 'border-red-500/30 bg-red-950/20 text-red-300'}`}>
          {t('adminLastRun')}: <strong>{localizeCreditStatus(reconciliation.status, t)}</strong> · {t('adminDifference')}: {money(reconciliation.differenceCents, reconciliation.currencyCode || settlementForm.currencyCode)} · {reconciliation.entryCount} {t('adminJournalEntries')} · {t('adminIntegrityScope')}: {reconciliation.scope === 'all_time_ledger' ? t('adminAllTimeLedger') : t('adminUnknown')}
          <IntegritySummary integrity={reconciliation.integrity} />
        </div>}
      </form>
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="min-w-[1080px] w-full text-left text-xs">
          <thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminSettlementPeriod')}</th><th className="px-3 py-3 font-medium">{t('adminCycle')}</th><th className="px-3 py-3 font-medium">{t('adminValueDate')}</th><th className="px-3 py-3 font-medium">{t('adminNetPayable')}</th><th className="px-3 py-3 font-medium">{t('adminSettlementStatusProvenance')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead>
          <tbody className="divide-y divide-gray-800">
            {!settlements.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminNoSettlementSnapshots')}</td></tr> : settlements.map((settlement) => <tr key={settlement.id}>
              <td className="px-3 py-3 text-white">{settlement.restaurantName || t('adminPartnerFallback', { id: settlement.partnerId })}<p className="mt-1 text-gray-600">{t('adminGrossAmount')} {money(settlement.grossCents, settlement.currencyCode)} · {t('adminRefunds')} {money(settlement.refundCents, settlement.currencyCode)}</p></td>
              <td className="px-3 py-3 text-gray-400">{dateTime(settlement.periodStart)}<br />{t('adminTo')} {dateTime(settlement.periodEnd)}</td>
              <td className="px-3 py-3 text-gray-400">{settlement.cycleId ? <span title={settlement.cycleId}>{String(settlement.cycleId).slice(0, 8)}</span> : t('adminCycleManual')}</td>
              <td className="px-3 py-3 text-gray-400">{settlement.valueDate ? dateTime(settlement.valueDate) : t('adminUnknownDate')}</td>
              <td className="px-3 py-3 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</td>
              <td className="px-3 py-3"><Badge status={settlement.status} /><p className="mt-1 break-all text-[10px] text-gray-600">{t('adminPayoutStatus')}: {localizeCreditStatus(settlement.payoutStatus || 'none', t)}</p><p className="mt-1 break-all text-[10px] text-gray-600">{t('adminCreatedBy')} {settlement.createdBy || t('adminSystem')}</p>{settlement.approvedBy && <p className="mt-1 break-all text-[10px] text-sky-300">{t('adminApprovedBy')} {settlement.approvedBy}</p>}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap gap-2">{settlement.status === 'pending' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'approved')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminApprove')}</button>}{settlement.status === 'approved' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'paid')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminMarkPaid')}</button>}{['pending', 'approved'].includes(settlement.status) && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'voided')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminVoid')}</button>}</div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </Section>;
}

function ReconciliationHistory({
  reconciliationRuns,
  reconciliationStatus,
  setReconciliationStatus,
  reconciliationCurrency,
  setReconciliationCurrency,
  currencyOptions,
  reconciliationPagination,
  loadingMoreReconciliationRuns,
  loading,
  busy,
  downloadReconciliationHistory,
  load,
}) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Reconciliation history" title="Ledger check history" detail="Every check is preserved as a separate operational record. Use the difference and entry counts to decide whether a settlement is safe to approve; no reconciliation action changes balances." action={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={downloadReconciliationHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminStatus')}</span><select aria-label={t('adminReconciliationStatusFilter')} value={reconciliationStatus} onChange={(event) => setReconciliationStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="balanced">{t('statusBalanced')}</option><option value="difference">{t('statusDifference')}</option><option value="failed">{t('statusFailed')}</option></select></label><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminCurrency')}</span><select aria-label={t('adminReconciliationCurrencyFilter')} value={reconciliationCurrency} onChange={(event) => setReconciliationCurrency(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">{t('adminAllCurrencies')}</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>{reconciliationPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendReconciliationRuns: true, reconciliationOffset: reconciliationPagination.nextOffset || 0 })} disabled={loadingMoreReconciliationRuns || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreReconciliationRuns ? t('adminLoading') : t('adminLoadOlder')}</button>}</div>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRun')}</th><th className="px-3 py-3 font-medium">{t('adminRequestedPeriod')}</th><th className="px-3 py-3 font-medium">{t('adminResult')}</th><th className="px-3 py-3 font-medium">{t('adminBalances')}</th><th className="px-3 py-3 font-medium">{t('adminScope')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!reconciliationRuns.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminNoReconciliationRuns')}</td></tr> : reconciliationRuns.map((run) => <tr key={run.id}><td className="px-3 py-3 text-gray-400">{dateTime(run.startedAt)}<p className="mt-1 font-mono text-[10px] text-gray-700">{run.id}</p></td><td className="px-3 py-3 text-gray-400">{dateTime(run.periodStart)}<br />{t('adminTo')} {dateTime(run.periodEnd)}</td><td className="px-3 py-3"><Badge status={run.status} /><p className="mt-1 text-gray-600">{run.currencyCode} · {run.accountCount} {t('adminAccounts')} · {run.entryCount} {t('adminEntries')}</p><IntegritySummary integrity={run.metadata?.hashIntegrity} /></td><td className="px-3 py-3 text-gray-400">{t('adminAccounts')} {money(run.accountBalanceCents, run.currencyCode)}<br />{t('adminJournal')} {money(run.journalBalanceCents, run.currencyCode)}<br /><strong className={run.differenceCents === 0 ? 'text-emerald-300' : 'text-red-300'}>{t('adminDifference')} {money(run.differenceCents, run.currencyCode)}</strong></td><td className="px-3 py-3 text-gray-500">{run.metadata?.scope === 'all_time_ledger' ? t('adminAllTimeLedger') : t('adminRecordedScopeUnavailable')}</td></tr>)}</tbody></table></div>
  </Section>;
}

function ExternalReconciliationHistory({
  externalReconRuns,
  externalReconStatus,
  setExternalReconStatus,
  externalReconCurrency,
  setExternalReconCurrency,
  currencyOptions,
  externalReconPagination,
  loadingMoreExternalReconRuns,
  loading,
  busy,
  load,
  externalReconReason,
  setExternalReconReason,
  triggerExternalReconciliation,
}) {
  const { t } = useTranslation('credit');
  const findingCount = (run) => Number(run?.metadata?.findings?.length || 0);
  return <Section eyebrow="External reconciliation" title="Stripe check history" detail="Each run compares the journal against Stripe top-ups, partner payouts, and partner commitments for the selected currency and period. A material finding freezes the Credit rail automatically; unfreeze it from the rail section only after the finding is resolved." action={<div className="flex flex-wrap items-center gap-2"><form onSubmit={triggerExternalReconciliation} className="flex flex-wrap items-center gap-2"><input aria-label={t('adminRequiredAuditReason')} value={externalReconReason} onChange={(event) => setExternalReconReason(event.target.value)} maxLength={1000} placeholder={t('adminReasonForReconciliationPlaceholder')} className="w-56 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-orange-400" /><button type="submit" disabled={loading || busy || !externalReconReason.trim()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><History className="h-3.5 w-3.5" /> {t('adminTriggerExternalReconciliation')}</button></form><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminStatus')}</span><select aria-label={t('adminStatus')} value={externalReconStatus} onChange={(event) => setExternalReconStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="completed">completed</option><option value="completed_with_findings">completed_with_findings</option><option value="running">running</option><option value="failed">failed</option></select></label><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminCurrency')}</span><select aria-label={t('adminCurrency')} value={externalReconCurrency} onChange={(event) => setExternalReconCurrency(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">{t('adminAllCurrencies')}</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>{externalReconPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendExternalReconRuns: true, externalReconOffset: externalReconPagination.nextOffset || 0 })} disabled={loadingMoreExternalReconRuns || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreExternalReconRuns ? t('adminLoading') : t('adminLoadOlder')}</button>}</div>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRun')}</th><th className="px-3 py-3 font-medium">{t('adminRequestedPeriod')}</th><th className="px-3 py-3 font-medium">{t('adminResult')}</th><th className="px-3 py-3 font-medium">{t('adminTopups')}</th><th className="px-3 py-3 font-medium">{t('adminPayouts')}</th><th className="px-3 py-3 font-medium">{t('adminPartners')}</th><th className="px-3 py-3 font-medium">{t('adminRailFreeze')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!externalReconRuns.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminNoExternalReconciliationRuns')}</td></tr> : externalReconRuns.map((run) => <tr key={run.id}><td className="px-3 py-3 text-gray-400">{dateTime(run.startedAt)}<p className="mt-1 font-mono text-[10px] text-gray-700">{run.id}</p></td><td className="px-3 py-3 text-gray-400">{dateTime(run.periodStart)}<br />{t('adminTo')} {dateTime(run.periodEnd)}<p className="mt-1 text-gray-600">{run.currencyCode}</p></td><td className="px-3 py-3"><Badge status={run.status} />{findingCount(run) > 0 && <p className={`mt-1 font-semibold ${run.material ? 'text-red-300' : 'text-amber-300'}`}>{findingCount(run)} {t('adminFindings')}{run.material ? ` · ${t('adminMaterial')}` : ''}</p>}{run.errorMessage && <p className="mt-1 break-all text-red-400">{run.errorMessage}</p>}</td><td className="px-3 py-3 text-gray-400">{t('statusMatched')} {run.topupsMatched} / {run.topupsChecked}<p className="mt-1 text-gray-600">{t('adminMissingInStripe')}: {run.topupsMissingInStripe} · {t('adminMissingInLedger')}: {run.topupsMissingInLedger}</p></td><td className="px-3 py-3 text-gray-400">{t('statusMatched')} {run.payoutsMatched} / {run.payoutsChecked}<p className="mt-1 text-gray-600">{t('adminMissingInStripe')}: {run.payoutsMissingInStripe} · {t('statusReversed')}: {run.payoutsReversedInStripe}</p></td><td className="px-3 py-3 text-gray-400">{t('statusMismatch')} {run.partnerMismatches} / {run.partnerChecks}</td><td className="px-3 py-3">{run.freezeEngaged ? <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300"><Snowflake className="h-3 w-3" /> {t('adminRailFrozenBanner')}</span> : <span className="text-gray-600">-</span>}</td></tr>)}</tbody></table></div>
  </Section>;
}

function CreditDisputeQueue({
  disputes,
  disputeStatus,
  setDisputeStatus,
  disputePagination,
  loadingMoreDisputes,
  loading,
  busy,
  downloadDisputeHistory,
  load,
  disputeResolutionDrafts,
  setDisputeResolutionDrafts,
  disputeCompensationDrafts,
  setDisputeCompensationDrafts,
  inspectDisputeCustomer,
  resolveDispute,
}) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Disputes" title="Credit dispute queue" detail="Disputes preserve the original journal transaction. Filter by lifecycle state and load older cases from the server; resolve with a documented outcome and use a separate compensating refund or adjustment rather than editing history." action={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={downloadDisputeHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>{t('adminStatus')}</span><select aria-label={t('adminDisputeStatusFilter')} value={disputeStatus} onChange={(event) => setDisputeStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="open">{t('openStatus')}</option><option value="in_review">{t('underReviewStatus')}</option><option value="resolved_customer">{t('adminDisputeResolvedCustomer')}</option><option value="resolved_merchant">{t('adminDisputeResolvedMerchant')}</option><option value="resolved">{t('resolvedStatus')}</option><option value="rejected">{t('rejectedStatus')}</option></select></label>{disputePagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendDisputes: true, disputeOffset: disputePagination.nextOffset || 0 })} disabled={loadingMoreDisputes || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreDisputes ? t('adminLoading') : t('adminLoadOlder')}</button>}</div>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomerRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminTransaction')}</th><th className="px-3 py-3 font-medium">{t('adminReason')}</th><th className="px-3 py-3 font-medium">{t('adminDescription')}</th><th className="px-3 py-3 font-medium">{t('adminOpened')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!disputes.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{t('adminNoDisputesForStatus')}</td></tr> : disputes.map((dispute) => <tr key={dispute.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{dispute.customerId}</span><p className="mt-1 text-gray-600">{dispute.restaurantName || t('adminCredit')}</p><button type="button" disabled={busy} onClick={() => inspectDisputeCustomer(dispute)} className="mt-2 rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{t('adminOpenCustomer360')}</button></td><td className="px-3 py-3 text-gray-400">{dispute.amountCents !== null && dispute.amountCents !== undefined ? <strong className="block text-emerald-300">{money(dispute.amountCents, dispute.currencyCode || 'USD')}</strong> : <strong className="block text-gray-600">{t('adminAmountUnavailable')}</strong>}<span className="mt-1 block font-mono text-[10px] text-gray-600">{creditTransactionLabel({ transactionType: dispute.transactionType }, t)} · {dispute.transactionId}</span>{dispute.referenceId && <span className="mt-1 block break-all font-mono text-[10px] text-gray-700">{t('adminReference')} {dispute.referenceId}</span>}</td><td className="px-3 py-3"><Badge status={dispute.status} /><p className="mt-1 text-gray-500">{disputeReasonLabel(dispute.reasonCode, t)}</p></td><td className="max-w-[280px] px-3 py-3 text-gray-400">{dispute.description}<textarea aria-label={t('adminResolution')} value={disputeResolutionDrafts[dispute.id] || ''} onChange={(event) => setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))} maxLength={4000} rows={2} placeholder={t('adminResolutionNotePlaceholder')} className="mt-3 w-full min-w-[220px] resize-y rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-400" /><label className="mt-2 block"><span className="mb-1 block text-[10px] font-semibold text-gray-600">{t('adminDisputeCompensationLabel')}</span><input inputMode="numeric" value={disputeCompensationDrafts[dispute.id] || ''} onChange={(event) => setDisputeCompensationDrafts((current) => ({ ...current, [dispute.id]: event.target.value.replace(/[^\d]/g, '').slice(0, 10) }))} placeholder={t('adminDisputeCompensationPlaceholder')} className="w-full min-w-[140px] rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 font-mono text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /></label></td><td className="px-3 py-3 text-gray-500">{dateTime(dispute.openedAt)}{dispute.postedAt && <p className="mt-1 text-gray-600">{t('adminPosted')} {dateTime(dispute.postedAt)}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => resolveDispute(dispute, 'in_review')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminReview')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved_customer')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminDisputeResolveCustomer')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved_merchant')} className="rounded-lg bg-teal-600 px-2.5 py-2 font-semibold text-white hover:bg-teal-500 disabled:opacity-50">{t('adminDisputeResolveMerchant')}</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'rejected')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div></td></tr>)}</tbody></table></div>
  </Section>;
}

function CreditAuditHistory({ auditEvents, loading, busy, downloadAuditHistory }) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Audit history" title="OxSteed Credit control trail" detail="Every rail, partner, agreement, entitlement, account, dispute, and ledger action is append-only. Use this view to reconstruct why a customer or restaurant state changed." action={<button type="button" onClick={downloadAuditHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminWhen')}</th><th className="px-3 py-3 font-medium">{t('adminAction')}</th><th className="px-3 py-3 font-medium">{t('adminResource')}</th><th className="px-3 py-3 font-medium">{t('adminActorCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminReason')}</th><th className="px-3 py-3 font-medium">{t('adminIntegrity')}</th><th className="px-3 py-3 font-medium">{t('adminChanges')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!auditEvents.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminNoCreditAuditEvents')}</td></tr> : auditEvents.map((event) => <tr key={event.id}><td className="px-3 py-3 text-gray-500">{dateTime(event.createdAt)}</td><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{event.actionType}</span></td><td className="px-3 py-3 text-gray-400">{event.resourceType}<p className="mt-1 font-mono text-[10px] text-gray-600">{event.resourceId}</p></td><td className="px-3 py-3 text-gray-400">{event.actorUserId || t('adminSystem')}{event.customerId && <p className="mt-1 font-mono text-[10px] text-gray-600">{t('adminCustomer')} {event.customerId}</p>}{event.correlationId && <p className="mt-1 break-all font-mono text-[10px] text-gray-600">{t('adminRequest')} {event.correlationId}</p>}</td><td className="max-w-[280px] px-3 py-3 text-gray-400">{event.reason || t('adminNoReasonRecorded')}</td><td className="px-3 py-3 text-gray-500">{event.eventHash ? <details><summary className="cursor-pointer text-emerald-300">{t('adminChainEvidence')}</summary><p className="mt-2 break-all font-mono text-[10px] text-gray-600">{t('adminEventHash')} {event.eventHash}</p><p className="mt-1 break-all font-mono text-[10px] text-gray-700">{t('adminPreviousEvent')} {event.previousEventHash || t('adminGenesis')}</p></details> : <span className="text-gray-700">{t('adminLegacyEvent')}</span>}</td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[360px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify({ before: event.beforeState, after: event.afterState }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
  </Section>;
}

function CreditPayoutRecovery({ settlements, busy, reverseSettlement }) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Payout recovery" title="Reverse a paid settlement" detail="Use this only when the external payout failed or was returned. The operation requires recovery evidence and creates a compensating ledger entry; it never edits the original payment transaction."><div className="grid gap-3 md:grid-cols-2">{settlements.filter((settlement) => settlement.status === 'paid' && Number(settlement.netCents || 0) > 0).slice(0, 6).map((settlement) => <article key={`reversal-${settlement.id}`} className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{settlement.restaurantName || t('adminPartnerFallback', { id: settlement.partnerId })}</h3><p className="mt-1 text-xs text-gray-500">{money(settlement.netCents, settlement.currencyCode)} · {settlement.paymentReference || t('adminNoPaymentReference')}</p></div><button type="button" disabled={busy} onClick={() => reverseSettlement(settlement)} className="rounded-lg border border-amber-500/40 px-2.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminReversePayout')}</button></div></article>)}</div></Section>;
}

function ComplianceQueue({ queue, busy, decideCompliance }) {
  const { t } = useTranslation('credit');
  const verifications = queue?.verifications || [];
  const sanctions = queue?.sanctions || [];
  const cases = queue?.cases || [];
  const counts = queue?.counts || {};
  return <Section eyebrow="Compliance queue" title="Identity, sanctions, and monitoring cases" detail="Pending identity verifications, uncleared sanctions hits, and open transaction-monitoring cases with SLA state. Every decision records the admin, the reason, and an audit event.">
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminCompliancePendingVerifications')}</p><strong className="mt-1 block text-lg text-amber-300">{Number(counts.pendingVerifications || 0)}</strong></div>
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminCompliancePendingSanctions')}</p><strong className="mt-1 block text-lg text-red-300">{Number(counts.pendingSanctions || 0)}</strong></div>
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminComplianceOpenCases')}</p><strong className="mt-1 block text-lg text-sky-300">{Number(counts.openCases || 0)}</strong></div>
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminComplianceSlaBreached')}</p><strong className={`mt-1 block text-lg ${Number(counts.slaBreachedCases || 0) > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{Number(counts.slaBreachedCases || 0)}</strong></div>
    </div>
    <h3 className="mt-6 text-sm font-semibold text-white">{t('adminComplianceVerifications')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceRequestedTier')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceProvider')}</th><th className="px-3 py-3 font-medium">{t('adminOpened')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!verifications.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoVerifications')}</td></tr> : verifications.map((verification) => <tr key={verification.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{verification.customerId}</span>{verification.customerEmail && <p className="mt-1 text-gray-500">{verification.customerEmail}</p>}</td><td className="px-3 py-3 text-gray-400">{t('adminComplianceTier', { tier: verification.requestedTier })}</td><td className="px-3 py-3 text-gray-500">{verification.provider}</td><td className="px-3 py-3 text-gray-500">{dateTime(verification.createdAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('verification', verification, 'approve')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApprove')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('verification', verification, 'reject')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div></td></tr>)}</tbody></table></div>
    <h3 className="mt-6 text-sm font-semibold text-white">{t('adminComplianceSanctions')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminComplianceSubject')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceHitContext')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceScreenedAt')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!sanctions.length ? <tr><td colSpan="4" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoSanctions')}</td></tr> : sanctions.map((hit) => <tr key={hit.id}><td className="px-3 py-3 text-white"><Badge status={hit.subjectType} /><span className="ml-2 font-mono text-[11px]">{hit.subjectId}</span>{hit.subjectEmail && <p className="mt-1 text-gray-500">{hit.subjectEmail}</p>}</td><td className="px-3 py-3 text-amber-300">{hit.hitContext || t('adminComplianceManualReview')}</td><td className="px-3 py-3 text-gray-500">{dateTime(hit.screenedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('sanction', hit, 'clear')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminComplianceClearHit')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('sanction', hit, 'confirm')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminComplianceConfirmHit')}</button></div></td></tr>)}</tbody></table></div>
    <h3 className="mt-6 text-sm font-semibold text-white">{t('adminComplianceCases')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminComplianceCaseType')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSubject')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSeverity')}</th><th className="px-3 py-3 font-medium">{t('adminStatus')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSla')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceEvidence')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!cases.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoCases')}</td></tr> : cases.map((c) => <tr key={c.id}><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{c.caseType}</span><p className="mt-1 font-mono text-[10px] text-gray-700">{c.id.slice(0, 8)}</p></td><td className="px-3 py-3 text-white"><Badge status={c.subjectType} /><span className="ml-2 font-mono text-[11px]">{c.subjectId}</span>{c.subjectEmail && <p className="mt-1 text-gray-500">{c.subjectEmail}</p>}</td><td className="px-3 py-3"><Badge status={c.severity} /></td><td className="px-3 py-3"><Badge status={c.status} /></td><td className="px-3 py-3">{c.slaBreached ? <span className="font-semibold text-red-300">{t('adminComplianceSlaBreachedLabel')}</span> : <span className="text-gray-400">{c.slaHoursRemaining !== null ? t('adminComplianceSlaHours', { hours: Math.max(0, Math.round(c.slaHoursRemaining)) }) : '-'}</span>}<p className="mt-1 text-gray-600">{t('adminComplianceDue')} {dateTime(c.slaDueAt)}</p></td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[320px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify(c.evidence || {}, null, 2)}</pre></details></td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{c.status === 'open' && <button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'investigating')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminReview')}</button>}<button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'escalated')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminComplianceEscalate')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'resolved')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminResolve')}</button></div></td></tr>)}</tbody></table></div>
  </Section>;
}

// Phase 7 (gap 9): maker-checker queue. The maker (the admin who queued the
// action) cannot approve it; the checker approves with a fresh step-up code.
function PendingActionQueue({ busy, setBusy, setNotice, setError, requestDialog }) {
  const { t } = useTranslation('credit');
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stepup, setStepup] = useState(null);
  const [stepupCode, setStepupCode] = useState('');

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/pending-actions', { params: { status: 'pending', limit: 50 } });
      setActions(response.data?.pendingActions || []);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [setError, t]);

  useEffect(() => { loadActions(); }, [loadActions]);

  const payloadSummary = (action) => {
    const payload = action.payload || {};
    const parts = [];
    if (payload.amountCents !== undefined && payload.amountCents !== null) parts.push(money(payload.amountCents, payload.currencyCode || 'USD'));
    const ids = ['settlementId', 'withdrawalId', 'customerId', 'accountId', 'disputeId', 'id'];
    for (const key of ids) {
      if (payload[key]) { parts.push(`${key}: ${String(payload[key]).slice(0, 12)}`); break; }
    }
    if (payload.operationType) parts.push(payload.operationType);
    return parts.length ? parts.join(' · ') : t('adminMakerCheckerNoPayloadSummary');
  };

  const issueApproveChallenge = async (action) => {
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/stepup-challenges', {
        actionType: 'pending_action_approve',
        amountCents: action.amountCents || undefined,
        currencyCode: action.currencyCode || undefined,
      });
      setStepup({ actionId: action.id, challengeId: response.data?.challenge?.id, expiresAt: response.data?.challenge?.expiresAt });
      setStepupCode('');
      setNotice(t('adminMakerCheckerStepupIssued'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerChallengeFailed')));
    } finally { setBusy(false); }
  };

  const confirmApprove = async () => {
    if (!stepup) return;
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/pending-actions/${stepup.actionId}/decision`, {
        decision: 'approve',
        stepupChallengeId: stepup.challengeId,
        stepupCode,
      });
      setNotice(t('adminMakerCheckerApproved'));
      setStepup(null); setStepupCode('');
      await loadActions();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerDecisionFailed')));
    } finally { setBusy(false); }
  };

  const rejectAction = async (action) => {
    const reason = await requestDialog({
      kind: 'text',
      title: t('adminMakerCheckerRejectTitle'),
      description: t('adminMakerCheckerRejectDescription', { type: action.actionType }),
      label: t('adminRequiredAuditReason'),
    });
    if (!reason?.trim()) { setError(t('adminMakerCheckerReasonRequired')); return; }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/pending-actions/${action.id}/decision`, { decision: 'rejected', reason: reason.trim() });
      setNotice(t('adminMakerCheckerRejected'));
      await loadActions();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerDecisionFailed')));
    } finally { setBusy(false); }
  };

  return <Section eyebrow="Pending actions" title="Maker-checker queue" detail="Money-moving actions queued by one admin wait here for a different admin to approve. Approving needs a fresh verification code; rejecting needs a reason. Nothing executes until a second identity approves it.">
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminMakerCheckerAction')}</th><th className="px-3 py-3 font-medium">{t('adminMakerCheckerMaker')}</th><th className="px-3 py-3 font-medium">{t('adminMakerCheckerPayload')}</th><th className="px-3 py-3 font-medium">{t('adminMakerCheckerExpires')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{loading ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminLoading')}</td></tr> : !actions.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminMakerCheckerEmpty')}</td></tr> : actions.map((action) => <tr key={action.id}><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{action.actionType}</span><p className="mt-1 font-mono text-[10px] text-gray-700">{action.id.slice(0, 8)}</p></td><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{action.requestedBy || t('adminUnknown')}</span><p className="mt-1 text-gray-600">{dateTime(action.requestedAt)}</p></td><td className="px-3 py-3 text-gray-400">{payloadSummary(action)}<details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[320px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify(action.payload || {}, null, 2)}</pre></details></td><td className="px-3 py-3 text-gray-500">{dateTime(action.expiresAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => issueApproveChallenge(action)} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApprove')}</button><button type="button" disabled={busy} onClick={() => rejectAction(action)} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div></td></tr>)}</tbody></table></div>
    {stepup && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs text-amber-200">{t('adminMakerCheckerStepupPrompt')}</p>
      <p className="mt-1 font-mono text-[10px] text-gray-500">{t('adminMakerCheckerExpires')}: {dateTime(stepup.expiresAt)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={stepupCode} onChange={(event) => setStepupCode(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" placeholder={t('adminMakerCheckerCodePlaceholder')} className="w-44 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-gray-600 focus:border-amber-400" />
        <button type="button" onClick={confirmApprove} disabled={busy || stepupCode.length < 4} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{t('adminMakerCheckerConfirmApprove')}</button>
        <button type="button" onClick={() => { setStepup(null); setStepupCode(''); }} disabled={busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">{t('cancel')}</button>
      </div>
    </div>}
  </Section>;
}

const WORKER_TRANSLATION_KEYS = {
  'oxsteed-credit-notification-outbox': 'adminWorkerNotificationOutbox',
  'oxsteed-credit-hold-expiry': 'adminWorkerHoldExpiry',
  'oxsteed-credit-entitlement-expiry': 'adminWorkerEntitlementExpiry',
  'oxsteed-credit-reconciliation': 'adminWorkerReconciliation',
  'oxsteed-credit-external-reconciliation': 'adminWorkerExternalReconciliation',
  'oxsteed-credit-settlement-cycle': 'adminWorkerSettlementCycle',
  'oxsteed-credit-compliance-monitor': 'adminWorkerComplianceMonitor',
  'oxsteed-credit-integrity': 'adminWorkerIntegrity',
  'restaurant-credit-wallet-watchdog': 'adminWorkerRestaurantWalletWatchdog',
};

function workerDisplayName(jobName, t) {
  const key = WORKER_TRANSLATION_KEYS[jobName];
  return key ? t(key) : t('adminCreditWorker');
}

const WORKER_RESULT_TRANSLATION_KEYS = {
  sent: 'adminWorkerResultSent',
  failed: 'adminWorkerResultFailed',
  purged: 'adminWorkerResultPurged',
  claimed: 'adminWorkerResultClaimed',
  retried: 'adminWorkerResultRetried',
  count: 'adminWorkerResultCount',
  reclaimed: 'adminWorkerResultReclaimed',
  processed: 'adminWorkerResultProcessed',
  skipped: 'adminWorkerResultSkipped',
};

function workerResultSummary(result, t) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  return Object.entries(result)
    .map(([key, value]) => {
      const fallback = key.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `${WORKER_RESULT_TRANSLATION_KEYS[key] ? t(WORKER_RESULT_TRANSLATION_KEYS[key]) : fallback}: ${String(value)}`;
    })
    .join(' · ');
}

function CreditWorkerHealth({ heartbeats }) {
  const { t } = useTranslation('credit');
  const rows = CREDIT_WORKER_NAMES.map((jobName) => ({ jobName, heartbeat: heartbeats?.[jobName] || {} }));
  const isFailed = (heartbeat) => Boolean(heartbeat.lastError) || heartbeat.stale === true || Number(heartbeat.consecutiveFailures || 0) > 0;
  const hasFailure = rows.some(({ heartbeat }) => isFailed(heartbeat));
  const hasAwaiting = rows.some(({ heartbeat }) => !heartbeat.lastRunAt);
  const needsAttention = hasFailure || hasAwaiting;
  const panelStatus = hasFailure ? t('adminWorkerNeedsAttention') : hasAwaiting ? t('adminWorkerAwaitingCheckpoints') : t('adminWorkerNoActiveFailures');
  return <section className={`rounded-2xl border p-4 sm:p-5 ${hasFailure ? 'border-red-500/30 bg-red-950/15' : hasAwaiting ? 'border-amber-500/30 bg-amber-950/10' : 'border-gray-800 bg-[#111318]'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">{t('adminWorkerHealth')}</p><h2 className="mt-1 text-lg font-semibold text-white">{t('adminCreditMaintenanceWorkers')}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{t('adminWorkerHealthDescription')}</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${hasFailure ? 'border-red-500/30 bg-red-500/10 text-red-300' : hasAwaiting ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{needsAttention ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{panelStatus}</span></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(({ jobName, heartbeat }) => { const failed = isFailed(heartbeat); const awaiting = !heartbeat.lastRunAt; const resultSummary = workerResultSummary(heartbeat.lastResult, t); return <div key={jobName} className={`rounded-xl border p-3 ${failed ? 'border-red-500/25 bg-red-950/20' : awaiting ? 'border-amber-500/20 bg-amber-950/10' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-white">{workerDisplayName(jobName, t)}</p><span className={`inline-flex shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${failed ? 'border-red-500/30 bg-red-500/10 text-red-300' : awaiting ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{failed ? t('adminWorkerFailed') : awaiting ? t('adminWorkerAwaitingRun') : t('adminWorkerHealthy')}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><div><p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">{t('adminWorkerLastRun')}</p><p className="mt-1 text-gray-300">{dateTime(heartbeat.lastRunAt)}</p></div><div><p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">{t('adminWorkerLastSuccess')}</p><p className="mt-1 text-gray-300">{dateTime(heartbeat.lastSuccessAt)}</p></div><div><p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">{t('adminWorkerFailuresRuns')}</p><p className={`mt-1 font-semibold ${failed ? 'text-red-300' : 'text-gray-300'}`}>{Number(heartbeat.consecutiveFailures || 0)} / {Number(heartbeat.runCount || 0)}</p></div></div>{resultSummary && <p className="mt-3 break-words text-[11px] text-gray-500">{t('adminWorkerLastResult')}: {resultSummary}</p>}{heartbeat.lastError && <p className="mt-3 break-words rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{heartbeat.lastError}</p>}</div>; })}</div>
  </section>;
}

function CreditRailPrerequisites({ prerequisites }) {
  const { t } = useTranslation('credit');
  const checks = [
    [t('adminSharedRedis'), prerequisites.sharedRedisConfigured, t('adminSharedRedisDetail')],
    [t('adminDedicatedLedgerKey'), prerequisites.dedicatedLedgerSecretConfigured, t('adminDedicatedLedgerKeyDetail')],
    [t('adminLedgerKeyConfiguration'), prerequisites.ledgerKeyConfigurationValid, t('adminLedgerKeyConfigurationDetail')],
    [t('adminServerErrorMonitoring'), prerequisites.serverErrorMonitoringConfigured, t('adminServerErrorMonitoringDetail')],
  ];
  const ready = prerequisites.readyForProductionActivation === true;
  return <section className={`rounded-2xl border p-4 sm:p-5 ${ready ? 'border-emerald-500/25 bg-emerald-950/10' : 'border-amber-500/25 bg-amber-950/10'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">{t('adminActivationReadiness')}</p><h2 className="mt-1 text-lg font-semibold text-white">{t('adminProductionPrerequisites')}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">{t('adminProductionPrerequisitesDescription')}</p></div>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${ready ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{ready ? t('adminInfrastructureReady') : t('adminNotReady')}</span>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{checks.map(([label, passed, detail]) => <div key={label} className={`rounded-xl border p-3 ${passed ? 'border-emerald-500/20 bg-emerald-950/10' : 'border-red-500/20 bg-red-950/10'}`}><div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{label}</strong>{passed ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-red-300" />}</div><p className="mt-2 text-[11px] leading-5 text-gray-500">{detail}</p><p className={`mt-2 text-[10px] font-bold uppercase tracking-[0.14em] ${passed ? 'text-emerald-300' : 'text-red-300'}`}>{passed ? t('adminPass') : t('adminActionRequired')}</p></div>)}</div>
  </section>;
}

function AdminCreditTransactionDetail({ transaction, onClose, onRefund, refundForm, setRefundForm, busy }) {
  const { t } = useTranslation('credit');
  const dialogRef = useRef(null);
  useCreditDialogFocusTrap(dialogRef, Boolean(transaction), onClose);
  if (!transaction) return null;
  const accountLabel = (account) => account?.customerEmail || account?.customerId || account?.partnerId || account?.accountType || t('adminUnknownAccount');
  const isPostedPurchase = transaction.transactionType === 'purchase' && transaction.status === 'posted';
  const canRefund = isPostedPurchase && Number(transaction.remainingRefundableCents || 0) > 0;
  return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" aria-label={t('adminTransactionDetail')}>
    <section className="my-2 w-full max-w-5xl rounded-2xl border border-gray-700 bg-[#111318] p-4 shadow-2xl sm:my-8 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-800 pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminTransactionDetail')}</p><h2 className="mt-1 text-xl font-semibold text-white">{creditTransactionLabel(transaction, t)}</h2><p className="mt-1 break-all font-mono text-[11px] text-gray-600">{transaction.id}</p></div><button type="button" onClick={onClose} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">{t('adminClose')}</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4"><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminAmount', { currency: transaction.currencyCode })}</span><strong className="mt-1 block text-lg text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</strong></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminStatus')}</span><div className="mt-2"><Badge status={transaction.status} /></div></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminPosted')}</span><strong className="mt-1 block text-sm text-gray-300">{dateTime(transaction.postedAt || transaction.createdAt)}</strong></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminRestaurant')}</span><strong className="mt-1 block break-words text-sm text-gray-300">{transaction.restaurantName || t('adminPlatformMovement')}</strong></div></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminJournalAccounts')}</p><div className="mt-3 space-y-3 text-xs"><div><span className="text-gray-600">{t('adminDebit')}</span><p className="mt-1 break-all text-gray-300">{accountLabel(transaction.debitAccount)} <span className="text-gray-600">· {transaction.debitAccount?.accountType || t('adminAccount')}</span></p></div><div><span className="text-gray-600">{t('adminCredit')}</span><p className="mt-1 break-all text-gray-300">{accountLabel(transaction.creditAccount)} <span className="text-gray-600">· {transaction.creditAccount?.accountType || t('adminAccount')}</span></p></div><div><span className="text-gray-600">{t('adminReference')}</span><p className="mt-1 break-all text-gray-300">{transaction.referenceType || t('adminNone')}{transaction.referenceId ? ` · ${transaction.referenceId}` : ''}</p></div><div><span className="text-gray-600">{t('adminIdempotencyKey')}</span><p className="mt-1 break-all font-mono text-[10px] text-gray-500">{transaction.idempotencyKey || t('adminNotRecorded')}</p></div></div></div><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminImmutableEntries')}</p><div className="mt-3 space-y-2">{!transaction.entries?.length ? <p className="text-xs text-gray-600">{t('adminNoJournalEntries')}</p> : transaction.entries.map((entry) => <div key={entry.id} className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold uppercase tracking-[0.12em] text-sky-300">{entry.side}</span><strong className="text-emerald-300">{money(entry.amountCents, transaction.currencyCode)}</strong></div><p className="mt-1 break-all text-gray-600">{entry.accountType || t('adminAccount')} · {t('adminBalanceAfter')} {money(entry.balanceAfterCents, transaction.currencyCode)} · {t('adminSequence')} {entry.sequence}</p><p className="mt-1 break-all font-mono text-[10px] text-gray-700">{t('adminHash')} {entry.entryHash || t('adminNotRecorded')} · {t('adminKeyVersion')} {entry.hashKeyVersion || 'v1'}</p></div>)}</div></div></div>
      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminRelatedAuditEvents')}</p><div className="mt-3 space-y-2">{!transaction.auditEvents?.length ? <p className="text-xs text-gray-600">{t('adminNoTransactionAuditEvents')}</p> : transaction.auditEvents.map((event) => <div key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2 text-xs"><div><strong className="font-mono text-orange-300">{event.actionType}</strong><p className="mt-1 text-gray-500">{event.reason || t('adminNoReasonRecorded')}</p></div><span className="text-gray-600">{dateTime(event.createdAt)}</span></div>)}</div></div>
      {isPostedPurchase && !canRefund && <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4 text-xs text-gray-500">{t('adminNoRefundableBalance')} {money(transaction.refundedCents, transaction.currencyCode)}.</div>}
      {canRefund && <form onSubmit={onRefund} className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">{t('adminOperatorAction')}</p><h3 className="mt-1 text-sm font-semibold text-white">{t('adminRefundPurchase')}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{t('adminRefundDescription')}</p></div><span className="text-xs font-semibold text-amber-200">{t('adminRemaining')} {money(transaction.remainingRefundableCents, transaction.currencyCode)}</span></div><div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto] "><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRefundAmount', { currency: transaction.currencyCode })}</span><input required inputMode="decimal" autoComplete="off" value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" aria-label={t('adminRefundAmount', { currency: transaction.currencyCode })} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredReason')}</span><input required maxLength={500} value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t('adminRefundReasonPlaceholder')} aria-label={t('adminRequiredReason')} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={busy} className="self-end rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{busy ? t('adminPosting') : t('adminPostRefund')}</button></div></form>}
    </section>
  </div>;
}

function SettlementEvidence({ settlements }) {
  const { t } = useTranslation('credit');
  if (!settlements?.length) return null;
  return <Section eyebrow={t('adminPayoutEvidence')} title={t('adminSettlementPaymentTrail')} detail={t('adminSettlementEvidenceDescription')}><div className="mt-4 grid gap-3 md:grid-cols-2">{settlements.slice(0, 6).map((settlement) => <article key={settlement.id} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{settlement.restaurantName || t('adminPartnerFallback', { id: settlement.partnerId })}</h3><p className="mt-1 text-[11px] text-gray-600">{dateTime(settlement.periodStart)} {t('adminTo')} {dateTime(settlement.periodEnd)}</p></div><Badge status={settlement.status} /></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-gray-600">{t('adminNetPayable')}</dt><dd className="mt-1 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</dd></div><div><dt className="text-gray-600">{t('adminApprovedBy')}</dt><dd className="mt-1 break-all text-sky-300">{settlement.approvedBy || t('adminPendingApproval')}</dd></div><div><dt className="text-gray-600">{t('adminPaymentReference')}</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-300">{settlement.paymentReference || t('adminNotRecorded')}</dd></div></dl>{settlement.paidAt && <p className="mt-3 border-t border-gray-800 pt-3 text-[11px] text-gray-500">{t('adminPaid')} {dateTime(settlement.paidAt)}</p>}</article>)}</div>{settlements.length > 6 && <p className="mt-3 text-xs text-gray-600">{t('adminRecentSettlementSummary')}</p>}</Section>;
}

function AdminActionDialog({ dialog, onResolve }) {
  const { t } = useTranslation('credit');
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  useCreditDialogFocusTrap(dialogRef, Boolean(dialog), () => onResolve(null));
  useEffect(() => {
    if (!dialog) return;
    setValue(dialog.defaultValue || '');
    if (dialog.kind !== 'confirm') inputRef.current?.focus();
  }, [dialog]);
  if (!dialog) return null;
  const isConfirm = dialog.kind === 'confirm';
  const submit = (event) => {
    event.preventDefault();
    if (isConfirm) return onResolve(true);
    if (dialog.required !== false && !String(value || '').trim()) return;
    onResolve(String(value || '').trim());
  };
  return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="credit-action-dialog-title" aria-describedby="credit-action-dialog-description">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#111318] p-5 shadow-2xl sm:p-6">
      <h2 id="credit-action-dialog-title" className="text-lg font-semibold text-white">{dialog.title}</h2>
      <p id="credit-action-dialog-description" className="mt-2 text-sm leading-6 text-gray-400">{dialog.description}</p>
      {!isConfirm && <label className="mt-4 block"><span className="mb-1 block text-xs font-semibold text-gray-500">{dialog.label}</span><input ref={inputRef} required={dialog.required !== false} value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder || ''} maxLength={dialog.maxLength || 1000} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => onResolve(null)} className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800">{t('cancel')}</button><button type="submit" className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-500">{isConfirm ? t('confirmAction') : t('submitAction')}</button></div>
    </form>
  </div>;
}

export default function OxsteedCreditAdmin() {
  const { t } = useTranslation('credit');
  const [overview, setOverview] = useState(null);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [partners, setPartners] = useState([]);
  const [partnerDirectory, setPartnerDirectory] = useState([]);
  const [partnerDirectorySearch, setPartnerDirectorySearch] = useState('');
  const [partnerDirectoryStatus, setPartnerDirectoryStatus] = useState('all');
  const [partnerDirectoryQuery, setPartnerDirectoryQuery] = useState({ search: '', status: '', offset: 0 });
  const [partnerDirectoryPagination, setPartnerDirectoryPagination] = useState({ limit: PARTNER_DIRECTORY_PAGE_SIZE, offset: 0, total: 0, hasMore: false, nextOffset: null });
  const [loadingMorePartnerDirectory, setLoadingMorePartnerDirectory] = useState(false);
  const [partnerOptions, setPartnerOptions] = useState([]);
  const [partnerPickerSearch, setPartnerPickerSearch] = useState('');
  const [partnerPickerQuery, setPartnerPickerQuery] = useState('');
  const [partnerPickerTotal, setPartnerPickerTotal] = useState(0);
  const [loadingPartnerOptions, setLoadingPartnerOptions] = useState(false);
  const [partnerOptionsError, setPartnerOptionsError] = useState('');
  const [settlementAgreementOptions, setSettlementAgreementOptions] = useState([]);
  const [settlementAgreementLookupPartnerId, setSettlementAgreementLookupPartnerId] = useState('');
  const [loadingSettlementAgreements, setLoadingSettlementAgreements] = useState(false);
  const [settlementAgreementOptionsError, setSettlementAgreementOptionsError] = useState('');
  const [agreements, setAgreements] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [settlementPartnerId, setSettlementPartnerId] = useState('');
  const [settlementStatus, setSettlementStatus] = useState('');
  const [settlementPagination, setSettlementPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreSettlements, setLoadingMoreSettlements] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [transactionType, setTransactionType] = useState('');
  const [transactionStatus, setTransactionStatus] = useState('');
  const [transactionCurrency, setTransactionCurrency] = useState('all');
  const [transactionPagination, setTransactionPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [transactionDetail, setTransactionDetail] = useState(null);
  const [loadingTransactionId, setLoadingTransactionId] = useState('');
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });
  const [disputes, setDisputes] = useState([]);
  const [disputeStatus, setDisputeStatus] = useState('');
  const [disputePagination, setDisputePagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreDisputes, setLoadingMoreDisputes] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditActionType, setAuditActionType] = useState('');
  const [auditResourceType, setAuditResourceType] = useState('');
  const [auditPartnerId, setAuditPartnerId] = useState('');
  const [auditCorrelationId, setAuditCorrelationId] = useState('');
  const [auditPagination, setAuditPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreAuditEvents, setLoadingMoreAuditEvents] = useState(false);
  const [rail, setRail] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciliationRuns, setReconciliationRuns] = useState([]);
  const [reconciliationStatus, setReconciliationStatus] = useState('');
  const [reconciliationCurrency, setReconciliationCurrency] = useState('all');
  const [reconciliationPagination, setReconciliationPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreReconciliationRuns, setLoadingMoreReconciliationRuns] = useState(false);
  const [reconciliationReason, setReconciliationReason] = useState('');
  const [externalReconRuns, setExternalReconRuns] = useState([]);
  const [complianceQueue, setComplianceQueue] = useState(null);
  const [externalReconStatus, setExternalReconStatus] = useState('');
  const [externalReconCurrency, setExternalReconCurrency] = useState('all');
  const [externalReconPagination, setExternalReconPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreExternalReconRuns, setLoadingMoreExternalReconRuns] = useState(false);
  const [externalReconReason, setExternalReconReason] = useState('');
  const [railFreezeReason, setRailFreezeReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [partnerForm, setPartnerForm] = useState({ restaurantId: '', settlementCurrencyCode: 'USD', notes: '', reason: '' });
  const [agreementForm, setAgreementForm] = useState({ partnerId: '', startsAt: new Date().toISOString().slice(0, 16), endsAt: '', customerTerms: '', allowedOrderTypes: 'pickup, delivery, dine_in', allowedCategories: '', allowedMenuItemIds: '', coverageCities: '', coverageStates: '', coveragePostalCodes: '', coverageCountries: '', maxTransaction: '', dailyLimit: '', lifetimeLimit: '', requiresCustomerEntitlement: false, reason: '' });
  const [settlementForm, setSettlementForm] = useState({ partnerId: '', agreementId: '', currencyCode: 'USD', periodStart: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 16), periodEnd: new Date().toISOString().slice(0, 16), paymentReference: '', reason: '' });
  const [customerForm, setCustomerForm] = useState({ customerId: '', amount: '', currencyCode: 'USD', fundingReference: '', reason: '' });
  const [accountStatusForm, setAccountStatusForm] = useState({ customerId: '', currencyCode: 'USD', status: 'suspended', reason: '' });
  const [customerAccountSearch, setCustomerAccountSearch] = useState('');
  const [customerAccountStatus, setCustomerAccountStatus] = useState('all');
  const [customerAccountCurrency, setCustomerAccountCurrency] = useState('all');
  const [customerAccountQuery, setCustomerAccountQuery] = useState({ search: '', status: '', currencyCode: '', offset: 0 });
  const [customerAccountTotal, setCustomerAccountTotal] = useState(0);
  const [customerAccountOffset, setCustomerAccountOffset] = useState(0);
  const [customerAccountHasMore, setCustomerAccountHasMore] = useState(false);
  const [customerDetailAccount, setCustomerDetailAccount] = useState(null);
  const [railReason, setRailReason] = useState('');
  const [notificationRetryReason, setNotificationRetryReason] = useState('');
  const [retryingNotificationId, setRetryingNotificationId] = useState('');
  const [disputeResolutionDrafts, setDisputeResolutionDrafts] = useState({});
  // Phase 7 (gap 10): per-dispute compensation (cents) entered by the admin
  // when resolving in the customer's favor; only that path pays money out.
  const [disputeCompensationDrafts, setDisputeCompensationDrafts] = useState({});
  const loadRequestRef = useRef(0);
  const partnerLookupRequestRef = useRef(0);
  const settlementAgreementRequestRef = useRef(0);
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());
  const dialogResolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const requestDialog = useCallback((config) => new Promise((resolve) => {
    dialogResolverRef.current = resolve;
    setDialog({ ...config, value: config.defaultValue || '' });
  }), []);

  const resolveDialog = (value) => {
    const resolve = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    resolve?.(value);
  };

  const load = useCallback(async ({ quiet = false, customerAccountsParams, appendPartnerDirectory = false, partnerDirectoryOffset = 0, appendSettlements = false, settlementOffset = 0, appendTransactions = false, transactionOffset = 0, appendDisputes = false, disputeOffset = 0, appendAuditEvents = false, auditOffset = 0, appendReconciliationRuns = false, reconciliationOffset = 0, appendExternalReconRuns = false, externalReconOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    if (appendPartnerDirectory) setLoadingMorePartnerDirectory(true);
    if (appendSettlements) setLoadingMoreSettlements(true);
    if (appendTransactions) setLoadingMoreTransactions(true);
    if (appendDisputes) setLoadingMoreDisputes(true);
    if (appendAuditEvents) setLoadingMoreAuditEvents(true);
    if (appendReconciliationRuns) setLoadingMoreReconciliationRuns(true);
    if (appendExternalReconRuns) setLoadingMoreExternalReconRuns(true);
    setError('');
    try {
      const walletQuery = customerAccountsParams || customerAccountQuery;
      const walletParams = {
        limit: CUSTOMER_ACCOUNT_PAGE_SIZE,
        offset: Number(walletQuery.offset) || 0,
      };
      if (walletQuery.search) walletParams.search = walletQuery.search;
      if (walletQuery.status) walletParams.status = walletQuery.status;
      if (walletQuery.currencyCode) walletParams.currencyCode = walletQuery.currencyCode;
      const directoryQuery = partnerDirectoryQuery;
      const partnerDirectoryParams = { limit: PARTNER_DIRECTORY_PAGE_SIZE, offset: appendPartnerDirectory ? partnerDirectoryOffset : 0 };
      if (directoryQuery.search) partnerDirectoryParams.search = directoryQuery.search;
      if (directoryQuery.status) partnerDirectoryParams.status = directoryQuery.status;
      const settlementParams = { limit: 50, offset: appendSettlements ? settlementOffset : 0 };
      if (settlementPartnerId) settlementParams.partnerId = settlementPartnerId;
      if (settlementStatus) settlementParams.status = settlementStatus;
      const transactionParams = { limit: 50, offset: appendTransactions ? transactionOffset : 0 };
      if (transactionType) transactionParams.transactionType = transactionType;
      if (transactionStatus) transactionParams.status = transactionStatus;
      if (transactionCurrency !== 'all') transactionParams.currencyCode = transactionCurrency;
      const disputeParams = { limit: 50, offset: appendDisputes ? disputeOffset : 0 };
      if (disputeStatus) disputeParams.status = disputeStatus;
      const auditParams = { limit: 50, offset: appendAuditEvents ? auditOffset : 0 };
      if (auditActionType) auditParams.actionType = auditActionType;
      if (auditResourceType) auditParams.resourceType = auditResourceType;
      if (auditPartnerId) auditParams.partnerId = auditPartnerId;
      if (auditCorrelationId) auditParams.correlationId = auditCorrelationId;
      const reconciliationParams = { limit: 50, offset: appendReconciliationRuns ? reconciliationOffset : 0 };
      if (reconciliationStatus) reconciliationParams.status = reconciliationStatus;
      if (reconciliationCurrency !== 'all') reconciliationParams.currencyCode = reconciliationCurrency;
      const externalReconParams = { limit: 50, offset: appendExternalReconRuns ? externalReconOffset : 0 };
      if (externalReconStatus) externalReconParams.status = externalReconStatus;
      if (externalReconCurrency !== 'all') externalReconParams.currencyCode = externalReconCurrency;
      const [overviewResponse, customerAccountsResponse, partnersResponse, partnerDirectoryResponse, agreementsResponse, settlementsResponse, transactionsResponse, disputesResponse, auditEventsResponse, reconciliationResponse, externalReconResponse, complianceResponse, railResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/accounts', { params: walletParams }),
        adminApi.get('/admin/super/oxsteed-credit/partners'),
        adminApi.get('/admin/super/oxsteed-credit/partners/directory', { params: partnerDirectoryParams }),
        adminApi.get('/admin/super/oxsteed-credit/agreements'),
        adminApi.get('/admin/super/oxsteed-credit/settlements', { params: settlementParams }),
        adminApi.get('/admin/super/oxsteed-credit/transactions', { params: transactionParams }),
        adminApi.get('/admin/super/oxsteed-credit/disputes', { params: disputeParams }),
        adminApi.get('/admin/super/oxsteed-credit/audit-events', { params: auditParams }),
        adminApi.get('/admin/super/oxsteed-credit/reconciliation', { params: reconciliationParams }),
        adminApi.get('/admin/super/oxsteed-credit/external-reconciliation', { params: externalReconParams }),
        adminApi.get('/admin/super/oxsteed-credit/compliance-queue'),
        adminApi.get('/admin/super/oxsteed-credit/rail'),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
      const loadedCustomerAccounts = customerAccountsResponse.data?.accounts || [];
      setCustomerAccounts(loadedCustomerAccounts);
      setCustomerAccountTotal(Number(customerAccountsResponse.data?.total ?? loadedCustomerAccounts.length));
      setCustomerAccountOffset(Number(customerAccountsResponse.data?.offset ?? walletParams.offset));
      setCustomerAccountHasMore(Boolean(customerAccountsResponse.data?.hasMore));
      setPartners(partnersResponse.data?.partners || []);
      const loadedPartnerDirectory = partnerDirectoryResponse.data?.partners || [];
      if (appendPartnerDirectory) setPartnerDirectory((current) => [...current, ...loadedPartnerDirectory]);
      else setPartnerDirectory(loadedPartnerDirectory);
      setPartnerDirectoryPagination(partnerDirectoryResponse.data?.pagination || { limit: partnerDirectoryParams.limit, offset: partnerDirectoryParams.offset, total: loadedPartnerDirectory.length, hasMore: false, nextOffset: null });
      setAgreements(agreementsResponse.data?.agreements || []);
      const loadedSettlements = settlementsResponse.data?.settlements || [];
      if (appendSettlements) setSettlements((current) => [...current, ...loadedSettlements]);
      else setSettlements(loadedSettlements);
      setSettlementPagination(settlementsResponse.data?.pagination || { limit: settlementParams.limit, offset: settlementParams.offset, hasMore: false, nextOffset: null });
      const loadedTransactions = transactionsResponse.data?.transactions || [];
      if (appendTransactions) setTransactions((current) => [...current, ...loadedTransactions]);
      else setTransactions(loadedTransactions);
      setTransactionPagination(transactionsResponse.data?.pagination || { limit: transactionParams.limit, offset: transactionParams.offset, hasMore: false, nextOffset: null });
      const loadedDisputes = disputesResponse.data?.disputes || [];
      if (appendDisputes) setDisputes((current) => [...current, ...loadedDisputes]);
      else setDisputes(loadedDisputes);
      setDisputePagination(disputesResponse.data?.pagination || { limit: disputeParams.limit, offset: disputeParams.offset, hasMore: false, nextOffset: null });
      const loadedAuditEvents = auditEventsResponse.data?.auditEvents || [];
      if (appendAuditEvents) setAuditEvents((current) => [...current, ...loadedAuditEvents]);
      else setAuditEvents(loadedAuditEvents);
      setAuditPagination(auditEventsResponse.data?.pagination || { limit: auditParams.limit, offset: auditParams.offset, hasMore: false, nextOffset: null });
      const loadedReconciliationRuns = reconciliationResponse.data?.runs || [];
      if (appendReconciliationRuns) setReconciliationRuns((current) => [...current, ...loadedReconciliationRuns]);
      else setReconciliationRuns(loadedReconciliationRuns);
      setReconciliationPagination(reconciliationResponse.data?.pagination || { limit: reconciliationParams.limit, offset: reconciliationParams.offset, hasMore: false, nextOffset: null });
      const loadedExternalReconRuns = externalReconResponse.data?.runs || [];
      if (appendExternalReconRuns) setExternalReconRuns((current) => [...current, ...loadedExternalReconRuns]);
      else setExternalReconRuns(loadedExternalReconRuns);
      setExternalReconPagination(externalReconResponse.data?.pagination || { limit: externalReconParams.limit, offset: externalReconParams.offset, hasMore: false, nextOffset: null });
      setComplianceQueue(complianceResponse.data || null);
      setRail(railResponse.data?.rail || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) {
        setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendPartnerDirectory) setLoadingMorePartnerDirectory(false);
        if (appendSettlements) setLoadingMoreSettlements(false);
        if (appendTransactions) setLoadingMoreTransactions(false);
        if (appendDisputes) setLoadingMoreDisputes(false);
        if (appendAuditEvents) setLoadingMoreAuditEvents(false);
        if (appendReconciliationRuns) setLoadingMoreReconciliationRuns(false);
        if (appendExternalReconRuns) setLoadingMoreExternalReconRuns(false);
      }
    }
  }, [auditActionType, auditCorrelationId, auditPartnerId, auditResourceType, customerAccountQuery, disputeStatus, externalReconCurrency, externalReconStatus, partnerDirectoryQuery, reconciliationCurrency, reconciliationStatus, settlementPartnerId, settlementStatus, transactionCurrency, transactionStatus, transactionType]);

  useEffect(() => { load(); }, [load]);

  const loadPartnerOptions = useCallback(async (search) => {
    const requestId = ++partnerLookupRequestRef.current;
    setLoadingPartnerOptions(true);
    setPartnerOptionsError('');
    try {
      const query = String(search || '').trim();
      const response = await adminApi.get('/admin/super/oxsteed-credit/partners/directory', {
        params: { limit: 250, offset: 0, ...(query ? { search: query } : {}) },
      });
      if (requestId !== partnerLookupRequestRef.current) return;
      const loadedOptions = response.data?.partners || [];
      setPartnerOptions(loadedOptions);
      setPartnerPickerTotal(Number(response.data?.pagination?.total ?? loadedOptions.length));
    } catch (err) {
      if (requestId === partnerLookupRequestRef.current) {
        setPartnerOptionsError(safeCreditErrorMessage(err, t('adminPartnerLookupFailed')));
      }
    } finally {
      if (requestId === partnerLookupRequestRef.current) setLoadingPartnerOptions(false);
    }
  }, []);

  const applyPartnerPickerSearch = () => {
    const query = partnerPickerSearch.trim();
    setPartnerPickerQuery(query);
    loadPartnerOptions(query);
  };

  const clearPartnerPickerSearch = () => {
    partnerLookupRequestRef.current += 1;
    setPartnerPickerSearch('');
    setPartnerPickerQuery('');
    setPartnerOptions([]);
    setPartnerPickerTotal(0);
    setPartnerOptionsError('');
  };

  const loadSettlementAgreements = useCallback(async (partnerId) => {
    const requestId = ++settlementAgreementRequestRef.current;
    const normalizedPartnerId = String(partnerId || '');
    if (!normalizedPartnerId) {
      setSettlementAgreementOptions([]);
      setSettlementAgreementLookupPartnerId('');
      setSettlementAgreementOptionsError('');
      setLoadingSettlementAgreements(false);
      return;
    }
    setLoadingSettlementAgreements(true);
    setSettlementAgreementOptionsError('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/agreements', { params: { partnerId: normalizedPartnerId } });
      if (requestId !== settlementAgreementRequestRef.current) return;
      setSettlementAgreementOptions(response.data?.agreements || []);
      setSettlementAgreementLookupPartnerId(normalizedPartnerId);
    } catch (err) {
      if (requestId === settlementAgreementRequestRef.current) {
        setSettlementAgreementOptionsError(safeCreditErrorMessage(err, t('adminAgreementLookupFailed')));
      }
    } finally {
      if (requestId === settlementAgreementRequestRef.current) setLoadingSettlementAgreements(false);
    }
  }, []);

  const selectablePartners = useMemo(() => {
    const activeOptions = partnerPickerQuery ? partnerOptions : partners;
    const selectedIds = [agreementForm.partnerId, settlementForm.partnerId].filter(Boolean).map(String);
    const selectedPartners = [...partners, ...partnerOptions].filter((partner) => selectedIds.includes(String(partner.partnerId)));
    return Array.from(new Map([...activeOptions, ...selectedPartners].map((partner) => [String(partner.partnerId), partner])).values());
  }, [agreementForm.partnerId, partnerOptions, partnerPickerQuery, partners, settlementForm.partnerId]);

  const selectedPartner = useMemo(() => selectablePartners.find((partner) => String(partner.partnerId) === String(agreementForm.partnerId)), [agreementForm.partnerId, selectablePartners]);
  const settlementAgreements = useMemo(() => {
    const source = settlementAgreementLookupPartnerId === String(settlementForm.partnerId) ? settlementAgreementOptions : agreements;
    return source.filter((agreement) => String(agreement.partnerId) === String(settlementForm.partnerId));
  }, [agreements, settlementAgreementLookupPartnerId, settlementAgreementOptions, settlementForm.partnerId]);

  const registerPartner = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post('/admin/super/oxsteed-credit/partners', { restaurantId: partnerForm.restaurantId, settlementCurrencyCode: partnerForm.settlementCurrencyCode, notes: partnerForm.notes || undefined, reason: partnerForm.reason });
      setNotice(t('adminPartnerEnrollmentCreated'));
      setPartnerForm({ restaurantId: '', settlementCurrencyCode: 'USD', notes: '', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminPartnerEnrollmentFailed')));
    } finally { setBusy(false); }
  };

  const createAgreement = async (event) => {
    event.preventDefault();
    if (!agreementForm.partnerId) return setError(t('adminChooseCreditPartnerError'));
    const agreementCurrency = selectedPartner?.settlementCurrencyCode || 'USD';
    const maxTransaction = parseOptionalCreditMajorAmount(agreementForm.maxTransaction, agreementCurrency, overview?.currencyMetadata);
    const dailyLimit = parseOptionalCreditMajorAmount(agreementForm.dailyLimit, agreementCurrency, overview?.currencyMetadata);
    const lifetimeLimit = parseOptionalCreditMajorAmount(agreementForm.lifetimeLimit, agreementCurrency, overview?.currencyMetadata);
    if (!maxTransaction.valid || !dailyLimit.valid || !lifetimeLimit.valid) {
      return setError(t('adminInvalidLimitAmount', { currency: agreementCurrency }));
    }
    setBusy(true); setNotice(''); setError('');
    const payload = {
      startsAt: new Date(agreementForm.startsAt).toISOString(),
      endsAt: agreementForm.endsAt ? new Date(agreementForm.endsAt).toISOString() : undefined,
      customerTerms: agreementForm.customerTerms || undefined,
      allowedOrderTypes: splitList(agreementForm.allowedOrderTypes),
      allowedCategories: splitList(agreementForm.allowedCategories),
      allowedMenuItemIds: splitList(agreementForm.allowedMenuItemIds),
      geography: buildGeography(agreementForm),
      maxTransactionCents: maxTransaction.value,
      dailyCustomerLimitCents: dailyLimit.value,
      lifetimeCustomerLimitCents: lifetimeLimit.value,
      requiresCustomerEntitlement: agreementForm.requiresCustomerEntitlement,
      reason: agreementForm.reason,
    };
    const keyPayload = { partnerId: agreementForm.partnerId, ...payload };
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${agreementForm.partnerId}/agreements`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-agreement', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-agreement', keyPayload);
      setNotice(t('adminAgreementCreated', { partner: selectedPartner?.restaurantName || t('adminSelectedPartner') }));
      setAgreementForm((current) => ({ ...current, customerTerms: '', allowedCategories: '', allowedMenuItemIds: '', coverageCities: '', coverageStates: '', coveragePostalCodes: '', coverageCountries: '', maxTransaction: '', dailyLimit: '', lifetimeLimit: '', reason: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminAgreementCreationFailed')));
    } finally { setBusy(false); }
  };

  const transitionPartner = async (partner, status) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminPartnerTransitionTitle', { partner: partner.restaurantName || t('adminThisPartner'), status: localizeCreditStatus(status, t) }), description: t('adminPartnerTransitionDescription'), label: t('adminRequiredAuditReason'), defaultValue: t('adminPartnerTransitionDefault') });
    if (!reason?.trim()) {
      setError(t('adminPartnerTransitionReasonRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${partner.partnerId}/transition`, { status, expectedStatus: partner.status, reason: reason.trim() });
      setNotice(t('adminPartnerStatusChanged', { partner: partner.restaurantName || t('adminPartner'), status: localizeCreditStatus(status, t) }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminPartnerStatusChangeFailed')));
    } finally { setBusy(false); }
  };

  const transitionAgreement = async (agreement, status) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminAgreementTransitionTitle', { version: agreement.version, status: localizeCreditStatus(status, t) }), description: t('adminAgreementTransitionDescription'), label: t('adminRequiredAuditReason'), defaultValue: t('adminAgreementTransitionDefault') });
    if (!reason?.trim()) {
      setError(t('adminAgreementTransitionReasonRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/agreements/${agreement.id}/transition`, { status, expectedStatus: agreement.status, reason: reason.trim() });
      setNotice(t('adminAgreementStatusChanged', { version: agreement.version, status: localizeCreditStatus(status, t) }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminAgreementStatusChangeFailed')));
    } finally { setBusy(false); }
  };

  const createSettlement = async (event) => {
    event.preventDefault();
    if (!settlementForm.partnerId || !settlementForm.agreementId) return setError(t('adminChoosePartnerAgreementError'));
    setBusy(true); setNotice(''); setError('');
    const payload = {
      partnerId: settlementForm.partnerId,
      agreementId: settlementForm.agreementId,
      periodStart: new Date(settlementForm.periodStart).toISOString(),
      periodEnd: new Date(settlementForm.periodEnd).toISOString(),
      paymentReference: settlementForm.paymentReference || undefined,
      reason: settlementForm.reason,
    };
    try {
      await adminApi.post('/admin/super/oxsteed-credit/settlements', payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-settlement', payload) } });
      idempotencyKeysRef.current.clear('credit-settlement', payload);
      setNotice(t('adminSettlementSnapshotCreated'));
      setSettlementForm((current) => ({ ...current, paymentReference: '', reason: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementCreationFailed')));
    } finally { setBusy(false); }
  };

  const transitionSettlement = async (settlement, status) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminSettlementTransitionTitle', { status: localizeCreditStatus(status, t) }), description: t('adminSettlementTransitionDescription'), label: t('adminRequiredAuditReason'), defaultValue: t('adminSettlementTransitionDefault') });
    if (!reason?.trim()) {
      setError(t('adminSettlementTransitionReasonRequired'));
      return;
    }
    let paymentReference = settlement.paymentReference || '';
    if (status === 'paid' && !paymentReference && Number(settlement.netCents || 0) > 0) {
      paymentReference = await requestDialog({ kind: 'text', title: t('adminExternalPaymentReference'), description: t('adminExternalPaymentReferenceDescription'), label: t('adminPaymentReference'), placeholder: t('adminPaymentReferencePlaceholder') }) || '';
      if (!paymentReference.trim()) {
        setError(t('adminPaymentReferenceRequired'));
        return;
      }
    }
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/settlements/${settlement.id}/status`, { status, expectedStatus: settlement.status, reason: reason.trim(), paymentReference: paymentReference.trim() || undefined });
      // Phase 7 (gap 9): approval (status=approved) queues as a pending action
      // for a second admin; every other transition executes immediately.
      setNotice(response.status === 202
        ? t('adminMakerCheckerQueued')
        : t('adminSettlementStatusChanged', { partner: settlement.restaurantName || t('adminPartner'), status: localizeCreditStatus(status, t) }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementStatusChangeFailed')));
    } finally { setBusy(false); }
  };

  const reverseSettlement = async (settlement) => {
    const reason = await requestDialog({ kind: 'text', title: t('adminSettlementReversalTitle'), description: t('adminSettlementReversalDescription'), label: t('adminRequiredReversalReason'), defaultValue: t('adminSettlementReversalDefault') });
    if (!reason?.trim()) {
      setError(t('adminSettlementReversalReasonRequired'));
      return;
    }
    const recoveryReference = await requestDialog({ kind: 'text', title: t('adminSettlementRecoveryReference'), description: t('adminSettlementRecoveryReferenceDescription'), label: t('adminRecoveryReference'), placeholder: t('adminRecoveryReferencePlaceholder') }) || '';
    if (!recoveryReference.trim()) {
      setError(t('adminRecoveryReferenceRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    const payload = { reason: reason.trim(), recoveryReference: recoveryReference.trim() };
    const keyPayload = { settlementId: settlement.id, ...payload };
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/settlements/${settlement.id}/reversal`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-settlement-reversal', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-settlement-reversal', keyPayload);
      setNotice(t('adminSettlementReversed', { partner: settlement.restaurantName || t('adminPartner') }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementReversalFailed')));
    } finally { setBusy(false); }
  };

  const runReconciliation = async () => {
    if (!reconciliationReason.trim()) {
      setError(t('adminReconciliationReasonRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/reconciliation', {
        currencyCode: settlementForm.currencyCode || 'USD',
        periodStart: new Date(settlementForm.periodStart).toISOString(),
        periodEnd: new Date(settlementForm.periodEnd).toISOString(),
        reason: reconciliationReason.trim(),
      });
      const run = response.data?.run || null;
      setReconciliation(run);
      if (run) setReconciliationRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setReconciliationReason('');
      setNotice(run?.status === 'balanced'
        ? t('adminReconciliationBalanced')
        : run?.status === 'failed'
          ? t('adminReconciliationIntegrityFailed')
          : t('adminReconciliationDifference'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminReconciliationFailed')));
    } finally { setBusy(false); }
  };

  const loadCustomerCredit = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    const payload = { amountCents: dollarsToCents(customerForm.amount, customerForm.currencyCode), currencyCode: customerForm.currencyCode, fundingReference: customerForm.fundingReference, reason: customerForm.reason };
    const keyPayload = { customerId: customerForm.customerId, ...payload };
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/customers/${customerForm.customerId}/loads`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-load', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-load', keyPayload);
      // Phase 7 (gap 9): 202 means the load queued as a pending action for a
      // second admin instead of posting immediately.
      setNotice(response.status === 202 ? t('adminMakerCheckerQueued') : t('adminCustomerGrantPosted'));
      setCustomerForm({ customerId: '', amount: '', currencyCode: 'USD', fundingReference: '', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCustomerGrantFailed')));
    } finally { setBusy(false); }
  };

  const adjustCustomerCredit = async (event) => {
    event.preventDefault();
    const confirmed = await requestDialog({ kind: 'confirm', title: t('adminConfirmCustomerClawback'), description: t('adminCustomerClawbackDescription', { amount: customerForm.amount || t('adminThisAmount'), wallet: customerForm.customerId || t('adminThisWallet') }) });
    if (!confirmed) return;
    setBusy(true); setNotice(''); setError('');
    const payload = { amountCents: dollarsToCents(customerForm.amount, customerForm.currencyCode), currencyCode: customerForm.currencyCode, direction: 'debit', reason: customerForm.reason };
    const keyPayload = { customerId: customerForm.customerId, ...payload };
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/customers/${customerForm.customerId}/adjustments`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-adjustment', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-adjustment', keyPayload);
      // Phase 7 (gap 9): 202 means the adjustment queued as a pending action
      // for a second admin instead of posting immediately.
      setNotice(response.status === 202 ? t('adminMakerCheckerQueued') : t('adminCustomerClawbackPosted'));
      setCustomerForm({ customerId: '', amount: '', currencyCode: 'USD', fundingReference: '', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCustomerAdjustmentFailed')));
    } finally { setBusy(false); }
  };

  const updateAccountStatus = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    const payload = { currencyCode: accountStatusForm.currencyCode, status: accountStatusForm.status, reason: accountStatusForm.reason };
    const keyPayload = { customerId: accountStatusForm.customerId, ...payload };
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/customers/${accountStatusForm.customerId}/status`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-status', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-status', keyPayload);
      setNotice(t('adminCustomerAccountMoved', { status: localizeCreditStatus(accountStatusForm.status, t) }));
      setAccountStatusForm({ customerId: '', currencyCode: 'USD', status: 'suspended', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCustomerAccountStatusFailed')));
    } finally { setBusy(false); }
  };

  const updateRail = async (event) => {
    event.preventDefault();
    if (!rail || !railReason.trim()) return setError(t('adminRailReasonRequired'));
    const expectedEnabled = rail.enabled === true;
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/rail', { enabled: !expectedEnabled, expectedEnabled, reason: railReason.trim() });
      setRail(response.data?.rail || rail);
      setRailReason('');
      setNotice(response.data?.rail?.enabled ? t('adminRailEnabled') : t('adminRailSuspended'));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminRailStatusFailed')));
    } finally { setBusy(false); }
  };

  const triggerExternalReconciliation = async (event) => {
    event.preventDefault();
    if (!externalReconReason.trim()) return setError(t('adminRailReasonRequired'));
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/external-reconciliation', {
        currencyCode: externalReconCurrency !== 'all' ? externalReconCurrency : undefined,
        reason: externalReconReason.trim(),
      });
      const runs = response.data?.runs || [];
      setNotice(t('adminExternalReconciliationTriggered', { count: runs.length }));
      setExternalReconReason('');
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminExternalReconciliationFailed')));
    } finally { setBusy(false); }
  };

  const freezeRail = async (event) => {
    event.preventDefault();
    if (!railFreezeReason.trim()) return setError(t('adminRailReasonRequired'));
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/rail/freeze', { reason: railFreezeReason.trim() });
      setRail((current) => current ? { ...current, frozen: true, freeze: response.data?.freeze || current.freeze } : current);
      setRailFreezeReason('');
      setNotice(t('adminRailFrozen'));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminRailFreezeFailed')));
    } finally { setBusy(false); }
  };

  const unfreezeRail = async (event) => {
    event.preventDefault();
    if (!railFreezeReason.trim()) return setError(t('adminRailReasonRequired'));
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post('/admin/super/oxsteed-credit/rail/unfreeze', { reason: railFreezeReason.trim() });
      setRail((current) => current ? { ...current, frozen: false, freeze: null } : current);
      setRailFreezeReason('');
      setNotice(t('adminRailUnfrozen'));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminRailUnfreezeFailed')));
    } finally { setBusy(false); }
  };

  const retryNotification = async (notification) => {
    const reason = notificationRetryReason.trim();
    if (!reason) {
      setError(t('adminRetryNotificationReasonRequired'));
      return;
    }
    setRetryingNotificationId(notification.id); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/notifications/${notification.id}/retry`, { reason });
      setNotificationRetryReason('');
      setNotice(t('adminNotificationRequeued'));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminNotificationRetryFailed')));
    } finally { setRetryingNotificationId(''); }
  };

  // Phase 7 (gap 10): resolutions are now customer / merchant / rejected /
  // in-review. Only resolved_customer may carry compensationCents, which the
  // server posts as a compensating credit without touching journal history.
  const resolveDispute = async (dispute, status) => {
    const resolution = String(disputeResolutionDrafts[dispute.id] || '').trim();
    if (!resolution) {
      setError(t('adminDisputeResolutionRequired'));
      return;
    }
    const rawCompensation = String(disputeCompensationDrafts[dispute.id] ?? '').trim();
    const compensationCents = rawCompensation === '' ? 0 : Number.parseInt(rawCompensation, 10);
    if (status === 'resolved_customer' && (Number.isNaN(compensationCents) || compensationCents < 0)) {
      setError(t('adminDisputeCompensationInvalid'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/disputes/${dispute.id}/resolve`, {
        status,
        resolution: resolution || undefined,
        compensationCents: status === 'resolved_customer' ? compensationCents : undefined,
      });
      setNotice(t('adminDisputeStatusChanged', { id: dispute.id.slice(0, 8), status: localizeCreditStatus(status, t) }));
      setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: '' }));
      setDisputeCompensationDrafts((current) => ({ ...current, [dispute.id]: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminDisputeUpdateFailed')));
    } finally { setBusy(false); }
  };

  const decideCompliance = async (kind, item, decision) => {
    const reason = await requestDialog({
      kind: 'text',
      title: t('adminComplianceDecisionTitle', { decision }),
      description: t('adminComplianceDecisionDescription', { kind, id: String(item.id).slice(0, 8) }),
      label: t('adminRequiredAuditReason'),
    });
    if (!reason?.trim()) {
      setError(t('adminComplianceReasonRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      const endpoints = {
        verification: `/admin/super/oxsteed-credit/compliance/verifications/${item.id}/decision`,
        sanction: `/admin/super/oxsteed-credit/compliance/sanctions/${item.id}/decision`,
        case: `/admin/super/oxsteed-credit/compliance/cases/${item.id}/transition`,
      };
      const payload = kind === 'case' ? { toStatus: decision, reason: reason.trim() } : { decision, reason: reason.trim() };
      await adminApi.post(endpoints[kind], payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-compliance', { kind, id: item.id, decision }) } });
      idempotencyKeysRef.current.clear('credit-compliance', { kind, id: item.id, decision });
      setNotice(t('adminComplianceDecided', { kind, decision }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminComplianceDecisionFailed')));
    } finally { setBusy(false); }
  };

  const summary = overview?.summary || {};
  const summaryByCurrency = overview?.summaryByCurrency || [];
  const partnerCounts = overview?.partnerCounts || { total: partners.length, active: partners.filter((partner) => partner.status === 'active').length };
  const coverageAlerts = overview?.coverageAlerts || { pendingPartners: 0, activePartnersWithoutAgreement: 0, expiringAgreements: 0 };
  const notificationHealth = overview?.notificationHealth || { pending: 0, sending: 0, failed: 0, oldestPendingAt: null, backlogStale: false, backlogStaleAfterMinutes: 15, oldestFailedAt: null, failedNotifications: [], workerHeartbeat: {} };
  const workerHeartbeats = overview?.workerHeartbeats && typeof overview.workerHeartbeats === 'object'
    ? overview.workerHeartbeats
    : { [CREDIT_WORKER_NAMES[0]]: notificationHealth.workerHeartbeat || {} };
  const riskLimits = overview?.riskLimits || null;
  const currencyOptions = overview?.supportedCurrencies?.length ? overview.supportedCurrencies : DEFAULT_CURRENCY_OPTIONS;
  const filteredCustomerAccounts = customerAccounts;

  const applyCustomerAccountFilters = () => {
    setCustomerAccountQuery({
      search: customerAccountSearch.trim(),
      status: customerAccountStatus === 'all' ? '' : customerAccountStatus,
      currencyCode: customerAccountCurrency === 'all' ? '' : customerAccountCurrency,
      offset: 0,
    });
  };

  const applyPartnerDirectoryFilters = () => {
    setPartnerDirectoryQuery({
      search: partnerDirectorySearch.trim(),
      status: partnerDirectoryStatus === 'all' ? '' : partnerDirectoryStatus,
      offset: 0,
    });
  };

  const clearPartnerDirectoryFilters = () => {
    setPartnerDirectorySearch('');
    setPartnerDirectoryStatus('all');
    setPartnerDirectoryQuery({ search: '', status: '', offset: 0 });
  };

  const clearCustomerAccountFilters = () => {
    setCustomerAccountSearch('');
    setCustomerAccountStatus('all');
    setCustomerAccountCurrency('all');
    setCustomerAccountQuery({ search: '', status: '', currencyCode: '', offset: 0 });
  };

  const moveCustomerAccountPage = (offset) => {
    setCustomerAccountQuery((current) => ({ ...current, offset }));
  };

  const selectCustomerAccount = (account) => {
    setCustomerForm((current) => ({ ...current, customerId: account.customerId, currencyCode: account.currencyCode }));
    setAccountStatusForm((current) => ({ ...current, customerId: account.customerId, currencyCode: account.currencyCode }));
    setNotice(t('adminCustomerWalletSelected', { customer: account.name || account.email || t('adminCustomer'), currency: account.currencyCode }));
  };
  const inspectCustomerAccount = (account) => {
    selectCustomerAccount(account);
    setCustomerDetailAccount(account);
  };
  const inspectDisputeCustomer = async (dispute) => {
    const matchingAccount = customerAccounts.find((account) => account.customerId === dispute.customerId && (!dispute.currencyCode || account.currencyCode === dispute.currencyCode));
    if (matchingAccount) return inspectCustomerAccount(matchingAccount);
    setBusy(true); setError(''); setNotice('');
    try {
      const params = dispute.currencyCode ? { currencyCode: dispute.currencyCode } : undefined;
      const response = await adminApi.get(`/admin/super/oxsteed-credit/accounts/${dispute.customerId}`, { params });
      const account = response.data?.account;
      if (!account) throw new Error('Customer Credit wallet was not found.');
      inspectCustomerAccount(account);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCustomerProfileOpenFailed')));
    } finally { setBusy(false); }
  };
  const inspectTransaction = async (transaction) => {
    setRefundForm({ amount: '', reason: '' });
    setLoadingTransactionId(transaction.id);
    setError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/transactions/${transaction.id}`);
      setTransactionDetail(response.data?.transaction || null);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminTransactionDetailOpenFailed')));
    } finally {
      setLoadingTransactionId('');
    }
  };
  const refundAdminCredit = async (event) => {
    event.preventDefault();
    if (!transactionDetail?.id || transactionDetail.transactionType !== 'purchase' || transactionDetail.status !== 'posted') {
      setError(t('adminPostedPurchaseOnly'));
      return;
    }
    const amountCents = dollarsToCents(refundForm.amount, transactionDetail.currencyCode);
    const reason = String(refundForm.reason || '').trim();
    if (!amountCents) {
      setError(t('adminRefundAmountRequired', { currency: transactionDetail.currencyCode }));
      return;
    }
    if (!reason) {
      setError(t('adminRefundReasonRequired'));
      return;
    }
    const confirmed = await requestDialog({ kind: 'confirm', title: t('adminConfirmCreditRefund'), description: t('adminCreditRefundDescription', { amount: refundForm.amount, currency: transactionDetail.currencyCode }) });
    if (!confirmed) return;
    setBusy(true); setNotice(''); setError('');
    const payload = { amountCents, reason };
    const keyPayload = { transactionId: transactionDetail.id, ...payload };
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/transactions/${transactionDetail.id}/refund`, payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-refund', keyPayload) } });
      idempotencyKeysRef.current.clear('credit-refund', keyPayload);
      setRefundForm({ amount: '', reason: '' });
      // Phase 7 (gap 9): 202 means the refund queued as a pending action for
      // a second admin instead of posting immediately.
      setNotice(response.status === 202 ? t('adminMakerCheckerQueued') : (response.data?.replayed ? t('adminCreditRefundAlreadyRecorded') : t('adminCreditRefundPosted')));
      await inspectTransaction(transactionDetail);
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminCreditRefundFailed')));
    } finally { setBusy(false); }
  };
  const downloadTransactionHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (transactionType) params.transactionType = transactionType;
      if (transactionStatus) params.status = transactionStatus;
      if (transactionCurrency !== 'all') params.currencyCode = transactionCurrency;
      const response = await adminApi.get('/admin/super/oxsteed-credit/transactions.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminTransactionCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminTransactionCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadSettlementHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (settlementPartnerId) params.partnerId = settlementPartnerId;
      if (settlementStatus) params.status = settlementStatus;
      const response = await adminApi.get('/admin/super/oxsteed-credit/settlements.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminSettlementCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminSettlementCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadCustomerAccounts = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (customerAccountQuery.search) params.search = customerAccountQuery.search;
      if (customerAccountQuery.status) params.status = customerAccountQuery.status;
      if (customerAccountQuery.currencyCode) params.currencyCode = customerAccountQuery.currencyCode;
      const response = await adminApi.get('/admin/super/oxsteed-credit/accounts.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-customer-wallets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminWalletCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminWalletCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadAuditHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (auditActionType) params.actionType = auditActionType;
      if (auditResourceType) params.resourceType = auditResourceType;
      if (auditPartnerId) params.partnerId = auditPartnerId;
      if (auditCorrelationId) params.correlationId = auditCorrelationId;
      const response = await adminApi.get('/admin/super/oxsteed-credit/audit-events.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminAuditCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminAuditCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadDisputeHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (disputeStatus) params.status = disputeStatus;
      const response = await adminApi.get('/admin/super/oxsteed-credit/disputes.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-disputes-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminDisputeCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminDisputeCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadReconciliationHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = {};
      if (reconciliationStatus) params.status = reconciliationStatus;
      if (reconciliationCurrency !== 'all') params.currencyCode = reconciliationCurrency;
      const response = await adminApi.get('/admin/super/oxsteed-credit/reconciliation.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminReconciliationCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminReconciliationCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadPartnerDirectory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/partners.csv', { params: {}, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-partners-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminPartnerCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminPartnerCsvFailed')));
    } finally { setBusy(false); }
  };
  const downloadAgreementHistory = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/agreements.csv', { params: {}, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-agreements-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice(t('adminAgreementCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminAgreementCsvFailed')));
    } finally { setBusy(false); }
  };
  return <><AdminActionDialog dialog={dialog} onResolve={resolveDialog} /><AdminCreditTransactionDetail transaction={transactionDetail} onClose={() => { setTransactionDetail(null); setRefundForm({ amount: '', reason: '' }); }} onRefund={refundAdminCredit} refundForm={refundForm} setRefundForm={setRefundForm} busy={busy} /><main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
    <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-300">{t('adminSuperAdmin')}</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> {t('adminStoredValueControl')}</span></div><h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t('adminPageTitle')}</h1><p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">{t('adminPageDescription')}</p></div><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button></div></header>
    <section className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">{t('adminEmergencyControl')}</p><h2 className="mt-1 text-lg font-semibold text-white">{t('adminCreditRail')}</h2><p className="mt-1 text-xs leading-5 text-gray-400">{t('adminCreditRailDescription')}</p></div><Badge status={rail ? (rail.enabled ? 'enabled' : 'suspended') : 'unknown'} /></div>{rail?.frozen && <div role="alert" className="mt-4 flex flex-wrap items-start gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><Snowflake className="mt-0.5 h-4 w-4 shrink-0" /><div><strong>{t('adminRailFrozenBanner')}</strong><p className="mt-1 text-xs text-red-300/80">{t('adminRailFreezeReasonLabel')}: {rail.freeze?.reason || t('adminUnknown')}</p>{rail.freeze?.incidentRef && <p className="mt-1 font-mono text-[11px] text-red-300/70">{rail.freeze.incidentRef}</p>}<p className="mt-1 text-[11px] text-red-300/70">{t('adminRailFrozenAt')} {dateTime(rail.freeze?.frozenAt)}</p></div></div>}<form onSubmit={rail?.frozen ? unfreezeRail : freezeRail} className="mt-4 flex flex-col gap-3 border-t border-amber-500/15 pt-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredAuditReason')}</span><input value={railFreezeReason} onChange={(event) => setRailFreezeReason(event.target.value)} maxLength={1000} placeholder={rail?.frozen ? t('adminUnfreezeRailPlaceholder') : t('adminFreezeRailPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={!rail || busy || !railFreezeReason.trim()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${rail?.frozen ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}><Snowflake className="h-4 w-4" />{rail?.frozen ? t('adminUnfreezeRail') : t('adminFreezeRail')}</button></form><form onSubmit={updateRail} className="mt-4 flex flex-col gap-3 border-t border-amber-500/15 pt-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredAuditReason')}</span><input value={railReason} onChange={(event) => setRailReason(event.target.value)} maxLength={1000} placeholder={rail?.enabled ? t('adminSuspendRailPlaceholder') : t('adminEnableRailPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={!rail || busy || !railReason.trim()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${rail?.enabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}><Power className="h-4 w-4" />{rail?.enabled ? t('adminSuspendRail') : t('adminEnableRail')}</button></form></section>
    {rail?.prerequisites && <CreditRailPrerequisites prerequisites={rail.prerequisites} />}
    {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
    {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
    <CreditWorkerHealth heartbeats={workerHeartbeats} />
    <Section eyebrow="Audit history controls" title="Search the Credit control trail" detail="Filter the append-only control history before reviewing state changes. Results are bounded and can be loaded in older pages without downloading the entire ledger."
      action={auditPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendAuditEvents: true, auditOffset: auditPagination.nextOffset || 0 })} disabled={loadingMoreAuditEvents || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreAuditEvents ? 'Loading...' : 'Load older audit events'}</button>}
    >
      <div className="mt-4 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminAction')}</span><input aria-label={t('adminAction')} value={auditActionType} onChange={(event) => setAuditActionType(event.target.value)} placeholder="credit.rail.suspended" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminResource')}</span><input aria-label={t('adminResource')} value={auditResourceType} onChange={(event) => setAuditResourceType(event.target.value)} placeholder="credit_transaction" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPartner')}</span><select aria-label={t('adminPartner')} value={auditPartnerId} onChange={(event) => setAuditPartnerId(event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllPartners')}</option>{partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminPartnerFallback', { id: partner.partnerId })}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequestCorrelation')}</span><input aria-label={t('adminRequestCorrelation')} value={auditCorrelationId} onChange={(event) => setAuditCorrelationId(event.target.value)} placeholder="request-id-from-logs" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
      </div>
      <p className="mt-2 text-[11px] text-gray-600">{t('adminShowingLoadedEvents', { count: auditEvents.length })}{auditPagination.hasMore ? ` · ${t('adminOlderEventsAvailable')}` : ''}</p>
    </Section>
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={WalletCards} label={t('adminCustomerBalance', { currency: summary.currencyCode || 'USD' })} value={money(summary.customerBalanceCents, summary.currencyCode)} detail={t('adminCustomerAccounts', { count: summary.customerAccounts || 0 })} /><Metric icon={CreditCard} label={t('adminAvailableBalance', { currency: summary.currencyCode || 'USD' })} value={money(summary.customerAvailableCents, summary.currencyCode)} detail={`${money(summary.customerReservedCents, summary.currencyCode)} ${t('adminReserved')}`} tone="text-emerald-300" /><Metric icon={Store} label={t('adminPartnerPayable', { currency: summary.currencyCode || 'USD' })} value={money(summary.partnerPayableCents, summary.currencyCode)} detail={t('adminPartnerAccounts', { count: summary.partnerAccounts || 0 })} tone="text-sky-300" /><Metric icon={FileCheck2} label={t('adminPartnerNetwork')} value={partnerCounts.total} detail={t('adminActivePartners', { count: partnerCounts.active })} /><Metric icon={AlertTriangle} label={t('adminInactiveAccounts')} value={summary.inactiveAccounts || 0} detail={t('adminNeedsReviewBeforeSpending')} tone="text-amber-300" /></section>
    <Section eyebrow="Coverage watch" title="Partner agreement health" detail="These counts are calculated across the full partner network, not just the first page. Resolve coverage gaps before customers are told they can spend Credit at a restaurant."><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-xl border p-4 ${coverageAlerts.activePartnersWithoutAgreement ? 'border-red-500/30 bg-red-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminActivePartnersWithoutAgreement')}</p><strong className={`mt-2 block text-2xl ${coverageAlerts.activePartnersWithoutAgreement ? 'text-red-300' : 'text-emerald-300'}`}>{coverageAlerts.activePartnersWithoutAgreement}</strong><p className="mt-1 text-xs text-gray-600">{t('adminNotEligibleForSpending')}</p></div><div className={`rounded-xl border p-4 ${coverageAlerts.expiringAgreements ? 'border-amber-500/30 bg-amber-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminAgreementsExpiring30Days')}</p><strong className={`mt-2 block text-2xl ${coverageAlerts.expiringAgreements ? 'text-amber-300' : 'text-emerald-300'}`}>{coverageAlerts.expiringAgreements}</strong><p className="mt-1 text-xs text-gray-600">{t('adminReviewRenewals')}</p></div><div className={`rounded-xl border p-4 ${coverageAlerts.pendingPartners ? 'border-sky-500/30 bg-sky-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminPartnersPendingActivation')}</p><strong className={`mt-2 block text-2xl ${coverageAlerts.pendingPartners ? 'text-sky-300' : 'text-emerald-300'}`}>{coverageAlerts.pendingPartners}</strong><p className="mt-1 text-xs text-gray-600">{t('adminConfirmCommercialTerms')}</p></div></div></Section>
    <Section eyebrow="Delivery watch" title="Credit customer notifications" detail="Ledger changes commit independently from notification delivery. Use this view to catch delivery backlog or terminal failures without changing customer balances."><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-xl border p-4 ${notificationHealth.backlogStale ? 'border-red-500/40 bg-red-950/20' : notificationHealth.pending || notificationHealth.sending ? 'border-sky-500/30 bg-sky-950/20' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminQueuedSending')}</p><BellRing className={`h-4 w-4 ${notificationHealth.backlogStale ? 'text-red-300' : 'text-sky-300'}`} /></div><strong className={`mt-2 block text-2xl ${notificationHealth.backlogStale ? 'text-red-300' : 'text-sky-300'}`}>{notificationHealth.pending + notificationHealth.sending}</strong><p className={`mt-1 text-xs ${notificationHealth.backlogStale ? 'text-red-200' : 'text-gray-600'}`}>{notificationHealth.backlogStale ? t('adminDeliveryBacklogThreshold', { minutes: notificationHealth.backlogStaleAfterMinutes || 15 }) : t('adminQueuedInFlight', { queued: notificationHealth.pending, inFlight: notificationHealth.sending })}{notificationHealth.oldestPendingAt ? ` · ${t('adminOldest')} ${dateTime(notificationHealth.oldestPendingAt)}` : ''}</p></div><div className={`rounded-xl border p-4 ${notificationHealth.failed ? 'border-red-500/30 bg-red-950/20' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminTerminalFailures')}</p><AlertTriangle className={`h-4 w-4 ${notificationHealth.failed ? 'text-red-300' : 'text-emerald-300'}`} /></div><strong className={`mt-2 block text-2xl ${notificationHealth.failed ? 'text-red-300' : 'text-emerald-300'}`}>{notificationHealth.failed}</strong><p className="mt-1 text-xs text-gray-600">{notificationHealth.oldestFailedAt ? `${t('adminOldest')} ${dateTime(notificationHealth.oldestFailedAt)}` : t('adminNoTerminalDeliveryFailures')}</p></div><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminDeliveryContract')}</p><strong className="mt-2 block text-lg text-white">{t('adminDurableOutbox')}</strong><p className="mt-1 text-xs text-gray-600">{t('adminDeliveryContractDescription')}</p></div></div>{notificationHealth.failedNotifications?.length > 0 && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-950/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-red-200">{t('adminFailedDeliveriesAttention')}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{t('adminRetryOnlyRequeues')}</p></div><label className="min-w-[240px] flex-1"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{t('adminRetryReason')}</span><input value={notificationRetryReason} onChange={(event) => setNotificationRetryReason(event.target.value)} maxLength={1000} placeholder={t('adminRetryReasonPlaceholder')} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-xs text-white outline-none focus:border-orange-400" /></label></div><div className="mt-4 space-y-2">{notificationHealth.failedNotifications.map((notification) => <article key={notification.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-white">{creditNotificationLabel(notification, t)}</strong><span className="font-mono text-[10px] text-gray-600">{notification.id}</span></div><p className="mt-1 text-[11px] text-gray-500">{t('adminNotificationAttempts', { count: notification.attempts })} · {t('adminNotificationRecipient', { id: notification.userId || t('adminUnknown') })} · {dateTime(notification.updatedAt || notification.createdAt)}</p>{notification.lastError && <p className="mt-1 break-words text-[11px] text-red-300">{notification.lastError}</p>}</div><button type="button" onClick={() => retryNotification(notification)} disabled={busy || retryingNotificationId === notification.id || !notificationRetryReason.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${retryingNotificationId === notification.id ? 'animate-spin' : ''}`} />{retryingNotificationId === notification.id ? t('adminRequeuing') : t('adminRetryDelivery')}</button></article>)}</div></div>}</Section>
    {summaryByCurrency.length > 1 && <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminCurrencyControls')}</p><h2 className="mt-1 text-lg font-semibold text-white">{t('adminBalancesByCurrency')}</h2></div><span className="text-xs text-gray-500">{t('adminNoAutomaticFx')}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaryByCurrency.map((currencySummary) => <div key={currencySummary.currencyCode} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{currencySummary.currencyCode}</strong><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminWallets', { count: currencySummary.customerAccounts || 0 })}</span></div><p className="mt-2 text-lg font-semibold text-emerald-300">{money(currencySummary.customerAvailableCents, currencySummary.currencyCode)}</p><p className="mt-1 text-xs text-gray-500">{t('adminCustomerAvailable')} · {money(currencySummary.partnerPayableCents, currencySummary.currencyCode)} {t('adminPartnerPayableShort')}</p></div>)}</div></section>}
    <Section eyebrow={t('adminLedgerActivity')} title={t('adminTransactionHistory')} detail={t('adminTransactionHistoryDescription')} action={<button type="button" onClick={downloadTransactionHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}>
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3">
        <label className="min-w-[160px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminMovementType')}</span><select aria-label={t('adminMovementTypeFilter')} value={transactionType} onChange={(event) => setTransactionType(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllMovementTypes')}</option><option value="load">{t('adminLoad')}</option><option value="purchase">{t('adminPurchase')}</option><option value="refund">{t('adminRefund')}</option><option value="transfer">{t('adminTransfer')}</option><option value="adjustment">{t('adminAdjustment')}</option><option value="settlement">{t('adminSettlement')}</option><option value="fee">{t('adminFee')}</option><option value="expiration">{t('adminExpiration')}</option><option value="chargeback">{t('adminChargeback')}</option></select></label>
        <label className="min-w-[150px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminStatus')}</span><select aria-label={t('adminStatusFilter')} value={transactionStatus} onChange={(event) => setTransactionStatus(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllStatuses')}</option><option value="pending">{t('adminPendingStatus')}</option><option value="posted">{t('adminPostedStatus')}</option><option value="reversed">{t('adminReversedStatus')}</option><option value="voided">{t('adminVoidedStatus')}</option></select></label>
        <label className="min-w-[140px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrency')}</span><select aria-label={t('adminCurrencyFilter')} value={transactionCurrency} onChange={(event) => setTransactionCurrency(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">{t('adminAllCurrencies')}</option>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        {transactionPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendTransactions: true, transactionOffset: transactionPagination.nextOffset || 0 })} disabled={loadingMoreTransactions || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreTransactions ? t('adminLoading') : t('adminLoadOlder')}</button>}
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
        {!transactions.length ? <div className="py-10 text-center text-sm text-gray-500">{t('adminNoCreditMovements')}</div> : <table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminTransaction')}</th><th className="px-3 py-3 font-medium">{t('adminRestaurantParty')}</th><th className="px-3 py-3 font-medium">{t('adminReference')}</th><th className="px-3 py-3 font-medium">{t('adminAmount')}</th><th className="px-3 py-3 font-medium">{t('adminStatus')}</th><th className="px-3 py-3 font-medium">{t('adminWhen')}</th><th className="px-3 py-3 font-medium">{t('adminInspect')}</th></tr></thead><tbody className="divide-y divide-gray-800">{transactions.map((transaction) => <tr key={transaction.id}><td className="px-3 py-3"><strong className="capitalize text-white">{creditTransactionLabel(transaction, t)}</strong><p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.id}</p>{transaction.direction && <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-gray-600">{t('adminDirectionAccount', { direction: transaction.direction })}</span>}</td><td className="max-w-[260px] break-all px-3 py-3 text-gray-400">{transaction.restaurantName || t('adminPlatformMovement')}<p className="mt-1 text-[10px] text-gray-600">{transactionPartyLabel(transaction, t)}</p></td><td className="max-w-[240px] break-all px-3 py-3 text-gray-500">{transaction.referenceType || t('adminNoReference')}{transaction.referenceId ? <p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.referenceId}</p> : null}{transaction.description ? <p className="mt-1 text-[10px] text-gray-600">{transaction.description}</p> : null}</td><td className="px-3 py-3 font-semibold text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</td><td className="px-3 py-3"><Badge status={transaction.status} /></td><td className="px-3 py-3 text-gray-500">{dateTime(transaction.postedAt || transaction.createdAt)}</td><td className="px-3 py-3"><button type="button" onClick={() => inspectTransaction(transaction)} disabled={busy || Boolean(loadingTransactionId)} className="rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingTransactionId === transaction.id ? t('adminLoading') : t('adminOpen')}</button></td></tr>)}</tbody></table>}
      </div>
    </Section>
    {riskLimits && <Section eyebrow={t('adminRiskGuardrails')} title={t('adminFundingSpendingTransferLimits')} detail={t('adminRiskGuardrailsDescription')}><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">{t('adminPerTransaction')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTransactionCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminHardCapOneMovement')}</span></div><div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">{t('adminPerCustomerWallet')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxCustomerBalanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminMaxOutstandingBalance')}</span></div><div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">{t('adminGlobalOutstanding')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTotalIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminAllCustomerWalletsPerCurrency')}</span></div><div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">{t('adminDailyFunding')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminLoadsGrantsPerCustomer')}</span></div><div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{t('adminDailySpending')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerSpendCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminAcrossPartnerRestaurants')}</span></div><div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">{t('adminSpendMovements')}</span><strong className="mt-2 block text-lg text-white">{Number(riskLimits.maxDailyCustomerSpendCount || 0)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminPurchasesActiveHoldsPerDay')}</span></div><div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">{t('adminDailyTransfers')}</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerTransferCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminOutboundCustomerTransfers')}</span></div><div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">{t('adminTransferMovements')}</span><strong className="mt-2 block text-lg text-white">{Number(riskLimits.maxDailyCustomerTransferCount || 0)}</strong><span className="mt-1 block text-xs text-gray-500">{t('adminOutboundTransfersPerDay')}</span></div></div></Section>}

    <Section eyebrow={t('adminCustomerWallets')} title={t('adminFindWalletBeforeAction')} detail={t('adminCustomerWalletSearchDescription')} action={<button type="button" onClick={downloadCustomerAccounts} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}><div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]"><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSearchWallets')}</span><input value={customerAccountSearch} onChange={(event) => setCustomerAccountSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyCustomerAccountFilters(); }} placeholder={t('adminWalletSearchPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminAccountState')}</span><select value={customerAccountStatus} onChange={(event) => setCustomerAccountStatus(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="all">{t('adminAllStates')}</option><option value="active">{t('adminActive')}</option><option value="suspended">{t('adminSuspended')}</option><option value="closed">{t('adminClosed')}</option></select></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCurrency')}</span><select value={customerAccountCurrency} onChange={(event) => setCustomerAccountCurrency(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="all">{t('adminAllCurrencies')}</option>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-gray-500">{t('adminShowingMatchingWallets', { start: customerAccounts.length ? customerAccountOffset + 1 : 0, end: customerAccountOffset + customerAccounts.length, total: customerAccountTotal })}</div><div className="flex flex-wrap gap-2"><button type="button" onClick={applyCustomerAccountFilters} disabled={loading || busy} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminApplyFilters')}</button><button type="button" onClick={clearCustomerAccountFilters} disabled={loading || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('adminClear')}</button><button type="button" onClick={() => moveCustomerAccountPage(Math.max(0, customerAccountOffset - CUSTOMER_ACCOUNT_PAGE_SIZE))} disabled={loading || busy || customerAccountOffset === 0} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('adminPrevious')}</button><button type="button" onClick={() => moveCustomerAccountPage(customerAccountOffset + CUSTOMER_ACCOUNT_PAGE_SIZE)} disabled={loading || busy || !customerAccountHasMore} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('adminNext')}</button></div></div><div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1060px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminCurrency')}</th><th className="px-3 py-3 font-medium">{t('adminBalance')}</th><th className="px-3 py-3 font-medium">{t('adminAvailable')}</th><th className="px-3 py-3 font-medium">{t('adminState')}</th><th className="px-3 py-3 font-medium">{t('adminUpdated')}</th><th className="px-3 py-3 font-medium">{t('adminAction')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!filteredCustomerAccounts.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminNoCustomerWalletsMatch')}</td></tr> : filteredCustomerAccounts.map((account) => <tr key={account.accountId}><td className="px-3 py-3"><strong className="text-white">{account.name || t('adminUnnamedCustomer')}</strong><p className="mt-1 text-gray-500">{account.email || t('adminNoEmail')} </p><p className="mt-1 font-mono text-[10px] text-gray-700">{account.customerId}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{account.currencyCode}</td><td className="px-3 py-3 text-gray-300">{money(account.balanceCents, account.currencyCode)}</td><td className="px-3 py-3 text-emerald-300">{money(account.availableBalanceCents, account.currencyCode)}</td><td className="px-3 py-3"><Badge status={account.status} />{account.isBanned && <p className="mt-1 text-[10px] text-red-300">{t('adminPlatformBanned')}</p>}</td><td className="px-3 py-3 text-gray-500">{dateTime(account.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => inspectCustomerAccount(account)} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminViewDetails')}</button><button type="button" disabled={busy} onClick={() => selectCustomerAccount(account)} className="rounded-lg border border-gray-700 px-2.5 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('adminUseWallet')}</button></div></td></tr>)}</tbody></table></div></div></Section>

    {customerDetailAccount && <OxsteedCreditCustomerDetail account={customerDetailAccount} busy={busy} onClose={() => setCustomerDetailAccount(null)} />}

    <Section eyebrow={t('adminCustomerControls')} title={t('adminGrantAdjustFreezeCredit')} detail={t('adminCustomerControlsDescription')}><div className="mt-5 grid gap-6 xl:grid-cols-3"><form onSubmit={loadCustomerCredit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">{t('adminGrantCredit')}</h3><input required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} placeholder={t('adminCustomerUuidPlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required inputMode="decimal" value={customerForm.amount} onChange={(event) => setCustomerForm({ ...customerForm, amount: event.target.value })} placeholder={t('adminAmountLocalCurrencyPlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={customerForm.currencyCode} onChange={(event) => setCustomerForm({ ...customerForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><input required value={customerForm.fundingReference} onChange={(event) => setCustomerForm({ ...customerForm, fundingReference: event.target.value })} placeholder={t('adminFundingReferencePlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required value={customerForm.reason} onChange={(event) => setCustomerForm({ ...customerForm, reason: event.target.value })} placeholder={t('adminReasonInputPlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminPostGrant')}</button></form><form onSubmit={adjustCustomerCredit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">{t('adminClawBackCredit')}</h3><input required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} placeholder={t('adminCustomerUuidPlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required inputMode="decimal" value={customerForm.amount} onChange={(event) => setCustomerForm({ ...customerForm, amount: event.target.value })} placeholder={t('adminAmountLocalCurrencyPlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={customerForm.currencyCode} onChange={(event) => setCustomerForm({ ...customerForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><input required value={customerForm.reason} onChange={(event) => setCustomerForm({ ...customerForm, reason: event.target.value })} placeholder={t('adminReasonForClawback')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><span className="text-xs leading-5 text-gray-600">{t('adminSharedCustomerFields')}</span><button disabled={busy} className="rounded-xl border border-amber-500/40 px-4 py-3 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminPostClawback')}</button></form><form onSubmit={updateAccountStatus} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">{t('adminAccountSafetyState')}</h3><input required value={accountStatusForm.customerId} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, customerId: event.target.value })} placeholder={t('adminCustomerUuidPlaceholder')} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={accountStatusForm.currencyCode} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><select value={accountStatusForm.status} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, status: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="active">{t('adminActive')}</option><option value="suspended">{t('adminSuspended')}</option><option value="closed">{t('adminClosed')}</option></select><input required value={accountStatusForm.reason} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, reason: event.target.value })} placeholder={t('adminReasonInputPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><button disabled={busy} className="rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminUpdateAccountState')}</button></form></div></Section>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="col-span-full rounded-2xl border border-sky-500/20 bg-sky-950/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">{t('adminPartnerLookup')}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{t('adminFindEnrolledRestaurant')}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{t('adminPartnerLookupDescription')}</p>
          </div>
          <span className="rounded-full border border-gray-700 bg-gray-950/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">{partnerPickerQuery ? t('adminPartnerPickerMatches', { count: partnerPickerTotal }) : t('adminPartnerPickerLoaded', { count: partners.length })}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSearchRestaurantOrId')}</span>
            <input value={partnerPickerSearch} onChange={(event) => setPartnerPickerSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyPartnerPickerSearch(); }} placeholder={t('adminPartnerPickerPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400" />
          </label>
          <button type="button" onClick={applyPartnerPickerSearch} disabled={loadingPartnerOptions || loading || busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{loadingPartnerOptions ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t('adminFindPartners')}</button>
          {partnerPickerQuery && <button type="button" onClick={clearPartnerPickerSearch} disabled={loadingPartnerOptions || loading || busy} className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('adminClearLookup')}</button>}
        </div>
        {partnerOptionsError && <div role="alert" aria-live="polite" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs font-semibold text-red-300"><span>{partnerOptionsError}</span><button type="button" onClick={() => loadPartnerOptions(partnerPickerQuery)} disabled={loadingPartnerOptions || loading || busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryLookup')}</button></div>}
        <p className="mt-3 text-[11px] text-gray-600">{partnerPickerQuery ? t('adminPartnerPickerQuerySummary', { count: partnerOptions.length }) : t('adminPartnerPickerSummary')}</p>
      </div>
    <Section eyebrow="Partner enrollment" title="Add a restaurant partner" detail="Enrollment starts as Pending. Activate only after confirming commercial terms, settlement, and customer eligibility."><form onSubmit={registerPartner} className="mt-5 grid gap-3 sm:grid-cols-3"><label className="sm:col-span-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRestaurantId')}</span><input required value={partnerForm.restaurantId} onChange={(event) => setPartnerForm({ ...partnerForm, restaurantId: event.target.value })} placeholder={t('adminRestaurantIdPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminSettlementCurrency')}</span><select required value={partnerForm.settlementCurrencyCode} onChange={(event) => setPartnerForm({ ...partnerForm, settlementCurrencyCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">{t('adminSelectCurrency')}</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><label className="sm:col-span-3"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminInternalNotes')}</span><textarea value={partnerForm.notes} onChange={(event) => setPartnerForm({ ...partnerForm, notes: event.target.value })} rows={2} placeholder={t('adminSettlementPartnershipNotes')} className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label className="sm:col-span-3"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminEnrollmentReason')}</span><input required maxLength={1000} value={partnerForm.reason} onChange={(event) => setPartnerForm({ ...partnerForm, reason: event.target.value })} placeholder={t('adminEnrollmentReasonPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"><Plus className="h-4 w-4" /> {t('adminEnrollPartner')}</button></form></Section>
    <Section eyebrow="Agreement builder" title="Create a spending agreement" detail="Draft the restaurant's rules first. It must be approved and activated before customer checkout can use it.">
      <form onSubmit={createAgreement} className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPartner')}</span>
          <select required value={agreementForm.partnerId} onChange={(event) => setAgreementForm({ ...agreementForm, partnerId: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">{t('adminSelectPartner')}</option>
            {selectablePartners.filter((partner) => partner.status !== 'terminated').map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminRestaurantFallback', { id: partner.restaurantId })} · {localizeCreditStatus(partner.status, t)}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminStarts')}</span>
          <input required type="datetime-local" value={agreementForm.startsAt} onChange={(event) => setAgreementForm({ ...agreementForm, startsAt: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminEndsOptional')}</span>
          <input type="datetime-local" value={agreementForm.endsAt} onChange={(event) => setAgreementForm({ ...agreementForm, endsAt: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminOrderTypes')}</span>
          <input value={agreementForm.allowedOrderTypes} onChange={(event) => setAgreementForm({ ...agreementForm, allowedOrderTypes: event.target.value })} placeholder={t('adminOrderTypesPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCategoriesOptional')}</span>
          <input value={agreementForm.allowedCategories} onChange={(event) => setAgreementForm({ ...agreementForm, allowedCategories: event.target.value })} placeholder={t('adminLeaveBlankForAll')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <fieldset className="sm:col-span-2 rounded-xl border border-gray-800 bg-gray-950/40 p-3">
          <legend className="px-1 text-xs font-semibold text-gray-400">{t('adminOptionalMenuRestrictions')}</legend>
          <p className="mb-3 text-xs leading-5 text-gray-600">{t('adminMenuRestrictionDescription')}</p>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminAllowedMenuItemIds')}</span>
            <input value={agreementForm.allowedMenuItemIds} onChange={(event) => setAgreementForm({ ...agreementForm, allowedMenuItemIds: event.target.value })} placeholder={t('adminAllowedMenuItemIdsPlaceholder')} inputMode="numeric" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
        </fieldset>
        <fieldset className="sm:col-span-2 rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
          <legend className="px-1 text-xs font-semibold text-sky-300">{t('adminGeographicCoverage')}</legend>
          <p className="mb-3 text-xs leading-5 text-gray-500">{t('adminGeographicCoverageDescription')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCities')}</span>
              <input value={agreementForm.coverageCities} onChange={(event) => setAgreementForm({ ...agreementForm, coverageCities: event.target.value })} placeholder={t('adminCoverageCitiesPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminStatesRegions')}</span>
              <input value={agreementForm.coverageStates} onChange={(event) => setAgreementForm({ ...agreementForm, coverageStates: event.target.value })} placeholder={t('adminCoverageStatesPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPostalCodes')}</span>
              <input value={agreementForm.coveragePostalCodes} onChange={(event) => setAgreementForm({ ...agreementForm, coveragePostalCodes: event.target.value })} placeholder={t('adminCoveragePostalCodesPlaceholder')} inputMode="numeric" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCountries')}</span>
              <input value={agreementForm.coverageCountries} onChange={(event) => setAgreementForm({ ...agreementForm, coverageCountries: event.target.value })} placeholder={t('adminCoverageCountriesPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
          </div>
        </fieldset>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminCustomerTerms')}</span>
          <textarea value={agreementForm.customerTerms} onChange={(event) => setAgreementForm({ ...agreementForm, customerTerms: event.target.value })} rows={2} placeholder={t('adminAgreementCustomerTermsPlaceholder')} className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReasonForAgreement')}</span>
          <input required maxLength={1000} value={agreementForm.reason} onChange={(event) => setAgreementForm({ ...agreementForm, reason: event.target.value })} placeholder={t('adminAgreementReasonPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminMaxPerTransaction')}</span>
            <input inputMode="decimal" value={agreementForm.maxTransaction} onChange={(event) => setAgreementForm({ ...agreementForm, maxTransaction: event.target.value })} placeholder={t('adminOptional')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminDailyPerCustomer')}</span>
            <input inputMode="decimal" value={agreementForm.dailyLimit} onChange={(event) => setAgreementForm({ ...agreementForm, dailyLimit: event.target.value })} placeholder={t('adminOptional')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminLifetimePerCustomer')}</span>
            <input inputMode="decimal" value={agreementForm.lifetimeLimit} onChange={(event) => setAgreementForm({ ...agreementForm, lifetimeLimit: event.target.value })} placeholder={t('adminOptional')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
        </div>
        <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
          <input type="checkbox" checked={agreementForm.requiresCustomerEntitlement} onChange={(event) => setAgreementForm({ ...agreementForm, requiresCustomerEntitlement: event.target.checked })} className="mt-1 h-4 w-4 accent-sky-500" />
          <span><strong className="block text-sm text-white">{t('adminRestrictAssignedCustomers')}</strong><span className="mt-1 block text-xs leading-5 text-gray-500">{t('adminRestrictAssignedCustomersDescription')}</span></span>
        </label>
        <button disabled={busy || !selectablePartners.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> {t('adminCreateDraftAgreement')}</button>
      </form>
    </Section>
    </div>

    <OxsteedCreditPartnerLedger partners={selectablePartners} currencyOptions={currencyOptions} busy={busy} onError={setError} onNotice={setNotice} />

    <Section eyebrow="Partner network" title="Restaurants and agreements" detail="A partner must be Active and have an Active agreement before it appears in customer eligibility results." action={<div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="credit-partner-directory-search">{t('adminSearchPartners')}</label><input id="credit-partner-directory-search" value={partnerDirectorySearch} onChange={(event) => setPartnerDirectorySearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyPartnerDirectoryFilters(); }} placeholder={t('adminSearchPartnersPlaceholder')} className="w-40 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /><select aria-label={t('adminPartnerStatusFilter')} value={partnerDirectoryStatus} onChange={(event) => setPartnerDirectoryStatus(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">{t('adminAllStatuses')}</option><option value="pending">{t('statusPending')}</option><option value="active">{t('statusActive')}</option><option value="suspended">{t('statusSuspended')}</option><option value="terminated">{t('statusTerminated')}</option></select><button type="button" onClick={applyPartnerDirectoryFilters} disabled={loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{t('adminApply')}</button><button type="button" onClick={clearPartnerDirectoryFilters} disabled={loading || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">{t('adminClear')}</button><button type="button" onClick={downloadPartnerDirectory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button></div>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{loading && !overview ? <div className="flex items-center justify-center py-14 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminCurrency')}</th><th className="px-3 py-3 font-medium">{t('adminPartner')}</th><th className="px-3 py-3 font-medium">{t('adminAgreements')}</th><th className="px-3 py-3 font-medium">{t('adminUpdated')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!partnerDirectory.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{partnerDirectoryQuery.search || partnerDirectoryQuery.status ? t('adminNoPartnerFilterMatches') : t('adminNoPartnersEnrolled')}</td></tr> : partnerDirectory.map((partner) => <tr key={partner.partnerId}><td className="px-3 py-3"><strong className="text-white">{partner.restaurantName || t('adminRestaurantFallback', { id: partner.restaurantId })}</strong><p className="mt-1 text-gray-600">{t('adminRestaurantIdValue', { id: partner.restaurantId })}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{partner.settlementCurrencyCode || 'USD'}</td><td className="px-3 py-3"><Badge status={partner.status} /></td><td className="px-3 py-3 text-gray-400">{t('adminActiveOfTotal', { active: partner.activeAgreementCount, total: partner.agreementCount })}</td><td className="px-3 py-3 text-gray-500">{dateTime(partner.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{partner.status === 'pending' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminActivate')}</button>}{partner.status === 'active' && <button disabled={busy} onClick={() => transitionPartner(partner, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminSuspend')}</button>}{partner.status === 'suspended' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminReactivate')}</button>}</div></td></tr>)}</tbody></table>}</div>{partnerDirectoryPagination.hasMore && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-3 py-3 text-xs text-gray-500"><span>{t('adminShowingPartners', { shown: partnerDirectory.length, total: partnerDirectoryPagination.total })}</span><button type="button" onClick={() => load({ quiet: true, appendPartnerDirectory: true, partnerDirectoryOffset: partnerDirectoryPagination.nextOffset || 0 })} disabled={loadingMorePartnerDirectory || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMorePartnerDirectory ? t('adminLoading') : t('adminLoadMorePartners')}</button></div>}{!partnerDirectoryPagination.hasMore && partnerDirectory.length > 0 && <p className="mt-3 text-xs text-gray-600">{t('adminShowingAllPartners', { total: partnerDirectoryPagination.total })}</p>}</Section>

    <Section eyebrow="Agreement lifecycle" title="Active and pending terms" detail="Use lifecycle transitions instead of deleting agreements so the historical record remains intact." action={<button type="button" onClick={downloadAgreementHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{!agreements.length ? <div className="py-14 text-center text-sm text-gray-500">{t('adminNoAgreementsCreated')}</div> : <table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminVersion')}</th><th className="px-3 py-3 font-medium">{t('adminLifecycle')}</th><th className="px-3 py-3 font-medium">{t('adminCoverage')}</th><th className="px-3 py-3 font-medium">{t('adminLimits')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{agreements.map((agreement) => <tr key={agreement.id}><td className="px-3 py-3 text-white">{agreement.restaurantName || t('adminPartnerRestaurant')}<p className="mt-1 text-gray-600">{dateTime(agreement.startsAt)}{agreement.endsAt ? ` ${t('adminTo')} ${dateTime(agreement.endsAt)}` : ''}</p></td><td className="px-3 py-3 text-gray-400">{t('adminAgreementVersion', { version: agreement.version })}</td><td className="px-3 py-3"><Badge status={agreement.status} /></td><td className="max-w-[240px] px-3 py-3 text-gray-400">{agreement.requiresCustomerEntitlement ? <p className="font-semibold text-amber-300">{t('adminAssignedCustomersOnly')}</p> : <p className="font-semibold text-emerald-300">{t('adminPartnerWide')}</p>}{localizeCreditOrderTypes(agreement.allowedOrderTypes, t) || t('adminNoOrderTypesSet')}{agreement.allowedCategories?.length ? <p className="mt-1 text-gray-600">{agreement.allowedCategories.join(', ')}</p> : null}{agreement.allowedMenuItemIds?.length ? <p className="mt-1 text-gray-600">{t('adminMenuItemsRestricted', { count: agreement.allowedMenuItemIds.length })}</p> : null}{geographyLabel(agreement.geography, t) ? <p className="mt-1 break-words text-sky-300">{geographyLabel(agreement.geography, t)}</p> : <p className="mt-1 text-gray-600">{t('adminAllRestaurantLocations')}</p>}</td><td className="px-3 py-3 text-gray-400"><span className="font-semibold text-sky-300">{agreement.settlementCurrencyCode || 'USD'}</span><br />{agreement.maxTransactionCents ? money(agreement.maxTransactionCents, agreement.settlementCurrencyCode) : t('adminNoPerTransactionCap')}{agreement.dailyCustomerLimitCents ? <p className="mt-1 text-gray-600">{t('adminDailyAmount', { amount: money(agreement.dailyCustomerLimitCents, agreement.settlementCurrencyCode) })}</p> : null}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{agreement.status === 'draft' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'pending_approval')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminSubmitAgreement')}</button>}{agreement.status === 'pending_approval' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApproveActivate')}</button>}{agreement.status === 'active' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminSuspend')}</button>}{agreement.status === 'suspended' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminReactivate')}</button>}</div></td></tr>)}</tbody></table>}</div></Section>

    <OxsteedCreditEntitlements agreements={agreements} customerAccounts={customerAccounts} currencyMetadata={overview?.currencyMetadata} busy={busy} />

    <OxsteedCreditCards currencyOptions={currencyOptions} busy={busy} />

    <OxsteedCreditMoneyOut busy={busy} />

    <SettlementEvidence settlements={settlements} />

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-[#111318] p-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSettlementQueue')}</p>
      <p className="mt-1 text-xs text-gray-500">{t('adminSettlementQueueDescription')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <span>{t('adminPartner')}</span>
          <select aria-label={t('adminSettlementPartnerFilter')} value={settlementPartnerId} onChange={(event) => setSettlementPartnerId(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
            <option value="">{t('adminAllPartners')}</option>
            {partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminPartnerFallback', { id: partner.partnerId })}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <span>{t('adminStatus')}</span>
          <select aria-label={t('adminSettlementStatusFilter')} value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
            <option value="">{t('adminAllStatuses')}</option>
            <option value="pending">{t('statusPending')}</option>
            <option value="approved">{t('statusApproved')}</option>
            <option value="paid">{t('statusPaid')}</option>
            <option value="reversed">{t('statusReversed')}</option>
            <option value="disputed">{t('statusDisputed')}</option>
            <option value="voided">{t('statusVoided')}</option>
          </select>
        </label>
        <button type="button" onClick={downloadSettlementHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>
        {settlementPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendSettlements: true, settlementOffset: settlementPagination.nextOffset || 0 })} disabled={loadingMoreSettlements || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreSettlements ? t('adminLoading') : t('adminLoadOlder')}</button>}
      </div>
    </div>

    <SettlementControls
      selectablePartners={selectablePartners}
      settlementForm={settlementForm}
      setSettlementForm={setSettlementForm}
      loadSettlementAgreements={loadSettlementAgreements}
      loadingSettlementAgreements={loadingSettlementAgreements}
      settlementAgreements={settlementAgreementOptions}
      settlementAgreementOptionsError={settlementAgreementOptionsError}
      busy={busy}
      createSettlement={createSettlement}
      reconciliationReason={reconciliationReason}
      setReconciliationReason={setReconciliationReason}
      runReconciliation={runReconciliation}
      reconciliation={reconciliation}
      settlements={settlements}
      transitionSettlement={transitionSettlement}
    />

    <ReconciliationHistory
      reconciliationRuns={reconciliationRuns}
      reconciliationStatus={reconciliationStatus}
      setReconciliationStatus={setReconciliationStatus}
      reconciliationCurrency={reconciliationCurrency}
      setReconciliationCurrency={setReconciliationCurrency}
      currencyOptions={currencyOptions}
      reconciliationPagination={reconciliationPagination}
      loadingMoreReconciliationRuns={loadingMoreReconciliationRuns}
      loading={loading}
      busy={busy}
      downloadReconciliationHistory={downloadReconciliationHistory}
      load={load}
    />

    <ExternalReconciliationHistory
      externalReconRuns={externalReconRuns}
      externalReconStatus={externalReconStatus}
      setExternalReconStatus={setExternalReconStatus}
      externalReconCurrency={externalReconCurrency}
      setExternalReconCurrency={setExternalReconCurrency}
      currencyOptions={currencyOptions}
      externalReconPagination={externalReconPagination}
      loadingMoreExternalReconRuns={loadingMoreExternalReconRuns}
      loading={loading}
      busy={busy}
      load={load}
      externalReconReason={externalReconReason}
      setExternalReconReason={setExternalReconReason}
      triggerExternalReconciliation={triggerExternalReconciliation}
    />

    <ComplianceQueue
      queue={complianceQueue}
      busy={busy}
      decideCompliance={decideCompliance}
    />

    <PendingActionQueue
      busy={busy}
      setBusy={setBusy}
      setNotice={setNotice}
      setError={setError}
      requestDialog={requestDialog}
    />

    <CreditDisputeQueue
      disputes={disputes}
      disputeStatus={disputeStatus}
      setDisputeStatus={setDisputeStatus}
      disputePagination={disputePagination}
      loadingMoreDisputes={loadingMoreDisputes}
      loading={loading}
      busy={busy}
      downloadDisputeHistory={downloadDisputeHistory}
      load={load}
      disputeResolutionDrafts={disputeResolutionDrafts}
      setDisputeResolutionDrafts={setDisputeResolutionDrafts}
      disputeCompensationDrafts={disputeCompensationDrafts}
      setDisputeCompensationDrafts={setDisputeCompensationDrafts}
      setDisputeResolutionDrafts={setDisputeResolutionDrafts}
      inspectDisputeCustomer={inspectDisputeCustomer}
      resolveDispute={resolveDispute}
    />

    <CreditAuditHistory
      auditEvents={auditEvents}
      loading={loading}
      busy={busy}
      downloadAuditHistory={downloadAuditHistory}
    />

    <CreditPayoutRecovery
      settlements={settlements}
      busy={busy}
      reverseSettlement={reverseSettlement}
    />

    <div className="rounded-2xl border border-amber-500/20 bg-amber-950/15 p-4 text-xs leading-5 text-amber-200"><strong>{t('adminOperationalBoundary')}:</strong> {t('adminOperationalBoundaryDescription')}</div>
  </main></>;
}
