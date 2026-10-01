// Shared building blocks for the OxSteed Credit admin section.

// Extracted verbatim from the former OxsteedCreditAdmin monolith so every

// page keeps identical behavior; only the module path changed.

import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../../i18n';
import { DEFAULT_CREDIT_CURRENCIES, formatCreditMinorUnits, parseCreditMajorAmount } from '../../../../lib/creditCurrency';
import { formatCreditDateTime } from '../../../../lib/creditDateTime';
import { localizeCreditOrderTypes, localizeCreditStatus } from '../../../../lib/creditStatus';
import { createStableIdempotencyKeyStore } from '../creditIdempotency';
import { adminRoute } from '../../../adminRouteManifest';

export const DEFAULT_CURRENCY_OPTIONS = DEFAULT_CREDIT_CURRENCIES;
export const CUSTOMER_ACCOUNT_PAGE_SIZE = 50;
export const PARTNER_DIRECTORY_PAGE_SIZE = 50;
export const CREDIT_WORKER_NAMES = [
  'oxsteed-credit-notification-outbox',
  'oxsteed-credit-hold-expiry',
  'oxsteed-credit-entitlement-expiry',
  'oxsteed-credit-reconciliation',
  'oxsteed-credit-settlement-cycle',
  'oxsteed-credit-integrity',
  'oxsteed-credit-compliance-monitor',
  'restaurant-credit-wallet-watchdog',
];

export const money = formatCreditMinorUnits;
export const dollarsToCents = parseCreditMajorAmount;

export const CREDIT_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useCreditDialogFocusTrap(dialogRef, open, onEscape) {
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

export function dateTime(value) {
  const language = typeof document !== 'undefined' && document.documentElement?.lang;
  const fallbackKey = value ? 'adminUnknownDate' : 'adminNoActivity';
  const fallback = i18n.t(`credit:${fallbackKey}`, { defaultValue: value ? 'Unknown date' : 'No activity' });
  return formatCreditDateTime(value, fallback, language);
}

export function statusClass(status) {
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

export function Badge({ status }) {
  const { t } = useTranslation('credit');
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{localizeCreditStatus(status, t)}</span>;
}

export function IntegritySummary({ integrity }) {
  const { t } = useTranslation('credit');
  if (!integrity || typeof integrity !== 'object') return null;
  const failures = Object.entries(integrity).filter(([, value]) => Number(value) > 0);
  if (failures.length) {
    return <p className="mt-2 inline-flex items-center gap-1.5 font-semibold text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {t('adminHashIntegrityFailed', { details: failures.map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${value}`).join(', ') })}</p>;
  }
  return <p className="mt-2 inline-flex items-center gap-1.5 font-semibold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> {t('adminHashIntegrityVerified')}</p>;
}

export function Metric({ icon: Icon, label, value, detail, tone = 'text-white' }) {
  return <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">{label}</span><Icon className="h-4 w-4 text-orange-400" /></div><strong className={`mt-3 block text-2xl font-semibold ${tone}`}>{value}</strong><span className="mt-1 block text-xs text-gray-600">{detail}</span></div>;
}

export function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function buildGeography(form) {
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

export function geographyLabel(geography, t) {
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

export const TRANSACTION_TRANSLATION_KEYS = {
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

export const NOTIFICATION_TRANSLATION_KEYS = {
  transaction_posted: 'notificationTransactionPosted',
  hold_created: 'notificationHoldCreated',
  hold_captured: 'notificationHoldCaptured',
  hold_released: 'notificationHoldReleased',
  hold_expired: 'notificationHoldExpired',
};

export function creditTransactionLabel(transaction, t) {
  const transactionType = String(transaction?.transactionType || '').toLowerCase();
  const translationKey = TRANSACTION_TRANSLATION_KEYS[transactionType] || 'transactionUnknown';
  return t(translationKey);
}

export function creditNotificationLabel(notification, t) {
  const eventType = String(notification?.eventType || '').toLowerCase();
  return t(NOTIFICATION_TRANSLATION_KEYS[eventType] || 'notificationUnknown');
}

export function transactionPartyLabel(transaction, t) {
  if (transaction?.debitCustomerId) return `${t('adminCustomer')} ${transaction.debitCustomerId}`;
  if (transaction?.creditCustomerId) return `${t('adminCustomer')} ${transaction.creditCustomerId}`;
  if (transaction?.partnerId) return `${t('adminPartner')} ${transaction.partnerId}`;
  return t('adminSystemMovement');
}

export function disputeReasonLabel(value, t) {
  return {
    incorrect_amount: t('disputeIncorrectAmount'),
    unauthorized: t('disputeUnauthorized'),
    duplicate: t('disputeDuplicate'),
    restaurant_issue: t('disputeRestaurantIssue'),
    other: t('other'),
  }[value] || t('other');
}

export const ADMIN_SECTION_TRANSLATIONS = {
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
  'Reserve policy': {
    eyebrow: 'adminReservePolicyEyebrow',
    title: 'adminReservePolicySectionTitle',
    detail: 'adminReservePolicySectionDetail',
  },
};

export function Section({ eyebrow, title, detail, children, action }) {
  const { t } = useTranslation('credit');
  const translation = ADMIN_SECTION_TRANSLATIONS[eyebrow];
  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{translation ? t(translation.eyebrow, { defaultValue: eyebrow }) : eyebrow}</p><h2 className="mt-1 text-lg font-semibold text-white">{translation ? t(translation.title, { defaultValue: title }) : title}</h2>{detail && <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{translation ? t(translation.detail, { defaultValue: detail }) : detail}</p>}</div>{action}</div>{children}</section>;
}

export const WORKER_TRANSLATION_KEYS = {
  'oxsteed-credit-notification-outbox': 'adminWorkerNotificationOutbox',
  'oxsteed-credit-hold-expiry': 'adminWorkerHoldExpiry',
  'oxsteed-credit-topup-expiry': 'adminWorkerTopupExpiry',
  'oxsteed-credit-entitlement-expiry': 'adminWorkerEntitlementExpiry',
  'oxsteed-credit-reconciliation': 'adminWorkerReconciliation',
  'oxsteed-credit-external-reconciliation': 'adminWorkerExternalReconciliation',
  'oxsteed-credit-settlement-cycle': 'adminWorkerSettlementCycle',
  'oxsteed-credit-compliance-monitor': 'adminWorkerComplianceMonitor',
  'oxsteed-credit-integrity': 'adminWorkerIntegrity',
  'restaurant-credit-wallet-watchdog': 'adminWorkerRestaurantWalletWatchdog',
};

export function workerDisplayName(jobName, t) {
  const key = WORKER_TRANSLATION_KEYS[jobName];
  return key ? t(key) : t('adminCreditWorker');
}

export const WORKER_RESULT_TRANSLATION_KEYS = {
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

export function workerResultSummary(result, t) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  return Object.entries(result)
    .map(([key, value]) => {
      const fallback = key.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `${WORKER_RESULT_TRANSLATION_KEYS[key] ? t(WORKER_RESULT_TRANSLATION_KEYS[key]) : fallback}: ${String(value)}`;
    })
    .join(' · ');
}

export function AdminActionDialog({ dialog, onResolve }) {
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

// Standard plumbing shared by every credit admin page: loading/busy flags,
// error + notice banners, a stable idempotency-key store, and a request guard
// so late responses never clobber newer state.
export function useCreditPageState() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());
  const loadRequestRef = useRef(0);
  return { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef };
}

// Promise-based wrapper around AdminActionDialog, matching the monolith's
// requestDialog/resolveDialog pair. Resolves with the entered value for text
// dialogs, true/false for confirm dialogs, or null when dismissed.
export function useCreditDialog() {
  const [dialog, setDialog] = useState(null);
  const dialogResolverRef = useRef(null);
  const requestDialog = useCallback((config) => new Promise((resolve) => {
    dialogResolverRef.current = resolve;
    setDialog({ ...config, id: Date.now() });
  }), []);
  const resolveDialog = (value) => {
    const resolve = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    if (resolve) resolve(value);
  };
  return { dialog, requestDialog, resolveDialog };
}

// Sub-navigation for the OxSteed Credit section. The overview route needs
// `end` so it is not marked active on every nested page.
export const CREDIT_SUBNAV_ITEMS = [
  { routeKey: 'oxsteedCredit', labelKey: 'adminCreditSubnavOverview' },
  { routeKey: 'oxsteedCreditApprovals', labelKey: 'adminPendingActionQueue', descriptionKey: 'adminPendingActionQueueDescription' },
  { routeKey: 'oxsteedCreditDisputes', labelKey: 'adminCreditDisputes', descriptionKey: 'adminDisputeQueueDescription' },
  { routeKey: 'oxsteedCreditSettlements', labelKey: 'adminSettlementQueue', descriptionKey: 'adminSettlementQueueDescription' },
  { routeKey: 'oxsteedCreditReconciliation', labelKey: 'adminReconciliationHistory', descriptionKey: 'adminReconciliationHistoryDescription' },
  { routeKey: 'oxsteedCreditCompliance', labelKey: 'adminComplianceQueue', descriptionKey: 'adminComplianceQueueDescription' },
  { routeKey: 'oxsteedCreditReserves', labelKey: 'adminReservePolicyEyebrow', descriptionKey: 'adminReservePolicySectionDetail' },
  { routeKey: 'oxsteedCreditPartners', labelKey: 'adminPartnerNetwork', descriptionKey: 'adminPartnerNetworkDescription' },
  { routeKey: 'oxsteedCreditHealth', labelKey: 'adminCreditSubnavHealth', descriptionKey: 'adminCreditHealthDescription' },
  { routeKey: 'oxsteedCreditAudit', labelKey: 'adminAuditHistory', descriptionKey: 'adminAuditHistoryDescription' },
  { routeKey: 'oxsteedCreditCustomers', labelKey: 'adminCustomerWallets', descriptionKey: 'adminCustomerWalletSearchDescription' },
  { routeKey: 'oxsteedCreditMoneyOut', labelKey: 'moneyOutEyebrow' },
  { routeKey: 'oxsteedCreditCards', labelKey: 'adminCreditSubnavCards', descriptionKey: 'cards.adminDescription' },
  { routeKey: 'oxsteedCreditLedger', labelKey: 'adminLedgerActivity', descriptionKey: 'adminCreditTransactionHistoryDetail' },
];

export function CreditSubNav() {
  const { t } = useTranslation('credit');
  return (
    <nav aria-label={t('adminPageTitle')} className="flex gap-2 overflow-x-auto pb-1">
      {CREDIT_SUBNAV_ITEMS.map((item) => (
        <NavLink
          key={item.routeKey}
          to={adminRoute(item.routeKey).path}
          end={item.routeKey === 'oxsteedCredit'}
          className={({ isActive }) => `whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition ${isActive ? 'border-orange-500/60 bg-orange-500/15 text-orange-200' : 'border-gray-700 bg-gray-900/60 text-gray-300 hover:border-gray-500 hover:text-white'}`}
        >
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
