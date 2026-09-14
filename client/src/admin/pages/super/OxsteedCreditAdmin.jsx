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
  Store,
  WalletCards,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { DEFAULT_CREDIT_CURRENCIES, formatCreditMinorUnits, parseCreditMajorAmount } from '../../../lib/creditCurrency';
import OxsteedCreditEntitlements from './OxsteedCreditEntitlements';
import OxsteedCreditCustomerDetail from './OxsteedCreditCustomerDetail';

const DEFAULT_CURRENCY_OPTIONS = DEFAULT_CREDIT_CURRENCIES;
const CUSTOMER_ACCOUNT_PAGE_SIZE = 50;
const PARTNER_DIRECTORY_PAGE_SIZE = 50;
const CREDIT_WORKER_NAMES = [
  'oxsteed-credit-notification-outbox',
  'oxsteed-credit-hold-expiry',
  'oxsteed-credit-entitlement-expiry',
  'oxsteed-credit-reconciliation',
  'oxsteed-credit-integrity',
  'restaurant-credit-wallet-watchdog',
];

const money = formatCreditMinorUnits;
const dollarsToCents = parseCreditMajorAmount;

function dateTime(value) {
  if (!value) return 'No activity';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status) {
  if (status === 'enabled') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'balanced') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'pending' || status === 'pending_approval') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'running') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'difference' || status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'suspended') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'terminated' || status === 'expired') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{String(status || 'unknown').replace(/_/g, ' ')}</span>;
}

function IntegritySummary({ integrity }) {
  if (!integrity || typeof integrity !== 'object') return null;
  const failures = Object.entries(integrity).filter(([, value]) => Number(value) > 0);
  if (failures.length) {
    return <p className="mt-2 inline-flex items-center gap-1.5 font-semibold text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> Hash integrity failed: {failures.map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${value}`).join(', ')}</p>;
  }
  return <p className="mt-2 inline-flex items-center gap-1.5 font-semibold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Hash integrity verified</p>;
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

function geographyLabel(geography) {
  const labels = [
    ['cities', 'Cities'],
    ['states', 'States'],
    ['postalCodes', 'Postal codes'],
    ['countries', 'Countries'],
  ].flatMap(([key, label]) => Array.isArray(geography?.[key]) && geography[key].length
    ? [`${label}: ${geography[key].join(', ')}`]
    : []);
  return labels.join(' · ');
}

function creditTransactionLabel(transaction) {
  return String(transaction?.transactionType || 'movement').replace(/_/g, ' ');
}

function transactionPartyLabel(transaction) {
  if (transaction?.debitCustomerId) return `Customer ${transaction.debitCustomerId}`;
  if (transaction?.creditCustomerId) return `Customer ${transaction.creditCustomerId}`;
  if (transaction?.partnerId) return `Partner ${transaction.partnerId}`;
  return 'System movement';
}

function requestKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function Section({ eyebrow, title, detail, children, action }) {
  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>{detail && <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{detail}</p>}</div>{action}</div>{children}</section>;
}

function workerDisplayName(jobName) {
  return String(jobName || 'Credit worker').replace(/^oxsteed-credit-/, '').replace(/-/g, ' ');
}

function workerResultSummary(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  return Object.entries(result)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${String(value)}`)
    .join(' · ');
}

function CreditWorkerHealth({ heartbeats }) {
  const rows = CREDIT_WORKER_NAMES.map((jobName) => ({ jobName, heartbeat: heartbeats?.[jobName] || {} }));
  const isFailed = (heartbeat) => Boolean(heartbeat.lastError) || heartbeat.stale === true || Number(heartbeat.consecutiveFailures || 0) > 0;
  const hasFailure = rows.some(({ heartbeat }) => isFailed(heartbeat));
  const hasAwaiting = rows.some(({ heartbeat }) => !heartbeat.lastRunAt);
  const needsAttention = hasFailure || hasAwaiting;
  const panelStatus = hasFailure ? 'Needs attention' : hasAwaiting ? 'Awaiting checkpoints' : 'No active failures';
  return <section className={`rounded-2xl border p-4 sm:p-5 ${hasFailure ? 'border-red-500/30 bg-red-950/15' : hasAwaiting ? 'border-amber-500/30 bg-amber-950/10' : 'border-gray-800 bg-[#111318]'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">Worker health</p><h2 className="mt-1 text-lg font-semibold text-white">Credit maintenance workers</h2><p className="mt-1 text-xs leading-5 text-gray-500">Durable checkpoints cover delivery, reservations, lifecycle expiry, reconciliation, integrity verification, and restaurant wallet operations. A missing or failed checkpoint is operational evidence, not a ledger mutation.</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${hasFailure ? 'border-red-500/30 bg-red-500/10 text-red-300' : hasAwaiting ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{needsAttention ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{panelStatus}</span></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(({ jobName, heartbeat }) => { const failed = isFailed(heartbeat); const awaiting = !heartbeat.lastRunAt; const resultSummary = workerResultSummary(heartbeat.lastResult); return <div key={jobName} className={`rounded-xl border p-3 ${failed ? 'border-red-500/25 bg-red-950/20' : awaiting ? 'border-amber-500/20 bg-amber-950/10' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-start justify-between gap-3"><p className="capitalize text-sm font-semibold text-white">{workerDisplayName(jobName)}</p><span className={`inline-flex shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${failed ? 'border-red-500/30 bg-red-500/10 text-red-300' : awaiting ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{failed ? 'Failed' : awaiting ? 'Awaiting run' : 'Healthy'}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><div><p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">Last run</p><p className="mt-1 text-gray-300">{dateTime(heartbeat.lastRunAt)}</p></div><div><p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">Last success</p><p className="mt-1 text-gray-300">{dateTime(heartbeat.lastSuccessAt)}</p></div><div><p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">Failures / runs</p><p className={`mt-1 font-semibold ${failed ? 'text-red-300' : 'text-gray-300'}`}>{Number(heartbeat.consecutiveFailures || 0)} / {Number(heartbeat.runCount || 0)}</p></div></div>{resultSummary && <p className="mt-3 break-words text-[11px] text-gray-500">Last result: {resultSummary}</p>}{heartbeat.lastError && <p className="mt-3 break-words rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{heartbeat.lastError}</p>}</div>; })}</div>
  </section>;
}

function CreditRailPrerequisites({ prerequisites }) {
  const checks = [
    ['Shared Redis', prerequisites.sharedRedisConfigured, 'Required for safe multi-instance locks and worker coordination.'],
    ['Dedicated ledger key', prerequisites.dedicatedLedgerSecretConfigured, 'Keeps ledger integrity separate from authentication secrets.'],
    ['Ledger key configuration', prerequisites.ledgerKeyConfigurationValid, 'Current and previous key versions are configured for verification.'],
    ['Server error monitoring', prerequisites.serverErrorMonitoringConfigured, 'Required to detect production failures and trigger incident response.'],
  ];
  const ready = prerequisites.readyForProductionActivation === true;
  return <section className={`rounded-2xl border p-4 sm:p-5 ${ready ? 'border-emerald-500/25 bg-emerald-950/10' : 'border-amber-500/25 bg-amber-950/10'}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">Activation readiness</p><h2 className="mt-1 text-lg font-semibold text-white">Production prerequisites</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">These checks are safe signals only. Keep the Credit rail suspended until infrastructure, custody, compliance, and the production runbook have also been approved.</p></div>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${ready ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>{ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{ready ? 'Infrastructure ready' : 'Not ready'}</span>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{checks.map(([label, passed, detail]) => <div key={label} className={`rounded-xl border p-3 ${passed ? 'border-emerald-500/20 bg-emerald-950/10' : 'border-red-500/20 bg-red-950/10'}`}><div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{label}</strong>{passed ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-red-300" />}</div><p className="mt-2 text-[11px] leading-5 text-gray-500">{detail}</p><p className={`mt-2 text-[10px] font-bold uppercase tracking-[0.14em] ${passed ? 'text-emerald-300' : 'text-red-300'}`}>{passed ? 'Pass' : 'Action required'}</p></div>)}</div>
  </section>;
}

function AdminCreditTransactionDetail({ transaction, onClose, onRefund, refundForm, setRefundForm, busy }) {
  if (!transaction) return null;
  const accountLabel = (account) => account?.customerEmail || account?.customerId || account?.partnerId || account?.accountType || 'Unknown account';
  const isPostedPurchase = transaction.transactionType === 'purchase' && transaction.status === 'posted';
  const canRefund = isPostedPurchase && Number(transaction.remainingRefundableCents || 0) > 0;
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true" aria-label="Credit transaction detail">
    <section className="my-2 w-full max-w-5xl rounded-2xl border border-gray-700 bg-[#111318] p-4 shadow-2xl sm:my-8 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-800 pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Transaction detail</p><h2 className="mt-1 text-xl font-semibold text-white">{creditTransactionLabel(transaction)}</h2><p className="mt-1 break-all font-mono text-[11px] text-gray-600">{transaction.id}</p></div><button type="button" onClick={onClose} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">Close</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4"><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Amount</span><strong className="mt-1 block text-lg text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</strong></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Status</span><div className="mt-2"><Badge status={transaction.status} /></div></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Posted</span><strong className="mt-1 block text-sm text-gray-300">{dateTime(transaction.postedAt || transaction.createdAt)}</strong></div><div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Restaurant</span><strong className="mt-1 block break-words text-sm text-gray-300">{transaction.restaurantName || 'Platform movement'}</strong></div></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Journal accounts</p><div className="mt-3 space-y-3 text-xs"><div><span className="text-gray-600">Debit</span><p className="mt-1 break-all text-gray-300">{accountLabel(transaction.debitAccount)} <span className="text-gray-600">· {transaction.debitAccount?.accountType || 'account'}</span></p></div><div><span className="text-gray-600">Credit</span><p className="mt-1 break-all text-gray-300">{accountLabel(transaction.creditAccount)} <span className="text-gray-600">· {transaction.creditAccount?.accountType || 'account'}</span></p></div><div><span className="text-gray-600">Reference</span><p className="mt-1 break-all text-gray-300">{transaction.referenceType || 'None'}{transaction.referenceId ? ` · ${transaction.referenceId}` : ''}</p></div><div><span className="text-gray-600">Idempotency key</span><p className="mt-1 break-all font-mono text-[10px] text-gray-500">{transaction.idempotencyKey || 'Not recorded'}</p></div></div></div><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Immutable entries</p><div className="mt-3 space-y-2">{!transaction.entries?.length ? <p className="text-xs text-gray-600">No journal entries returned.</p> : transaction.entries.map((entry) => <div key={entry.id} className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold uppercase tracking-[0.12em] text-sky-300">{entry.side}</span><strong className="text-emerald-300">{money(entry.amountCents, transaction.currencyCode)}</strong></div><p className="mt-1 break-all text-gray-600">{entry.accountType || 'account'} · balance after {money(entry.balanceAfterCents, transaction.currencyCode)} · sequence {entry.sequence}</p><p className="mt-1 break-all font-mono text-[10px] text-gray-700">hash {entry.entryHash || 'not recorded'} · key version {entry.hashKeyVersion || 'v1'}</p></div>)}</div></div></div>
      <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Related audit events</p><div className="mt-3 space-y-2">{!transaction.auditEvents?.length ? <p className="text-xs text-gray-600">No transaction-specific audit events returned.</p> : transaction.auditEvents.map((event) => <div key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2 text-xs"><div><strong className="font-mono text-orange-300">{event.actionType}</strong><p className="mt-1 text-gray-500">{event.reason || 'No reason recorded'}</p></div><span className="text-gray-600">{dateTime(event.createdAt)}</span></div>)}</div></div>
      {isPostedPurchase && !canRefund && <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4 text-xs text-gray-500">No refundable balance remains for this purchase. Posted refunds: {money(transaction.refundedCents, transaction.currencyCode)}.</div>}
      {canRefund && <form onSubmit={onRefund} className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Operator action</p><h3 className="mt-1 text-sm font-semibold text-white">Refund this purchase</h3><p className="mt-1 text-xs leading-5 text-gray-500">Post a partial or full immutable refund. The server rejects refunds above the remaining refundable purchase amount.</p></div><span className="text-xs font-semibold text-amber-200">Remaining {money(transaction.remainingRefundableCents, transaction.currencyCode)}</span></div><div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto]"><label><span className="mb-1 block text-xs font-semibold text-gray-500">Refund amount ({transaction.currencyCode})</span><input required inputMode="decimal" autoComplete="off" value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" aria-label="Refund amount" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Required reason</span><input required maxLength={500} value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Customer cancellation, duplicate charge, or dispute outcome" aria-label="Refund reason" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={busy} className="self-end rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{busy ? 'Posting...' : 'Post refund'}</button></div></form>}
    </section>
  </div>;
}

function SettlementEvidence({ settlements }) {
  if (!settlements?.length) return null;
  return <Section eyebrow="Payout evidence" title="Settlement payment trail" detail="Keep the approval actor, external payment reference, and paid timestamp visible together so each partner payout can be reconciled without opening another screen."><div className="mt-4 grid gap-3 md:grid-cols-2">{settlements.slice(0, 6).map((settlement) => <article key={settlement.id} className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{settlement.restaurantName || `Partner ${settlement.partnerId}`}</h3><p className="mt-1 text-[11px] text-gray-600">{dateTime(settlement.periodStart)} to {dateTime(settlement.periodEnd)}</p></div><Badge status={settlement.status} /></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-gray-600">Net payable</dt><dd className="mt-1 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</dd></div><div><dt className="text-gray-600">Approved by</dt><dd className="mt-1 break-all text-sky-300">{settlement.approvedBy || 'Pending approval'}</dd></div><div><dt className="text-gray-600">Payment reference</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-300">{settlement.paymentReference || 'Not recorded'}</dd></div></dl>{settlement.paidAt && <p className="mt-3 border-t border-gray-800 pt-3 text-[11px] text-gray-500">Paid {dateTime(settlement.paidAt)}</p>}</article>)}</div>{settlements.length > 6 && <p className="mt-3 text-xs text-gray-600">Showing the six most recent settlement records. Use the settlement queue filters and CSV export for the full history.</p>}</Section>;
}

export default function OxsteedCreditAdmin() {
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
  const loadRequestRef = useRef(0);
  const partnerLookupRequestRef = useRef(0);
  const settlementAgreementRequestRef = useRef(0);

  const load = useCallback(async ({ quiet = false, customerAccountsParams, appendPartnerDirectory = false, partnerDirectoryOffset = 0, appendSettlements = false, settlementOffset = 0, appendTransactions = false, transactionOffset = 0, appendDisputes = false, disputeOffset = 0, appendAuditEvents = false, auditOffset = 0, appendReconciliationRuns = false, reconciliationOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    if (appendPartnerDirectory) setLoadingMorePartnerDirectory(true);
    if (appendSettlements) setLoadingMoreSettlements(true);
    if (appendTransactions) setLoadingMoreTransactions(true);
    if (appendDisputes) setLoadingMoreDisputes(true);
    if (appendAuditEvents) setLoadingMoreAuditEvents(true);
    if (appendReconciliationRuns) setLoadingMoreReconciliationRuns(true);
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
      const [overviewResponse, customerAccountsResponse, partnersResponse, partnerDirectoryResponse, agreementsResponse, settlementsResponse, transactionsResponse, disputesResponse, auditEventsResponse, reconciliationResponse, railResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/accounts', { params: walletParams }).catch(() => ({ data: { accounts: [], total: 0, limit: CUSTOMER_ACCOUNT_PAGE_SIZE, offset: walletParams.offset, hasMore: false } })),
        adminApi.get('/admin/super/oxsteed-credit/partners'),
        adminApi.get('/admin/super/oxsteed-credit/partners/directory', { params: partnerDirectoryParams }),
        adminApi.get('/admin/super/oxsteed-credit/agreements'),
        adminApi.get('/admin/super/oxsteed-credit/settlements', { params: settlementParams }),
        adminApi.get('/admin/super/oxsteed-credit/transactions', { params: transactionParams }),
        adminApi.get('/admin/super/oxsteed-credit/disputes', { params: disputeParams }),
        adminApi.get('/admin/super/oxsteed-credit/audit-events', { params: auditParams }).catch(() => ({ data: { auditEvents: [], pagination: { limit: auditParams.limit, offset: auditParams.offset, hasMore: false, nextOffset: null } } })),
        adminApi.get('/admin/super/oxsteed-credit/reconciliation', { params: reconciliationParams }),
        adminApi.get('/admin/super/oxsteed-credit/rail').catch(() => ({ data: { rail: null } })),
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
      setRail(railResponse.data?.rail || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) {
        setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to load OxSteed Credit administration.');
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
      }
    }
  }, [auditActionType, auditCorrelationId, auditPartnerId, auditResourceType, customerAccountQuery, disputeStatus, partnerDirectoryQuery, reconciliationCurrency, reconciliationStatus, settlementPartnerId, settlementStatus, transactionCurrency, transactionStatus, transactionType]);

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
        setPartnerOptionsError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Partner lookup failed.');
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
        setSettlementAgreementOptionsError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Agreement lookup failed.');
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
      setNotice('Partner enrollment created in Pending status. Activate it after confirming the agreement.');
      setPartnerForm({ restaurantId: '', settlementCurrencyCode: 'USD', notes: '', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Partner enrollment failed.');
    } finally { setBusy(false); }
  };

  const createAgreement = async (event) => {
    event.preventDefault();
    if (!agreementForm.partnerId) return setError('Choose a credit partner before creating an agreement.');
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${agreementForm.partnerId}/agreements`, {
        startsAt: new Date(agreementForm.startsAt).toISOString(),
        endsAt: agreementForm.endsAt ? new Date(agreementForm.endsAt).toISOString() : undefined,
        customerTerms: agreementForm.customerTerms || undefined,
        allowedOrderTypes: splitList(agreementForm.allowedOrderTypes),
        allowedCategories: splitList(agreementForm.allowedCategories),
        allowedMenuItemIds: splitList(agreementForm.allowedMenuItemIds),
        geography: buildGeography(agreementForm),
        maxTransactionCents: dollarsToCents(agreementForm.maxTransaction, selectedPartner?.settlementCurrencyCode),
        dailyCustomerLimitCents: dollarsToCents(agreementForm.dailyLimit, selectedPartner?.settlementCurrencyCode),
        lifetimeCustomerLimitCents: dollarsToCents(agreementForm.lifetimeLimit, selectedPartner?.settlementCurrencyCode),
        requiresCustomerEntitlement: agreementForm.requiresCustomerEntitlement,
        reason: agreementForm.reason,
      }, { headers: { 'Idempotency-Key': requestKey('credit-agreement') } });
      setNotice(`Agreement created for ${selectedPartner?.restaurantName || 'the selected partner'} in Draft status.`);
      setAgreementForm((current) => ({ ...current, customerTerms: '', allowedCategories: '', allowedMenuItemIds: '', coverageCities: '', coverageStates: '', coveragePostalCodes: '', coverageCountries: '', maxTransaction: '', dailyLimit: '', lifetimeLimit: '', reason: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Agreement creation failed.');
    } finally { setBusy(false); }
  };

  const transitionPartner = async (partner, status) => {
    const reason = window.prompt(`Why are you moving ${partner.restaurantName || 'this partner'} to ${status}?`, 'Commercial approval or operational review');
    if (!reason?.trim()) {
      setError('A reason is required for partner status changes.');
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${partner.partnerId}/transition`, { status, reason: reason.trim() });
      setNotice(`${partner.restaurantName || 'Partner'} moved to ${status}.`);
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Partner status change failed.');
    } finally { setBusy(false); }
  };

  const transitionAgreement = async (agreement, status) => {
    const reason = window.prompt(`Why are you moving agreement v${agreement.version} to ${status}?`, 'Agreement review or operational change');
    if (!reason?.trim()) {
      setError('A reason is required for agreement status changes.');
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/agreements/${agreement.id}/transition`, { status, reason: reason.trim() });
      setNotice(`Agreement v${agreement.version} moved to ${status}.`);
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Agreement status change failed.');
    } finally { setBusy(false); }
  };

  const createSettlement = async (event) => {
    event.preventDefault();
    if (!settlementForm.partnerId || !settlementForm.agreementId) return setError('Choose a partner and agreement before creating a settlement.');
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post('/admin/super/oxsteed-credit/settlements', {
        partnerId: settlementForm.partnerId,
        agreementId: settlementForm.agreementId,
        periodStart: new Date(settlementForm.periodStart).toISOString(),
        periodEnd: new Date(settlementForm.periodEnd).toISOString(),
        paymentReference: settlementForm.paymentReference || undefined,
        reason: settlementForm.reason,
      }, { headers: { 'Idempotency-Key': requestKey('credit-settlement') } });
      setNotice('Settlement snapshot created in Pending status. Review the totals before approving payment.');
      setSettlementForm((current) => ({ ...current, paymentReference: '', reason: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Settlement creation failed.');
    } finally { setBusy(false); }
  };

  const transitionSettlement = async (settlement, status) => {
    const reason = window.prompt(`Why are you moving this settlement to ${status}?`, 'Settlement review completed');
    if (!reason?.trim()) {
      setError('A reason is required for settlement status changes.');
      return;
    }
    let paymentReference = settlement.paymentReference || '';
    if (status === 'paid' && !paymentReference && Number(settlement.netCents || 0) > 0) {
      paymentReference = window.prompt('Enter the external payment reference before marking this settlement paid:', '') || '';
      if (!paymentReference.trim()) {
        setError('A payment reference is required before a non-zero settlement can be marked paid.');
        return;
      }
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/settlements/${settlement.id}/status`, { status, reason: reason.trim(), paymentReference: paymentReference.trim() || undefined });
      setNotice(`Settlement for ${settlement.restaurantName || 'partner'} moved to ${status}.`);
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Settlement status change failed.');
    } finally { setBusy(false); }
  };

  const runReconciliation = async () => {
    if (!reconciliationReason.trim()) {
      setError('A reason is required for reconciliation runs.');
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
        ? 'OxSteed Credit reconciliation is balanced.'
        : run?.status === 'failed'
          ? 'Reconciliation stopped because ledger hash integrity failed. Do not approve a payout until the ledger is investigated.'
          : 'Reconciliation found a difference. Review the run before any payout.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Reconciliation failed.');
    } finally { setBusy(false); }
  };

  const loadCustomerCredit = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/customers/${customerForm.customerId}/loads`, { amountCents: dollarsToCents(customerForm.amount, customerForm.currencyCode), currencyCode: customerForm.currencyCode, fundingReference: customerForm.fundingReference, reason: customerForm.reason }, { headers: { 'Idempotency-Key': requestKey('credit-load') } });
      setNotice('Customer credit grant posted to the immutable ledger.');
      setCustomerForm({ customerId: '', amount: '', currencyCode: 'USD', fundingReference: '', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Customer credit grant failed.');
    } finally { setBusy(false); }
  };

  const adjustCustomerCredit = async (event) => {
    event.preventDefault();
    if (typeof window !== 'undefined' && !window.confirm(`Confirm clawback of ${customerForm.amount || 'this amount'} from customer ${customerForm.customerId || 'this wallet'}? This posts an immutable debit and cannot be edited.`)) return;
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/customers/${customerForm.customerId}/adjustments`, { amountCents: dollarsToCents(customerForm.amount, customerForm.currencyCode), currencyCode: customerForm.currencyCode, direction: 'debit', reason: customerForm.reason }, { headers: { 'Idempotency-Key': requestKey('credit-adjustment') } });
      setNotice('Customer credit clawback posted to the immutable ledger.');
      setCustomerForm({ customerId: '', amount: '', currencyCode: 'USD', fundingReference: '', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Customer credit adjustment failed.');
    } finally { setBusy(false); }
  };

  const updateAccountStatus = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/customers/${accountStatusForm.customerId}/status`, { currencyCode: accountStatusForm.currencyCode, status: accountStatusForm.status, reason: accountStatusForm.reason }, { headers: { 'Idempotency-Key': requestKey('credit-status') } });
      setNotice(`Customer credit account moved to ${accountStatusForm.status}.`);
      setAccountStatusForm({ customerId: '', currencyCode: 'USD', status: 'suspended', reason: '' });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Customer account status change failed.');
    } finally { setBusy(false); }
  };

  const updateRail = async (event) => {
    event.preventDefault();
    if (!rail || !railReason.trim()) return setError('Enter an audit reason before changing the credit rail status.');
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/rail', { enabled: !rail.enabled, reason: railReason.trim() });
      setRail(response.data?.rail || rail);
      setRailReason('');
      setNotice(response.data?.rail?.enabled ? 'OxSteed Credit is enabled for approved activity.' : 'OxSteed Credit is suspended. Existing ledger history remains available for recovery and review.');
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Credit rail status change failed.');
    } finally { setBusy(false); }
  };

  const retryNotification = async (notification) => {
    const reason = notificationRetryReason.trim();
    if (!reason) {
      setError('Add an audit reason before retrying a Credit notification.');
      return;
    }
    setRetryingNotificationId(notification.id); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/notifications/${notification.id}/retry`, { reason });
      setNotificationRetryReason('');
      setNotice('Credit notification requeued. The durable worker will retry delivery without changing the ledger.');
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Credit notification retry failed.');
    } finally { setRetryingNotificationId(''); }
  };

  const resolveDispute = async (dispute, status) => {
    const resolution = String(disputeResolutionDrafts[dispute.id] || '').trim();
    if (!resolution) {
      setError('Add a status-change note before updating a Credit dispute.');
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/disputes/${dispute.id}/resolve`, { status, resolution: resolution || undefined });
      setNotice(`Dispute ${dispute.id.slice(0, 8)} moved to ${status}.`);
      setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Dispute update failed.');
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
    setNotice(`${account.name || account.email || 'Customer'} selected for ${account.currencyCode} wallet controls.`);
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
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to open the customer Credit profile.');
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
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to open the Credit transaction detail.');
    } finally {
      setLoadingTransactionId('');
    }
  };
  const refundAdminCredit = async (event) => {
    event.preventDefault();
    if (!transactionDetail?.id || transactionDetail.transactionType !== 'purchase' || transactionDetail.status !== 'posted') {
      setError('Only a posted Credit purchase can be refunded from this view.');
      return;
    }
    const amountCents = dollarsToCents(refundForm.amount, transactionDetail.currencyCode);
    const reason = String(refundForm.reason || '').trim();
    if (!amountCents) {
      setError(`Enter a positive refund amount in ${transactionDetail.currencyCode}.`);
      return;
    }
    if (!reason) {
      setError('A reason is required before posting a Credit refund.');
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(`Post a ${refundForm.amount} ${transactionDetail.currencyCode} refund for this purchase? This creates an immutable ledger movement.`)) return;
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/transactions/${transactionDetail.id}/refund`, { amountCents, reason }, { headers: { 'Idempotency-Key': requestKey('credit-refund') } });
      setRefundForm({ amount: '', reason: '' });
      setNotice(response.data?.replayed ? 'The Credit refund request was already recorded; no duplicate movement was posted.' : 'Credit refund posted to the immutable ledger.');
      await inspectTransaction(transactionDetail);
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Credit refund failed.');
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
      setNotice('Credit transaction CSV downloaded with the active filters.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit transactions.');
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
      setNotice('Settlement CSV downloaded with the active filters.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit settlements.');
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
      setNotice('Customer wallet CSV downloaded with the active filters.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export customer wallets.');
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
      setNotice('Credit audit CSV downloaded with the active filters.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit audit history.');
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
      setNotice('Credit dispute CSV downloaded with the active status filter.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit disputes.');
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
      setNotice('Credit reconciliation CSV downloaded with the active filters.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit reconciliation history.');
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
      setNotice('Credit partner directory CSV downloaded.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit partners.');
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
      setNotice('Credit agreement history CSV downloaded.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to export Credit agreements.');
    } finally { setBusy(false); }
  };
  return <><AdminCreditTransactionDetail transaction={transactionDetail} onClose={() => { setTransactionDetail(null); setRefundForm({ amount: '', reason: '' }); }} onRefund={refundAdminCredit} refundForm={refundForm} setRefundForm={setRefundForm} busy={busy} /><main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
    <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-300">Super Admin</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Stored-value control</span></div><h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">OxSteed Credit</h1><p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">Operate a restricted credit network: customers can spend only at restaurants with an active partner agreement, and every movement is journaled, bounded, and auditable.</p></div><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh</button></div></header>
    <section className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Emergency control</p><h2 className="mt-1 text-lg font-semibold text-white">OxSteed Credit rail</h2><p className="mt-1 text-xs leading-5 text-gray-400">This gate controls new loads, holds, purchases, and transfers. Suspending it does not edit or delete ledger history, and every change is recorded in the Credit audit trail.</p></div><Badge status={rail ? (rail.enabled ? 'enabled' : 'suspended') : 'unknown'} /></div><form onSubmit={updateRail} className="mt-4 flex flex-col gap-3 border-t border-amber-500/15 pt-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Required audit reason</span><input value={railReason} onChange={(event) => setRailReason(event.target.value)} maxLength={1000} placeholder={rail?.enabled ? 'Why are you suspending the rail?' : 'Why are you enabling the rail?'} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={!rail || busy || !railReason.trim()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${rail?.enabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}><Power className="h-4 w-4" />{rail?.enabled ? 'Suspend rail' : 'Enable rail'}</button></form></section>
    {rail?.prerequisites && <CreditRailPrerequisites prerequisites={rail.prerequisites} />}
    {error && <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
    <CreditWorkerHealth heartbeats={workerHeartbeats} />
    <Section eyebrow="Audit history controls" title="Search the Credit control trail" detail="Filter the append-only control history before reviewing state changes. Results are bounded and can be loaded in older pages without downloading the entire ledger."
      action={auditPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendAuditEvents: true, auditOffset: auditPagination.nextOffset || 0 })} disabled={loadingMoreAuditEvents || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreAuditEvents ? 'Loading...' : 'Load older audit events'}</button>}
    >
      <div className="mt-4 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Action type</span><input aria-label="Credit audit action filter" value={auditActionType} onChange={(event) => setAuditActionType(event.target.value)} placeholder="credit.rail.suspended" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Resource type</span><input aria-label="Credit audit resource filter" value={auditResourceType} onChange={(event) => setAuditResourceType(event.target.value)} placeholder="credit_transaction" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Partner</span><select aria-label="Credit audit partner filter" value={auditPartnerId} onChange={(event) => setAuditPartnerId(event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">All partners</option>{partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Partner ${partner.partnerId}`}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Request correlation</span><input aria-label="Credit audit correlation filter" value={auditCorrelationId} onChange={(event) => setAuditCorrelationId(event.target.value)} placeholder="request-id-from-logs" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
      </div>
      <p className="mt-2 text-[11px] text-gray-600">Showing {auditEvents.length} loaded event{auditEvents.length === 1 ? '' : 's'}{auditPagination.hasMore ? ' · older events available' : ''}.</p>
    </Section>
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={WalletCards} label={`Customer balance (${summary.currencyCode || 'USD'})`} value={money(summary.customerBalanceCents, summary.currencyCode)} detail={`${summary.customerAccounts || 0} customer accounts`} /><Metric icon={CreditCard} label={`Available (${summary.currencyCode || 'USD'})`} value={money(summary.customerAvailableCents, summary.currencyCode)} detail={`${money(summary.customerReservedCents, summary.currencyCode)} reserved`} tone="text-emerald-300" /><Metric icon={Store} label={`Partner payable (${summary.currencyCode || 'USD'})`} value={money(summary.partnerPayableCents, summary.currencyCode)} detail={`${summary.partnerAccounts || 0} partner accounts`} tone="text-sky-300" /><Metric icon={FileCheck2} label="Partner network" value={partnerCounts.total} detail={`${partnerCounts.active} active partners`} /><Metric icon={AlertTriangle} label="Inactive accounts" value={summary.inactiveAccounts || 0} detail="Needs review before spending" tone="text-amber-300" /></section>
    <Section eyebrow="Coverage watch" title="Partner agreement health" detail="These counts are calculated across the full partner network, not just the first page. Resolve coverage gaps before customers are told they can spend Credit at a restaurant."><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-xl border p-4 ${coverageAlerts.activePartnersWithoutAgreement ? 'border-red-500/30 bg-red-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Active partners without agreement</p><strong className={`mt-2 block text-2xl ${coverageAlerts.activePartnersWithoutAgreement ? 'text-red-300' : 'text-emerald-300'}`}>{coverageAlerts.activePartnersWithoutAgreement}</strong><p className="mt-1 text-xs text-gray-600">Not eligible for customer spending until coverage is active.</p></div><div className={`rounded-xl border p-4 ${coverageAlerts.expiringAgreements ? 'border-amber-500/30 bg-amber-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Agreements expiring in 30 days</p><strong className={`mt-2 block text-2xl ${coverageAlerts.expiringAgreements ? 'text-amber-300' : 'text-emerald-300'}`}>{coverageAlerts.expiringAgreements}</strong><p className="mt-1 text-xs text-gray-600">Review renewals before active coverage ends.</p></div><div className={`rounded-xl border p-4 ${coverageAlerts.pendingPartners ? 'border-sky-500/30 bg-sky-950/20' : 'border-gray-800 bg-gray-950/40'}`}><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Partners pending activation</p><strong className={`mt-2 block text-2xl ${coverageAlerts.pendingPartners ? 'text-sky-300' : 'text-emerald-300'}`}>{coverageAlerts.pendingPartners}</strong><p className="mt-1 text-xs text-gray-600">Confirm commercial terms before activation.</p></div></div></Section>
    <Section eyebrow="Delivery watch" title="Credit customer notifications" detail="Ledger changes commit independently from notification delivery. Use this view to catch delivery backlog or terminal failures without changing customer balances."><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-xl border p-4 ${notificationHealth.backlogStale ? 'border-red-500/40 bg-red-950/20' : notificationHealth.pending || notificationHealth.sending ? 'border-sky-500/30 bg-sky-950/20' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Queued / sending</p><BellRing className={`h-4 w-4 ${notificationHealth.backlogStale ? 'text-red-300' : 'text-sky-300'}`} /></div><strong className={`mt-2 block text-2xl ${notificationHealth.backlogStale ? 'text-red-300' : 'text-sky-300'}`}>{notificationHealth.pending + notificationHealth.sending}</strong><p className={`mt-1 text-xs ${notificationHealth.backlogStale ? 'text-red-200' : 'text-gray-600'}`}>{notificationHealth.backlogStale ? `Delivery backlog exceeds ${notificationHealth.backlogStaleAfterMinutes || 15}-minute threshold` : `${notificationHealth.pending} queued · ${notificationHealth.sending} in flight`}{notificationHealth.oldestPendingAt ? ` · oldest ${dateTime(notificationHealth.oldestPendingAt)}` : ''}</p></div><div className={`rounded-xl border p-4 ${notificationHealth.failed ? 'border-red-500/30 bg-red-950/20' : 'border-gray-800 bg-gray-950/40'}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Terminal failures</p><AlertTriangle className={`h-4 w-4 ${notificationHealth.failed ? 'text-red-300' : 'text-emerald-300'}`} /></div><strong className={`mt-2 block text-2xl ${notificationHealth.failed ? 'text-red-300' : 'text-emerald-300'}`}>{notificationHealth.failed}</strong><p className="mt-1 text-xs text-gray-600">{notificationHealth.oldestFailedAt ? `oldest ${dateTime(notificationHealth.oldestFailedAt)}` : 'No terminal delivery failures'}</p></div><div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Delivery contract</p><strong className="mt-2 block text-lg text-white">Durable outbox</strong><p className="mt-1 text-xs text-gray-600">Retries are bounded and duplicate events are prevented.</p></div></div>{notificationHealth.failedNotifications?.length > 0 && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-950/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-red-200">Failed deliveries need attention</h3><p className="mt-1 text-xs leading-5 text-gray-500">Retrying only requeues the notification. It does not reverse, duplicate, or edit any Credit transaction.</p></div><label className="min-w-[240px] flex-1"><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Retry reason</span><input value={notificationRetryReason} onChange={(event) => setNotificationRetryReason(event.target.value)} maxLength={1000} placeholder="Provider restored, retrying delivery" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-xs text-white outline-none focus:border-orange-400" /></label></div><div className="mt-4 space-y-2">{notificationHealth.failedNotifications.map((notification) => <article key={notification.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-white">{String(notification.eventType || 'notification').replace(/_/g, ' ')}</strong><span className="font-mono text-[10px] text-gray-600">{notification.id}</span></div><p className="mt-1 text-[11px] text-gray-500">{notification.attempts} attempts · recipient {notification.userId || 'unknown'} · {dateTime(notification.updatedAt || notification.createdAt)}</p>{notification.lastError && <p className="mt-1 break-words text-[11px] text-red-300">{notification.lastError}</p>}</div><button type="button" onClick={() => retryNotification(notification)} disabled={busy || retryingNotificationId === notification.id || !notificationRetryReason.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${retryingNotificationId === notification.id ? 'animate-spin' : ''}`} />{retryingNotificationId === notification.id ? 'Requeuing...' : 'Retry delivery'}</button></article>)}</div></div>}</Section>
    {summaryByCurrency.length > 1 && <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Currency controls</p><h2 className="mt-1 text-lg font-semibold text-white">Balances by currency</h2></div><span className="text-xs text-gray-500">No automatic foreign-exchange conversion</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaryByCurrency.map((currencySummary) => <div key={currencySummary.currencyCode} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{currencySummary.currencyCode}</strong><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{currencySummary.customerAccounts || 0} wallets</span></div><p className="mt-2 text-lg font-semibold text-emerald-300">{money(currencySummary.customerAvailableCents, currencySummary.currencyCode)}</p><p className="mt-1 text-xs text-gray-500">Customer available · {money(currencySummary.partnerPayableCents, currencySummary.currencyCode)} partner payable</p></div>)}</div></section>}
    <Section eyebrow="Ledger activity" title="Credit transaction history" detail="Review the full platform movement stream with server-side filters. Amounts are immutable journal movements; open a customer wallet or audit trail for the surrounding context." action={<button type="button" onClick={downloadTransactionHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button>}>
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3">
        <label className="min-w-[160px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Movement type</span><select aria-label="Credit movement type filter" value={transactionType} onChange={(event) => setTransactionType(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">All movement types</option><option value="load">Load</option><option value="purchase">Purchase</option><option value="refund">Refund</option><option value="transfer">Transfer</option><option value="adjustment">Adjustment</option><option value="settlement">Settlement</option><option value="fee">Fee</option><option value="expiration">Expiration</option><option value="chargeback">Chargeback</option></select></label>
        <label className="min-w-[150px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Status</span><select aria-label="Credit movement status filter" value={transactionStatus} onChange={(event) => setTransactionStatus(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">All statuses</option><option value="pending">Pending</option><option value="posted">Posted</option><option value="reversed">Reversed</option><option value="voided">Voided</option></select></label>
        <label className="min-w-[140px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Currency</span><select aria-label="Credit movement currency filter" value={transactionCurrency} onChange={(event) => setTransactionCurrency(event.target.value)} disabled={loading || busy} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">All currencies</option>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        {transactionPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendTransactions: true, transactionOffset: transactionPagination.nextOffset || 0 })} disabled={loadingMoreTransactions || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreTransactions ? 'Loading...' : 'Load older'}</button>}
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
        {!transactions.length ? <div className="py-10 text-center text-sm text-gray-500">No Credit movements match these filters.</div> : <table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Transaction</th><th className="px-3 py-3 font-medium">Restaurant / party</th><th className="px-3 py-3 font-medium">Reference</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Inspect</th></tr></thead><tbody className="divide-y divide-gray-800">{transactions.map((transaction) => <tr key={transaction.id}><td className="px-3 py-3"><strong className="capitalize text-white">{creditTransactionLabel(transaction)}</strong><p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.id}</p>{transaction.direction && <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-gray-600">{transaction.direction} account</span>}</td><td className="max-w-[260px] break-all px-3 py-3 text-gray-400">{transaction.restaurantName || 'Platform movement'}<p className="mt-1 text-[10px] text-gray-600">{transactionPartyLabel(transaction)}</p></td><td className="max-w-[240px] break-all px-3 py-3 text-gray-500">{transaction.referenceType || 'No reference'}{transaction.referenceId ? <p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.referenceId}</p> : null}{transaction.description ? <p className="mt-1 text-[10px] text-gray-600">{transaction.description}</p> : null}</td><td className="px-3 py-3 font-semibold text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</td><td className="px-3 py-3"><Badge status={transaction.status} /></td><td className="px-3 py-3 text-gray-500">{dateTime(transaction.postedAt || transaction.createdAt)}</td><td className="px-3 py-3"><button type="button" onClick={() => inspectTransaction(transaction)} disabled={busy || Boolean(loadingTransactionId)} className="rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingTransactionId === transaction.id ? 'Loading...' : 'Open'}</button></td></tr>)}</tbody></table>}
      </div>
    </Section>
    {riskLimits && <Section eyebrow="Risk guardrails" title="Funding, spending, and transfer limits" detail="These server-side caps are enforced in the database transaction. Amounts use the selected overview currency; transfer controls apply only when customer-to-customer transfers are enabled."><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Per transaction</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTransactionCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Hard cap for one movement</span></div><div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">Per customer wallet</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxCustomerBalanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Maximum outstanding balance</span></div><div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Global outstanding</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTotalIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">All customer wallets per currency</span></div><div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">Daily funding</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Loads and grants per customer</span></div><div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">Daily spending</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerSpendCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Across all partner restaurants</span></div><div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-300">Spend movements</span><strong className="mt-2 block text-lg text-white">{Number(riskLimits.maxDailyCustomerSpendCount || 0)}</strong><span className="mt-1 block text-xs text-gray-500">Purchases plus active holds per day</span></div><div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">Daily transfers</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerTransferCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Outbound customer transfers</span></div><div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300">Transfer movements</span><strong className="mt-2 block text-lg text-white">{Number(riskLimits.maxDailyCustomerTransferCount || 0)}</strong><span className="mt-1 block text-xs text-gray-500">Outbound transfers per day</span></div></div></Section>}

    <Section eyebrow="Customer wallets" title="Find a wallet before taking action" detail="Search by customer name, email, UUID, currency, or state. Filters run on the server so the directory remains complete as the customer base grows. Selecting a wallet only fills the controls below; no balance or status changes happen until you submit a form." action={<button type="button" onClick={downloadCustomerAccounts} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button>}><div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]"><label><span className="mb-1 block text-xs font-semibold text-gray-500">Search wallets</span><input value={customerAccountSearch} onChange={(event) => setCustomerAccountSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyCustomerAccountFilters(); }} placeholder="Name, email, UUID, or currency" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Account state</span><select value={customerAccountStatus} onChange={(event) => setCustomerAccountStatus(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="all">All states</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option></select></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Currency</span><select value={customerAccountCurrency} onChange={(event) => setCustomerAccountCurrency(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="all">All currencies</option>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-gray-500">Showing {customerAccounts.length ? customerAccountOffset + 1 : 0}–{customerAccountOffset + customerAccounts.length} of {customerAccountTotal} matching wallets</div><div className="flex flex-wrap gap-2"><button type="button" onClick={applyCustomerAccountFilters} disabled={loading || busy} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Apply filters</button><button type="button" onClick={clearCustomerAccountFilters} disabled={loading || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Clear</button><button type="button" onClick={() => moveCustomerAccountPage(Math.max(0, customerAccountOffset - CUSTOMER_ACCOUNT_PAGE_SIZE))} disabled={loading || busy || customerAccountOffset === 0} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Previous</button><button type="button" onClick={() => moveCustomerAccountPage(customerAccountOffset + CUSTOMER_ACCOUNT_PAGE_SIZE)} disabled={loading || busy || !customerAccountHasMore} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Next</button></div></div><div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1060px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Customer</th><th className="px-3 py-3 font-medium">Currency</th><th className="px-3 py-3 font-medium">Balance</th><th className="px-3 py-3 font-medium">Available</th><th className="px-3 py-3 font-medium">State</th><th className="px-3 py-3 font-medium">Updated</th><th className="px-3 py-3 font-medium">Action</th></tr></thead><tbody className="divide-y divide-gray-800">{!filteredCustomerAccounts.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">No customer wallets match these filters.</td></tr> : filteredCustomerAccounts.map((account) => <tr key={account.accountId}><td className="px-3 py-3"><strong className="text-white">{account.name || 'Unnamed customer'}</strong><p className="mt-1 text-gray-500">{account.email || 'No email'} </p><p className="mt-1 font-mono text-[10px] text-gray-700">{account.customerId}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{account.currencyCode}</td><td className="px-3 py-3 text-gray-300">{money(account.balanceCents, account.currencyCode)}</td><td className="px-3 py-3 text-emerald-300">{money(account.availableBalanceCents, account.currencyCode)}</td><td className="px-3 py-3"><Badge status={account.status} />{account.isBanned && <p className="mt-1 text-[10px] text-red-300">Platform banned</p>}</td><td className="px-3 py-3 text-gray-500">{dateTime(account.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => inspectCustomerAccount(account)} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">View details</button><button type="button" disabled={busy} onClick={() => selectCustomerAccount(account)} className="rounded-lg border border-gray-700 px-2.5 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Use wallet</button></div></td></tr>)}</tbody></table></div></div></Section>

    {customerDetailAccount && <OxsteedCreditCustomerDetail account={customerDetailAccount} busy={busy} onClose={() => setCustomerDetailAccount(null)} />}

    <Section eyebrow="Customer controls" title="Grant, adjust, or freeze OxSteed Credit" detail="Every grant requires a funding reference. Clawbacks require a reason. Account suspension blocks spend without deleting the customer’s history; closing requires zero balance and no active holds."><div className="mt-5 grid gap-6 xl:grid-cols-3"><form onSubmit={loadCustomerCredit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">Grant credit</h3><input required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} placeholder="Customer UUID" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required inputMode="decimal" value={customerForm.amount} onChange={(event) => setCustomerForm({ ...customerForm, amount: event.target.value })} placeholder="Amount in local currency" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={customerForm.currencyCode} onChange={(event) => setCustomerForm({ ...customerForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><input required value={customerForm.fundingReference} onChange={(event) => setCustomerForm({ ...customerForm, fundingReference: event.target.value })} placeholder="Funding reference" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required value={customerForm.reason} onChange={(event) => setCustomerForm({ ...customerForm, reason: event.target.value })} placeholder="Reason" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Post grant</button></form><form onSubmit={adjustCustomerCredit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">Claw back credit</h3><input required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} placeholder="Customer UUID" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required inputMode="decimal" value={customerForm.amount} onChange={(event) => setCustomerForm({ ...customerForm, amount: event.target.value })} placeholder="Amount in local currency" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={customerForm.currencyCode} onChange={(event) => setCustomerForm({ ...customerForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><input required value={customerForm.reason} onChange={(event) => setCustomerForm({ ...customerForm, reason: event.target.value })} placeholder="Reason for clawback" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><span className="text-xs leading-5 text-gray-600">The same customer ID and amount fields are shared with the grant form above for consistent operator entry.</span><button disabled={busy} className="rounded-xl border border-amber-500/40 px-4 py-3 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Post clawback</button></form><form onSubmit={updateAccountStatus} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">Account safety state</h3><input required value={accountStatusForm.customerId} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, customerId: event.target.value })} placeholder="Customer UUID" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={accountStatusForm.currencyCode} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><select value={accountStatusForm.status} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, status: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option></select><input required value={accountStatusForm.reason} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, reason: event.target.value })} placeholder="Reason" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><button disabled={busy} className="rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Update account state</button></form></div></Section>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="col-span-full rounded-2xl border border-sky-500/20 bg-sky-950/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">Partner lookup</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Find any enrolled restaurant</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">The forms below start with the loaded partner list. Search the server when the partner is not visible, including networks larger than the initial list limit.</p>
          </div>
          <span className="rounded-full border border-gray-700 bg-gray-950/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">{partnerPickerQuery ? `${partnerPickerTotal} match${partnerPickerTotal === 1 ? '' : 'es'}` : `${partners.length} loaded`}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-xs font-semibold text-gray-500">Search by restaurant name or ID</span>
            <input value={partnerPickerSearch} onChange={(event) => setPartnerPickerSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyPartnerPickerSearch(); }} placeholder="e.g. Springfield Bistro or 123" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400" />
          </label>
          <button type="button" onClick={applyPartnerPickerSearch} disabled={loadingPartnerOptions || loading || busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{loadingPartnerOptions ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Find partners</button>
          {partnerPickerQuery && <button type="button" onClick={clearPartnerPickerSearch} disabled={loadingPartnerOptions || loading || busy} className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Clear lookup</button>}
        </div>
        {partnerOptionsError && <p className="mt-3 text-xs font-semibold text-red-300">{partnerOptionsError}</p>}
        <p className="mt-3 text-[11px] text-gray-600">{partnerPickerQuery ? `Showing ${partnerOptions.length} matching partner${partnerOptions.length === 1 ? '' : 's'} in the agreement and settlement selectors.` : 'Use Find partners to search beyond the initial list. Searching never changes partner status or agreement data.'}</p>
      </div>
      <Section eyebrow="Partner enrollment" title="Add a restaurant partner" detail="Enrollment starts as Pending. Activate only after confirming commercial terms, settlement, and customer eligibility."><form onSubmit={registerPartner} className="mt-5 grid gap-3 sm:grid-cols-3"><label className="sm:col-span-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Restaurant ID</span><input required value={partnerForm.restaurantId} onChange={(event) => setPartnerForm({ ...partnerForm, restaurantId: event.target.value })} placeholder="e.g. 12" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Settlement currency</span><select required value={partnerForm.settlementCurrencyCode} onChange={(event) => setPartnerForm({ ...partnerForm, settlementCurrencyCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">Select currency</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><label className="sm:col-span-3"><span className="mb-1 block text-xs font-semibold text-gray-500">Internal notes</span><textarea value={partnerForm.notes} onChange={(event) => setPartnerForm({ ...partnerForm, notes: event.target.value })} rows={2} placeholder="Settlement or partnership notes" className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label className="sm:col-span-3"><span className="mb-1 block text-xs font-semibold text-gray-500">Reason for enrollment *</span><input required maxLength={1000} value={partnerForm.reason} onChange={(event) => setPartnerForm({ ...partnerForm, reason: event.target.value })} placeholder="Why is this restaurant being enrolled?" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Enroll partner</button></form></Section>
    <Section eyebrow="Agreement builder" title="Create a spending agreement" detail="Draft the restaurant's rules first. It must be approved and activated before customer checkout can use it.">
      <form onSubmit={createAgreement} className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Partner</span>
          <select required value={agreementForm.partnerId} onChange={(event) => setAgreementForm({ ...agreementForm, partnerId: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">Select partner</option>
            {selectablePartners.filter((partner) => partner.status !== 'terminated').map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Restaurant ${partner.restaurantId}`} · {partner.status}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Starts</span>
          <input required type="datetime-local" value={agreementForm.startsAt} onChange={(event) => setAgreementForm({ ...agreementForm, startsAt: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Ends (optional)</span>
          <input type="datetime-local" value={agreementForm.endsAt} onChange={(event) => setAgreementForm({ ...agreementForm, endsAt: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Order types</span>
          <input value={agreementForm.allowedOrderTypes} onChange={(event) => setAgreementForm({ ...agreementForm, allowedOrderTypes: event.target.value })} placeholder="pickup, delivery" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-500">Categories (optional)</span>
          <input value={agreementForm.allowedCategories} onChange={(event) => setAgreementForm({ ...agreementForm, allowedCategories: event.target.value })} placeholder="Leave blank for all" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <fieldset className="sm:col-span-2 rounded-xl border border-gray-800 bg-gray-950/40 p-3">
          <legend className="px-1 text-xs font-semibold text-gray-400">Optional menu restrictions</legend>
          <p className="mb-3 text-xs leading-5 text-gray-600">Use menu item IDs to cover only specific items. Leave blank to cover every item in the allowed categories.</p>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">Allowed menu item IDs</span>
            <input value={agreementForm.allowedMenuItemIds} onChange={(event) => setAgreementForm({ ...agreementForm, allowedMenuItemIds: event.target.value })} placeholder="Example: 101, 205, 310" inputMode="numeric" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
        </fieldset>
        <fieldset className="sm:col-span-2 rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
          <legend className="px-1 text-xs font-semibold text-sky-300">Geographic coverage</legend>
          <p className="mb-3 text-xs leading-5 text-gray-500">Leave every field blank for the restaurant's normal service area. If a field is set, a purchase must match one of its comma-separated values.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">Cities</span>
              <input value={agreementForm.coverageCities} onChange={(event) => setAgreementForm({ ...agreementForm, coverageCities: event.target.value })} placeholder="Springfield, Dayton" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">States / regions</span>
              <input value={agreementForm.coverageStates} onChange={(event) => setAgreementForm({ ...agreementForm, coverageStates: event.target.value })} placeholder="OH, MI" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">Postal codes</span>
              <input value={agreementForm.coveragePostalCodes} onChange={(event) => setAgreementForm({ ...agreementForm, coveragePostalCodes: event.target.value })} placeholder="45502, 45402" inputMode="numeric" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">Countries</span>
              <input value={agreementForm.coverageCountries} onChange={(event) => setAgreementForm({ ...agreementForm, coverageCountries: event.target.value })} placeholder="US, CA" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
            </label>
          </div>
        </fieldset>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Customer terms</span>
          <textarea value={agreementForm.customerTerms} onChange={(event) => setAgreementForm({ ...agreementForm, customerTerms: event.target.value })} rows={2} placeholder="Plain-language rules the customer will see" className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Reason for agreement *</span>
          <input required maxLength={1000} value={agreementForm.reason} onChange={(event) => setAgreementForm({ ...agreementForm, reason: event.target.value })} placeholder="Why is this partner agreement being created?" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">Max / transaction ($)</span>
            <input inputMode="decimal" value={agreementForm.maxTransaction} onChange={(event) => setAgreementForm({ ...agreementForm, maxTransaction: event.target.value })} placeholder="Optional" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">Daily / customer ($)</span>
            <input inputMode="decimal" value={agreementForm.dailyLimit} onChange={(event) => setAgreementForm({ ...agreementForm, dailyLimit: event.target.value })} placeholder="Optional" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">Lifetime / customer ($)</span>
            <input inputMode="decimal" value={agreementForm.lifetimeLimit} onChange={(event) => setAgreementForm({ ...agreementForm, lifetimeLimit: event.target.value })} placeholder="Optional" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
          </label>
        </div>
        <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-950/10 p-3">
          <input type="checkbox" checked={agreementForm.requiresCustomerEntitlement} onChange={(event) => setAgreementForm({ ...agreementForm, requiresCustomerEntitlement: event.target.checked })} className="mt-1 h-4 w-4 accent-sky-500" />
          <span><strong className="block text-sm text-white">Restrict to assigned customers</strong><span className="mt-1 block text-xs leading-5 text-gray-500">When enabled, only customers with an active entitlement for this agreement can spend here. Leave off for a partner-wide agreement.</span></span>
        </label>
        <button disabled={busy || !selectablePartners.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> Create draft agreement</button>
      </form>
    </Section>
    </div>

    <Section eyebrow="Partner network" title="Restaurants and agreements" detail="A partner must be Active and have an Active agreement before it appears in customer eligibility results." action={<div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="credit-partner-directory-search">Search partners</label><input id="credit-partner-directory-search" value={partnerDirectorySearch} onChange={(event) => setPartnerDirectorySearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyPartnerDirectoryFilters(); }} placeholder="Search partners..." className="w-40 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /><select aria-label="Partner status filter" value={partnerDirectoryStatus} onChange={(event) => setPartnerDirectoryStatus(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="terminated">Terminated</option></select><button type="button" onClick={applyPartnerDirectoryFilters} disabled={loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">Apply</button><button type="button" onClick={clearPartnerDirectoryFilters} disabled={loading || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">Clear</button><button type="button" onClick={downloadPartnerDirectory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button></div>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{loading && !overview ? <div className="flex items-center justify-center py-14 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Currency</th><th className="px-3 py-3 font-medium">Partner</th><th className="px-3 py-3 font-medium">Agreements</th><th className="px-3 py-3 font-medium">Updated</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{!partnerDirectory.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{partnerDirectoryQuery.search || partnerDirectoryQuery.status ? 'No partners match these filters.' : 'No Credit partners enrolled yet.'}</td></tr> : partnerDirectory.map((partner) => <tr key={partner.partnerId}><td className="px-3 py-3"><strong className="text-white">{partner.restaurantName || `Restaurant ${partner.restaurantId}`}</strong><p className="mt-1 text-gray-600">Restaurant ID {partner.restaurantId}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{partner.settlementCurrencyCode || 'USD'}</td><td className="px-3 py-3"><Badge status={partner.status} /></td><td className="px-3 py-3 text-gray-400">{partner.activeAgreementCount} active / {partner.agreementCount} total</td><td className="px-3 py-3 text-gray-500">{dateTime(partner.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{partner.status === 'pending' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Activate</button>}{partner.status === 'active' && <button disabled={busy} onClick={() => transitionPartner(partner, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Suspend</button>}{partner.status === 'suspended' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Reactivate</button>}</div></td></tr>)}</tbody></table>}</div>{partnerDirectoryPagination.hasMore && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-3 py-3 text-xs text-gray-500"><span>Showing {partnerDirectory.length} of {partnerDirectoryPagination.total} partners</span><button type="button" onClick={() => load({ quiet: true, appendPartnerDirectory: true, partnerDirectoryOffset: partnerDirectoryPagination.nextOffset || 0 })} disabled={loadingMorePartnerDirectory || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMorePartnerDirectory ? 'Loading...' : 'Load more partners'}</button></div>}{!partnerDirectoryPagination.hasMore && partnerDirectory.length > 0 && <p className="mt-3 text-xs text-gray-600">Showing all {partnerDirectoryPagination.total} matching partners.</p>}</Section>

    <Section eyebrow="Agreement lifecycle" title="Active and pending terms" detail="Use lifecycle transitions instead of deleting agreements so the historical record remains intact." action={<button type="button" onClick={downloadAgreementHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{!agreements.length ? <div className="py-14 text-center text-sm text-gray-500">No agreements created yet.</div> : <table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Version</th><th className="px-3 py-3 font-medium">Lifecycle</th><th className="px-3 py-3 font-medium">Coverage</th><th className="px-3 py-3 font-medium">Limits</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{agreements.map((agreement) => <tr key={agreement.id}><td className="px-3 py-3 text-white">{agreement.restaurantName || 'Partner restaurant'}<p className="mt-1 text-gray-600">{dateTime(agreement.startsAt)}{agreement.endsAt ? ` to ${dateTime(agreement.endsAt)}` : ''}</p></td><td className="px-3 py-3 text-gray-400">v{agreement.version}</td><td className="px-3 py-3"><Badge status={agreement.status} /></td><td className="max-w-[240px] px-3 py-3 text-gray-400">{agreement.requiresCustomerEntitlement ? <p className="font-semibold text-amber-300">Assigned customers only</p> : <p className="font-semibold text-emerald-300">Partner-wide</p>}{(agreement.allowedOrderTypes || []).join(', ') || 'No order types set'}{agreement.allowedCategories?.length ? <p className="mt-1 text-gray-600">{agreement.allowedCategories.join(', ')}</p> : null}{agreement.allowedMenuItemIds?.length ? <p className="mt-1 text-gray-600">{agreement.allowedMenuItemIds.length} menu items restricted</p> : null}{geographyLabel(agreement.geography) ? <p className="mt-1 break-words text-sky-300">{geographyLabel(agreement.geography)}</p> : <p className="mt-1 text-gray-600">All restaurant locations</p>}</td><td className="px-3 py-3 text-gray-400"><span className="font-semibold text-sky-300">{agreement.settlementCurrencyCode || 'USD'}</span><br />{agreement.maxTransactionCents ? money(agreement.maxTransactionCents, agreement.settlementCurrencyCode) : 'No per-transaction cap'}{agreement.dailyCustomerLimitCents ? <p className="mt-1 text-gray-600">Daily {money(agreement.dailyCustomerLimitCents, agreement.settlementCurrencyCode)}</p> : null}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{agreement.status === 'draft' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'pending_approval')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Submit</button>}{agreement.status === 'pending_approval' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Approve & activate</button>}{agreement.status === 'active' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Suspend</button>}{agreement.status === 'suspended' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Reactivate</button>}</div></td></tr>)}</tbody></table>}</div></Section>

    <OxsteedCreditEntitlements agreements={agreements} customerAccounts={customerAccounts} busy={busy} />

    <SettlementEvidence settlements={settlements} />

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-[#111318] p-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Settlement queue</p>
        <p className="mt-1 text-xs text-gray-500">Filter settlement history without loading every record at once.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <span>Partner</span>
          <select aria-label="Settlement partner filter" value={settlementPartnerId} onChange={(event) => setSettlementPartnerId(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
            <option value="">All partners</option>
            {partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Partner ${partner.partnerId}`}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <span>Status</span>
          <select aria-label="Settlement status filter" value={settlementStatus} onChange={(event) => setSettlementStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="disputed">Disputed</option>
            <option value="voided">Voided</option>
          </select>
        </label>
        <button type="button" onClick={downloadSettlementHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button>
        {settlementPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendSettlements: true, settlementOffset: settlementPagination.nextOffset || 0 })} disabled={loadingMoreSettlements || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreSettlements ? 'Loading...' : 'Load older'}</button>}
      </div>
    </div>

    <Section eyebrow="Settlement & controls" title="Partner payables and reconciliation" detail="Create a period snapshot, approve it only after review, and mark it paid only with a traceable external payment reference. The reconciliation compares every account balance to its immutable journal entries; its integrity scope is always the all-time ledger for the selected currency."><div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"><form onSubmit={createSettlement} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Partner</span><select required value={settlementForm.partnerId} onChange={(event) => { const nextPartner = selectablePartners.find((partner) => String(partner.partnerId) === event.target.value); setSettlementForm({ ...settlementForm, partnerId: event.target.value, agreementId: '', currencyCode: nextPartner?.settlementCurrencyCode || 'USD' }); loadSettlementAgreements(event.target.value); }} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">Select partner</option>{selectablePartners.filter((partner) => partner.status === 'active').map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Restaurant ${partner.restaurantId}`} · {partner.settlementCurrencyCode || 'USD'}</option>)}</select></label><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Agreement</span><select required value={settlementForm.agreementId} onChange={(event) => setSettlementForm({ ...settlementForm, agreementId: event.target.value })} disabled={loadingSettlementAgreements || !settlementForm.partnerId} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">{loadingSettlementAgreements ? 'Loading agreements...' : 'Select agreement'}</option>{settlementAgreements.map((agreement) => <option key={agreement.id} value={agreement.id}>v{agreement.version} · {agreement.status}</option>)}</select>{settlementAgreementOptionsError && <p className="mt-2 text-xs font-semibold text-red-300">{settlementAgreementOptionsError}</p>}</label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Currency</span><input value={settlementForm.currencyCode} readOnly className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-3 text-sm font-semibold text-sky-300 outline-none" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Period starts</span><input required type="datetime-local" value={settlementForm.periodStart} onChange={(event) => setSettlementForm({ ...settlementForm, periodStart: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Period ends</span><input required type="datetime-local" value={settlementForm.periodEnd} onChange={(event) => setSettlementForm({ ...settlementForm, periodEnd: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Payment reference (optional until paid)</span><input value={settlementForm.paymentReference} onChange={(event) => setSettlementForm({ ...settlementForm, paymentReference: event.target.value })} placeholder="Bank transfer, payout, or processor reference" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Reason for snapshot *</span><input required maxLength={1000} value={settlementForm.reason} onChange={(event) => setSettlementForm({ ...settlementForm, reason: event.target.value })} placeholder="Why is this settlement snapshot being created?" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><div className="flex flex-wrap items-end gap-3 sm:col-span-2"><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> Create snapshot</button><label className="min-w-[220px] flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Reason for reconciliation *</span><input required={false} maxLength={1000} value={reconciliationReason} onChange={(event) => setReconciliationReason(event.target.value)} placeholder="Why is this ledger check being run?" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><button type="button" disabled={busy} onClick={runReconciliation} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> Reconcile ledger</button></div>{reconciliation && <div className={`rounded-xl border px-3 py-3 text-xs sm:col-span-2 ${reconciliation.status === 'balanced' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' : 'border-red-500/30 bg-red-950/20 text-red-300'}`}>Last run: <strong>{reconciliation.status}</strong> · Difference {money(reconciliation.differenceCents, reconciliation.currencyCode || settlementForm.currencyCode)} · {reconciliation.entryCount} journal entries · Integrity scope: {reconciliation.scope === 'all_time_ledger' ? 'all-time ledger' : 'unknown'}<IntegritySummary integrity={reconciliation.integrity} /></div>}</form><div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[920px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Period</th><th className="px-3 py-3 font-medium">Net payable</th><th className="px-3 py-3 font-medium">Status / provenance</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{!settlements.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">No settlement snapshots yet.</td></tr> : settlements.map((settlement) => <tr key={settlement.id}><td className="px-3 py-3 text-white">{settlement.restaurantName || `Partner ${settlement.partnerId}`}<p className="mt-1 text-gray-600">Gross {money(settlement.grossCents, settlement.currencyCode)} · refunds {money(settlement.refundCents, settlement.currencyCode)}</p></td><td className="px-3 py-3 text-gray-400">{dateTime(settlement.periodStart)}<br />to {dateTime(settlement.periodEnd)}</td><td className="px-3 py-3 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</td><td className="px-3 py-3"><Badge status={settlement.status} /><p className="mt-1 break-all text-[10px] text-gray-600">Created by {settlement.createdBy || 'system'}</p>{settlement.approvedBy && <p className="mt-1 break-all text-[10px] text-sky-300">Approved by {settlement.approvedBy}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{settlement.status === 'pending' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'approved')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Approve</button>}{settlement.status === 'approved' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'paid')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Mark paid</button>}{['pending', 'approved'].includes(settlement.status) && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'voided')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Void</button>}</div></td></tr>)}</tbody></table></div></div></Section>

    <Section eyebrow="Reconciliation history" title="Ledger check history" detail="Every check is preserved as a separate operational record. Use the difference and entry counts to decide whether a settlement is safe to approve; no reconciliation action changes balances." action={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={downloadReconciliationHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>Status</span><select aria-label="Reconciliation status filter" value={reconciliationStatus} onChange={(event) => setReconciliationStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">All statuses</option><option value="balanced">Balanced</option><option value="difference">Difference</option><option value="failed">Failed</option></select></label><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>Currency</span><select aria-label="Reconciliation currency filter" value={reconciliationCurrency} onChange={(event) => setReconciliationCurrency(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">All</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>{reconciliationPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendReconciliationRuns: true, reconciliationOffset: reconciliationPagination.nextOffset || 0 })} disabled={loadingMoreReconciliationRuns || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreReconciliationRuns ? 'Loading...' : 'Load older'}</button>}</div>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Run</th><th className="px-3 py-3 font-medium">Requested period</th><th className="px-3 py-3 font-medium">Result</th><th className="px-3 py-3 font-medium">Balances</th><th className="px-3 py-3 font-medium">Scope</th></tr></thead><tbody className="divide-y divide-gray-800">{!reconciliationRuns.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">No reconciliation runs match these filters.</td></tr> : reconciliationRuns.map((run) => <tr key={run.id}><td className="px-3 py-3 text-gray-400">{dateTime(run.startedAt)}<p className="mt-1 font-mono text-[10px] text-gray-700">{run.id}</p></td><td className="px-3 py-3 text-gray-400">{dateTime(run.periodStart)}<br />to {dateTime(run.periodEnd)}</td><td className="px-3 py-3"><Badge status={run.status} /><p className="mt-1 text-gray-600">{run.currencyCode} · {run.accountCount} accounts · {run.entryCount} entries</p><IntegritySummary integrity={run.metadata?.hashIntegrity} /></td><td className="px-3 py-3 text-gray-400">Accounts {money(run.accountBalanceCents, run.currencyCode)}<br />Journal {money(run.journalBalanceCents, run.currencyCode)}<br /><strong className={run.differenceCents === 0 ? 'text-emerald-300' : 'text-red-300'}>Difference {money(run.differenceCents, run.currencyCode)}</strong></td><td className="px-3 py-3 text-gray-500">{run.metadata?.scope === 'all_time_ledger' ? 'All-time ledger' : 'Recorded scope unavailable'}</td></tr>)}</tbody></table></div></Section>

    <Section eyebrow="Disputes" title="Credit dispute queue" detail="Disputes preserve the original journal transaction. Filter by lifecycle state and load older cases from the server; resolve with a documented outcome and use a separate compensating refund or adjustment rather than editing history." action={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={downloadDisputeHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>Status</span><select value={disputeStatus} onChange={(event) => setDisputeStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">All statuses</option><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select></label>{disputePagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendDisputes: true, disputeOffset: disputePagination.nextOffset || 0 })} disabled={loadingMoreDisputes || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreDisputes ? "Loading..." : "Load older"}</button>}</div>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Customer / restaurant</th><th className="px-3 py-3 font-medium">Transaction</th><th className="px-3 py-3 font-medium">Reason</th><th className="px-3 py-3 font-medium">Description</th><th className="px-3 py-3 font-medium">Opened</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{!disputes.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">No disputes match this status.</td></tr> : disputes.map((dispute) => <tr key={dispute.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{dispute.customerId}</span><p className="mt-1 text-gray-600">{dispute.restaurantName || 'OxSteed Credit'}</p><button type="button" disabled={busy} onClick={() => inspectDisputeCustomer(dispute)} className="mt-2 rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">Open Customer 360</button></td><td className="px-3 py-3 text-gray-400">{dispute.amountCents !== null && dispute.amountCents !== undefined ? <strong className="block text-emerald-300">{money(dispute.amountCents, dispute.currencyCode || 'USD')}</strong> : <strong className="block text-gray-600">Amount unavailable</strong>}<span className="mt-1 block font-mono text-[10px] text-gray-600">{String(dispute.transactionType || 'transaction').replace(/_/g, ' ')} · {dispute.transactionId}</span>{dispute.referenceId && <span className="mt-1 block break-all font-mono text-[10px] text-gray-700">Ref {dispute.referenceId}</span>}</td><td className="px-3 py-3"><Badge status={dispute.status} /><p className="mt-1 text-gray-500">{dispute.reasonCode}</p></td><td className="max-w-[280px] px-3 py-3 text-gray-400">{dispute.description}<textarea aria-label={`Resolution note for dispute ${dispute.id}`} value={disputeResolutionDrafts[dispute.id] || ''} onChange={(event) => setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))} maxLength={4000} rows={2} placeholder="Required to resolve or reject" className="mt-3 w-full min-w-[220px] resize-y rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-400" /></td><td className="px-3 py-3 text-gray-500">{dateTime(dispute.openedAt)}{dispute.postedAt && <p className="mt-1 text-gray-600">Posted {dateTime(dispute.postedAt)}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => resolveDispute(dispute, 'in_review')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Review</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Resolve</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'rejected')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Reject</button></div></td></tr>)}</tbody></table></div></Section>

    <Section eyebrow="Audit history" title="OxSteed Credit control trail" detail="Every rail, partner, agreement, entitlement, account, dispute, and ledger action is append-only. Use this view to reconstruct why a customer or restaurant state changed." action={<button type="button" onClick={downloadAuditHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Action</th><th className="px-3 py-3 font-medium">Resource</th><th className="px-3 py-3 font-medium">Actor / customer</th><th className="px-3 py-3 font-medium">Reason</th><th className="px-3 py-3 font-medium">Integrity</th><th className="px-3 py-3 font-medium">Changes</th></tr></thead><tbody className="divide-y divide-gray-800">{!auditEvents.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">No OxSteed Credit audit events yet.</td></tr> : auditEvents.map((event) => <tr key={event.id}><td className="px-3 py-3 text-gray-500">{dateTime(event.createdAt)}</td><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{event.actionType}</span></td><td className="px-3 py-3 text-gray-400">{event.resourceType}<p className="mt-1 font-mono text-[10px] text-gray-600">{event.resourceId}</p></td><td className="px-3 py-3 text-gray-400">{event.actorUserId || 'System'}{event.customerId && <p className="mt-1 font-mono text-[10px] text-gray-600">Customer {event.customerId}</p>}{event.correlationId && <p className="mt-1 break-all font-mono text-[10px] text-gray-600">Request {event.correlationId}</p>}</td><td className="max-w-[280px] px-3 py-3 text-gray-400">{event.reason || 'No reason recorded'}</td><td className="px-3 py-3 text-gray-500">{event.eventHash ? <details><summary className="cursor-pointer text-emerald-300">Chain evidence</summary><p className="mt-2 break-all font-mono text-[10px] text-gray-600">Event {event.eventHash}</p><p className="mt-1 break-all font-mono text-[10px] text-gray-700">Previous {event.previousEventHash || 'Genesis'}</p></details> : <span className="text-gray-700">Legacy event</span>}</td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">View state</summary><pre className="mt-2 max-w-[360px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify({ before: event.beforeState, after: event.afterState }, null, 2)}</pre></details></td></tr>)}</tbody></table></div></Section>

    <div className="rounded-2xl border border-amber-500/20 bg-amber-950/15 p-4 text-xs leading-5 text-amber-200"><strong>Operational boundary:</strong> OxSteed Credit is implemented as restricted stored value. Do not market it as a bank, deposit account, cash equivalent, or money-transmission product without a separate legal/compliance review, custody plan, partner contracts, and any required licensing.</div>
  </main></>;
}
