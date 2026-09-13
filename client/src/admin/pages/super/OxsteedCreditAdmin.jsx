import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Store,
  WalletCards,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import OxsteedCreditEntitlements from './OxsteedCreditEntitlements';
import OxsteedCreditCustomerDetail from './OxsteedCreditCustomerDetail';

const DEFAULT_CURRENCY_OPTIONS = ['USD', 'CAD', 'MXN', 'DOP', 'HTG', 'EUR', 'GBP', 'AED', 'SAR', 'EGP', 'MAD', 'NGN', 'BRL'];
const CUSTOMER_ACCOUNT_PAGE_SIZE = 50;

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((Number(cents) || 0) / 100);
  } catch {
    return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function dollarsToCents(value) {
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

function dateTime(value) {
  if (!value) return 'No activity';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status) {
  if (status === 'enabled') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'pending' || status === 'pending_approval') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'suspended') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'terminated' || status === 'expired') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{String(status || 'unknown').replace(/_/g, ' ')}</span>;
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
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Section({ eyebrow, title, detail, children, action }) {
  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>{detail && <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{detail}</p>}</div>{action}</div>{children}</section>;
}

export default function OxsteedCreditAdmin() {
  const [overview, setOverview] = useState(null);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [partners, setPartners] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [settlementStatus, setSettlementStatus] = useState('');
  const [settlementPagination, setSettlementPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreSettlements, setLoadingMoreSettlements] = useState(false);
  const [disputes, setDisputes] = useState([]);
  const [disputeStatus, setDisputeStatus] = useState('');
  const [disputePagination, setDisputePagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreDisputes, setLoadingMoreDisputes] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const [rail, setRail] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [partnerForm, setPartnerForm] = useState({ restaurantId: '', settlementCurrencyCode: 'USD', notes: '' });
  const [agreementForm, setAgreementForm] = useState({ partnerId: '', startsAt: new Date().toISOString().slice(0, 16), endsAt: '', customerTerms: '', allowedOrderTypes: 'pickup, delivery, dine_in', allowedCategories: '', allowedMenuItemIds: '', coverageCities: '', coverageStates: '', coveragePostalCodes: '', coverageCountries: '', maxTransaction: '', dailyLimit: '', lifetimeLimit: '', requiresCustomerEntitlement: false });
  const [settlementForm, setSettlementForm] = useState({ partnerId: '', agreementId: '', currencyCode: 'USD', periodStart: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 16), periodEnd: new Date().toISOString().slice(0, 16), paymentReference: '' });
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
  const [disputeResolutionDrafts, setDisputeResolutionDrafts] = useState({});
  const loadRequestRef = useRef(0);

  const load = useCallback(async ({ quiet = false, customerAccountsParams, appendSettlements = false, settlementOffset = 0, appendDisputes = false, disputeOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    if (appendSettlements) setLoadingMoreSettlements(true);
    if (appendDisputes) setLoadingMoreDisputes(true);
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
      const settlementParams = { limit: 50, offset: appendSettlements ? settlementOffset : 0 };
      if (settlementStatus) settlementParams.status = settlementStatus;
      const disputeParams = { limit: 50, offset: appendDisputes ? disputeOffset : 0 };
      if (disputeStatus) disputeParams.status = disputeStatus;
      const [overviewResponse, customerAccountsResponse, partnersResponse, agreementsResponse, settlementsResponse, disputesResponse, auditEventsResponse, railResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/accounts', { params: walletParams }).catch(() => ({ data: { accounts: [], total: 0, limit: CUSTOMER_ACCOUNT_PAGE_SIZE, offset: walletParams.offset, hasMore: false } })),
        adminApi.get('/admin/super/oxsteed-credit/partners'),
        adminApi.get('/admin/super/oxsteed-credit/agreements'),
        adminApi.get('/admin/super/oxsteed-credit/settlements', { params: settlementParams }),
        adminApi.get('/admin/super/oxsteed-credit/disputes', { params: disputeParams }),
        adminApi.get('/admin/super/oxsteed-credit/audit-events').catch(() => ({ data: { auditEvents: [] } })),
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
      setAgreements(agreementsResponse.data?.agreements || []);
      const loadedSettlements = settlementsResponse.data?.settlements || [];
      if (appendSettlements) setSettlements((current) => [...current, ...loadedSettlements]);
      else setSettlements(loadedSettlements);
      setSettlementPagination(settlementsResponse.data?.pagination || { limit: settlementParams.limit, offset: settlementParams.offset, hasMore: false, nextOffset: null });
      const loadedDisputes = disputesResponse.data?.disputes || [];
      if (appendDisputes) setDisputes((current) => [...current, ...loadedDisputes]);
      else setDisputes(loadedDisputes);
      setDisputePagination(disputesResponse.data?.pagination || { limit: disputeParams.limit, offset: disputeParams.offset, hasMore: false, nextOffset: null });
      setAuditEvents(auditEventsResponse.data?.auditEvents || []);
      setRail(railResponse.data?.rail || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) {
        setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to load OxSteed Credit administration.');
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendSettlements) setLoadingMoreSettlements(false);
        if (appendDisputes) setLoadingMoreDisputes(false);
      }
    }
  }, [customerAccountQuery, disputeStatus, settlementStatus]);

  useEffect(() => { load(); }, [load]);

  const selectedPartner = useMemo(() => partners.find((partner) => String(partner.partnerId) === String(agreementForm.partnerId)), [agreementForm.partnerId, partners]);
  const settlementAgreements = useMemo(() => agreements.filter((agreement) => String(agreement.partnerId) === String(settlementForm.partnerId)), [agreements, settlementForm.partnerId]);

  const registerPartner = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post('/admin/super/oxsteed-credit/partners', { restaurantId: partnerForm.restaurantId, settlementCurrencyCode: partnerForm.settlementCurrencyCode, notes: partnerForm.notes || undefined });
      setNotice('Partner enrollment created in Pending status. Activate it after confirming the agreement.');
      setPartnerForm({ restaurantId: '', settlementCurrencyCode: 'USD', notes: '' });
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
        maxTransactionCents: dollarsToCents(agreementForm.maxTransaction),
        dailyCustomerLimitCents: dollarsToCents(agreementForm.dailyLimit),
        lifetimeCustomerLimitCents: dollarsToCents(agreementForm.lifetimeLimit),
        requiresCustomerEntitlement: agreementForm.requiresCustomerEntitlement,
      }, { headers: { 'Idempotency-Key': requestKey('credit-agreement') } });
      setNotice(`Agreement created for ${selectedPartner?.restaurantName || 'the selected partner'} in Draft status.`);
      setAgreementForm((current) => ({ ...current, customerTerms: '', allowedCategories: '', allowedMenuItemIds: '', coverageCities: '', coverageStates: '', coveragePostalCodes: '', coverageCountries: '', maxTransaction: '', dailyLimit: '', lifetimeLimit: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Agreement creation failed.');
    } finally { setBusy(false); }
  };

  const transitionPartner = async (partner, status) => {
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${partner.partnerId}/transition`, { status, reason: `Super Admin moved partner to ${status}` });
      setNotice(`${partner.restaurantName || 'Partner'} moved to ${status}.`);
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Partner status change failed.');
    } finally { setBusy(false); }
  };

  const transitionAgreement = async (agreement, status) => {
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/agreements/${agreement.id}/transition`, { status, reason: `Super Admin moved agreement to ${status}` });
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
      }, { headers: { 'Idempotency-Key': requestKey('credit-settlement') } });
      setNotice('Settlement snapshot created in Pending status. Review the totals before approving payment.');
      setSettlementForm((current) => ({ ...current, paymentReference: '' }));
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Settlement creation failed.');
    } finally { setBusy(false); }
  };

  const transitionSettlement = async (settlement, status) => {
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/settlements/${settlement.id}/status`, { status, reason: `Super Admin moved settlement to ${status}`, paymentReference: settlement.paymentReference || undefined });
      setNotice(`Settlement for ${settlement.restaurantName || 'partner'} moved to ${status}.`);
      await load({ quiet: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Settlement status change failed.');
    } finally { setBusy(false); }
  };

  const runReconciliation = async () => {
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/reconciliation', {
        currencyCode: settlementForm.currencyCode || 'USD',
        periodStart: new Date(settlementForm.periodStart).toISOString(),
        periodEnd: new Date(settlementForm.periodEnd).toISOString(),
      });
      setReconciliation(response.data?.run || null);
      setNotice(response.data?.run?.status === 'balanced' ? 'OxSteed Credit reconciliation is balanced.' : 'Reconciliation found a difference. Review the run before any payout.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Reconciliation failed.');
    } finally { setBusy(false); }
  };

  const loadCustomerCredit = async (event) => {
    event.preventDefault();
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/customers/${customerForm.customerId}/loads`, { amountCents: dollarsToCents(customerForm.amount), currencyCode: customerForm.currencyCode, fundingReference: customerForm.fundingReference, reason: customerForm.reason }, { headers: { 'Idempotency-Key': requestKey('credit-load') } });
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
      await adminApi.post(`/admin/super/oxsteed-credit/customers/${customerForm.customerId}/adjustments`, { amountCents: dollarsToCents(customerForm.amount), currencyCode: customerForm.currencyCode, direction: 'debit', reason: customerForm.reason }, { headers: { 'Idempotency-Key': requestKey('credit-adjustment') } });
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

  const resolveDispute = async (dispute, status) => {
    const resolution = String(disputeResolutionDrafts[dispute.id] || '').trim();
    if (['resolved', 'rejected'].includes(status) && !resolution) {
      setError('Add a resolution note before closing a Credit dispute.');
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
  return <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
    <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-300">Super Admin</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> Stored-value control</span></div><h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">OxSteed Credit</h1><p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">Operate a restricted credit network: customers can spend only at restaurants with an active partner agreement, and every movement is journaled, bounded, and auditable.</p></div><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh</button></div></header>
    <section className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Emergency control</p><h2 className="mt-1 text-lg font-semibold text-white">OxSteed Credit rail</h2><p className="mt-1 text-xs leading-5 text-gray-400">This gate controls new loads, holds, purchases, and transfers. Suspending it does not edit or delete ledger history, and every change is recorded in the Credit audit trail.</p></div><Badge status={rail ? (rail.enabled ? 'enabled' : 'suspended') : 'unknown'} /></div><form onSubmit={updateRail} className="mt-4 flex flex-col gap-3 border-t border-amber-500/15 pt-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Required audit reason</span><input value={railReason} onChange={(event) => setRailReason(event.target.value)} maxLength={1000} placeholder={rail?.enabled ? 'Why are you suspending the rail?' : 'Why are you enabling the rail?'} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={!rail || busy || !railReason.trim()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${rail?.enabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}><Power className="h-4 w-4" />{rail?.enabled ? 'Suspend rail' : 'Enable rail'}</button></form></section>
    {error && <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={WalletCards} label={`Customer balance (${summary.currencyCode || 'USD'})`} value={money(summary.customerBalanceCents, summary.currencyCode)} detail={`${summary.customerAccounts || 0} customer accounts`} /><Metric icon={CreditCard} label={`Available (${summary.currencyCode || 'USD'})`} value={money(summary.customerAvailableCents, summary.currencyCode)} detail={`${money(summary.customerReservedCents, summary.currencyCode)} reserved`} tone="text-emerald-300" /><Metric icon={Store} label={`Partner payable (${summary.currencyCode || 'USD'})`} value={money(summary.partnerPayableCents, summary.currencyCode)} detail={`${summary.partnerAccounts || 0} partner accounts`} tone="text-sky-300" /><Metric icon={FileCheck2} label="Partner network" value={partners.length} detail={`${partners.filter((partner) => partner.status === 'active').length} active partners`} /><Metric icon={AlertTriangle} label="Inactive accounts" value={summary.inactiveAccounts || 0} detail="Needs review before spending" tone="text-amber-300" /></section>
    {summaryByCurrency.length > 1 && <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Currency controls</p><h2 className="mt-1 text-lg font-semibold text-white">Balances by currency</h2></div><span className="text-xs text-gray-500">No automatic foreign-exchange conversion</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaryByCurrency.map((currencySummary) => <div key={currencySummary.currencyCode} className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm text-white">{currencySummary.currencyCode}</strong><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{currencySummary.customerAccounts || 0} wallets</span></div><p className="mt-2 text-lg font-semibold text-emerald-300">{money(currencySummary.customerAvailableCents, currencySummary.currencyCode)}</p><p className="mt-1 text-xs text-gray-500">Customer available · {money(currencySummary.partnerPayableCents, currencySummary.currencyCode)} partner payable</p></div>)}</div></section>}
    <Section eyebrow="Ledger activity" title="Latest Credit movements" detail="A bounded view of the newest ledger transactions. Open the customer wallet or audit trail for the complete history and supporting details."><div className="mt-4 overflow-x-auto rounded-xl border border-gray-800">{!overview?.recentTransactions?.length ? <div className="py-10 text-center text-sm text-gray-500">No Credit movements recorded yet.</div> : <table className="min-w-[820px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Transaction</th><th className="px-3 py-3 font-medium">Party</th><th className="px-3 py-3 font-medium">Reference</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">When</th></tr></thead><tbody className="divide-y divide-gray-800">{overview.recentTransactions.slice(0, 12).map((transaction) => <tr key={transaction.id}><td className="px-3 py-3"><strong className="capitalize text-white">{creditTransactionLabel(transaction)}</strong><p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.id}</p></td><td className="max-w-[240px] break-all px-3 py-3 text-gray-400">{transactionPartyLabel(transaction)}</td><td className="max-w-[220px] break-all px-3 py-3 text-gray-500">{transaction.referenceType || 'No reference'}{transaction.referenceId ? <p className="mt-1 font-mono text-[10px] text-gray-700">{transaction.referenceId}</p> : null}</td><td className="px-3 py-3 font-semibold text-emerald-300">{money(transaction.amountCents, transaction.currencyCode)}</td><td className="px-3 py-3"><Badge status={transaction.status} /></td><td className="px-3 py-3 text-gray-500">{dateTime(transaction.postedAt || transaction.createdAt)}</td></tr>)}</tbody></table>}</div></Section>
    {riskLimits && <Section eyebrow="Issuance guardrails" title="Funding and wallet limits" detail="These server-side caps apply inside the same transaction as each grant or positive adjustment. Values are shown in the selected overview currency's minor units."><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">Per transaction</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTransactionCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Hard cap for one movement</span></div><div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">Per customer wallet</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxCustomerBalanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Maximum outstanding balance</span></div><div className="rounded-xl border border-violet-500/20 bg-violet-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300">Global outstanding</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxTotalIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">All customer wallets per currency</span></div><div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">Daily per customer</span><strong className="mt-2 block text-lg text-white">{money(riskLimits.maxDailyCustomerIssuanceCents, summary.currencyCode)}</strong><span className="mt-1 block text-xs text-gray-500">Loads and grants in the DB day</span></div></div></Section>}

    <Section eyebrow="Customer wallets" title="Find a wallet before taking action" detail="Search by customer name, email, UUID, currency, or state. Filters run on the server so the directory remains complete as the customer base grows. Selecting a wallet only fills the controls below; no balance or status changes happen until you submit a form."><div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]"><label><span className="mb-1 block text-xs font-semibold text-gray-500">Search wallets</span><input value={customerAccountSearch} onChange={(event) => setCustomerAccountSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyCustomerAccountFilters(); }} placeholder="Name, email, UUID, or currency" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Account state</span><select value={customerAccountStatus} onChange={(event) => setCustomerAccountStatus(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="all">All states</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option></select></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Currency</span><select value={customerAccountCurrency} onChange={(event) => setCustomerAccountCurrency(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="all">All currencies</option>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-gray-500">Showing {customerAccounts.length ? customerAccountOffset + 1 : 0}–{customerAccountOffset + customerAccounts.length} of {customerAccountTotal} matching wallets</div><div className="flex flex-wrap gap-2"><button type="button" onClick={applyCustomerAccountFilters} disabled={loading || busy} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Apply filters</button><button type="button" onClick={clearCustomerAccountFilters} disabled={loading || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Clear</button><button type="button" onClick={() => moveCustomerAccountPage(Math.max(0, customerAccountOffset - CUSTOMER_ACCOUNT_PAGE_SIZE))} disabled={loading || busy || customerAccountOffset === 0} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Previous</button><button type="button" onClick={() => moveCustomerAccountPage(customerAccountOffset + CUSTOMER_ACCOUNT_PAGE_SIZE)} disabled={loading || busy || !customerAccountHasMore} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Next</button></div></div><div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1060px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Customer</th><th className="px-3 py-3 font-medium">Currency</th><th className="px-3 py-3 font-medium">Balance</th><th className="px-3 py-3 font-medium">Available</th><th className="px-3 py-3 font-medium">State</th><th className="px-3 py-3 font-medium">Updated</th><th className="px-3 py-3 font-medium">Action</th></tr></thead><tbody className="divide-y divide-gray-800">{!filteredCustomerAccounts.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">No customer wallets match these filters.</td></tr> : filteredCustomerAccounts.map((account) => <tr key={account.accountId}><td className="px-3 py-3"><strong className="text-white">{account.name || 'Unnamed customer'}</strong><p className="mt-1 text-gray-500">{account.email || 'No email'} </p><p className="mt-1 font-mono text-[10px] text-gray-700">{account.customerId}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{account.currencyCode}</td><td className="px-3 py-3 text-gray-300">{money(account.balanceCents, account.currencyCode)}</td><td className="px-3 py-3 text-emerald-300">{money(account.availableBalanceCents, account.currencyCode)}</td><td className="px-3 py-3"><Badge status={account.status} />{account.isBanned && <p className="mt-1 text-[10px] text-red-300">Platform banned</p>}</td><td className="px-3 py-3 text-gray-500">{dateTime(account.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => inspectCustomerAccount(account)} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">View details</button><button type="button" disabled={busy} onClick={() => selectCustomerAccount(account)} className="rounded-lg border border-gray-700 px-2.5 py-2 font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Use wallet</button></div></td></tr>)}</tbody></table></div></div></Section>

    {customerDetailAccount && <OxsteedCreditCustomerDetail account={customerDetailAccount} busy={busy} onClose={() => setCustomerDetailAccount(null)} />}

    <Section eyebrow="Customer controls" title="Grant, adjust, or freeze OxSteed Credit" detail="Every grant requires a funding reference. Clawbacks require a reason. Account suspension blocks spend without deleting the customer’s history; closing requires zero balance and no active holds."><div className="mt-5 grid gap-6 xl:grid-cols-3"><form onSubmit={loadCustomerCredit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">Grant credit</h3><input required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} placeholder="Customer UUID" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required inputMode="decimal" value={customerForm.amount} onChange={(event) => setCustomerForm({ ...customerForm, amount: event.target.value })} placeholder="Amount in local currency" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={customerForm.currencyCode} onChange={(event) => setCustomerForm({ ...customerForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><input required value={customerForm.fundingReference} onChange={(event) => setCustomerForm({ ...customerForm, fundingReference: event.target.value })} placeholder="Funding reference" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required value={customerForm.reason} onChange={(event) => setCustomerForm({ ...customerForm, reason: event.target.value })} placeholder="Reason" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Post grant</button></form><form onSubmit={adjustCustomerCredit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">Claw back credit</h3><input required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} placeholder="Customer UUID" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><input required inputMode="decimal" value={customerForm.amount} onChange={(event) => setCustomerForm({ ...customerForm, amount: event.target.value })} placeholder="Amount in local currency" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={customerForm.currencyCode} onChange={(event) => setCustomerForm({ ...customerForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><input required value={customerForm.reason} onChange={(event) => setCustomerForm({ ...customerForm, reason: event.target.value })} placeholder="Reason for clawback" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><span className="text-xs leading-5 text-gray-600">The same customer ID and amount fields are shared with the grant form above for consistent operator entry.</span><button disabled={busy} className="rounded-xl border border-amber-500/40 px-4 py-3 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Post clawback</button></form><form onSubmit={updateAccountStatus} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4"><h3 className="text-sm font-semibold text-white">Account safety state</h3><input required value={accountStatusForm.customerId} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, customerId: event.target.value })} placeholder="Customer UUID" className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><select value={accountStatusForm.currencyCode} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, currencyCode: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><select value={accountStatusForm.status} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, status: event.target.value })} className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option></select><input required value={accountStatusForm.reason} onChange={(event) => setAccountStatusForm({ ...accountStatusForm, reason: event.target.value })} placeholder="Reason" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><button disabled={busy} className="rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Update account state</button></form></div></Section>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Section eyebrow="Partner enrollment" title="Add a restaurant partner" detail="Enrollment starts as Pending. Activate only after confirming commercial terms, settlement, and customer eligibility."><form onSubmit={registerPartner} className="mt-5 grid gap-3 sm:grid-cols-3"><label className="sm:col-span-1"><span className="mb-1 block text-xs font-semibold text-gray-500">Restaurant ID</span><input required value={partnerForm.restaurantId} onChange={(event) => setPartnerForm({ ...partnerForm, restaurantId: event.target.value })} placeholder="e.g. 12" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Settlement currency</span><select required value={partnerForm.settlementCurrencyCode} onChange={(event) => setPartnerForm({ ...partnerForm, settlementCurrencyCode: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">Select currency</option>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><label className="sm:col-span-3"><span className="mb-1 block text-xs font-semibold text-gray-500">Internal notes</span><textarea value={partnerForm.notes} onChange={(event) => setPartnerForm({ ...partnerForm, notes: event.target.value })} rows={2} placeholder="Settlement or partnership notes" className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"><Plus className="h-4 w-4" /> Enroll partner</button></form></Section>
    <Section eyebrow="Agreement builder" title="Create a spending agreement" detail="Draft the restaurant's rules first. It must be approved and activated before customer checkout can use it.">
      <form onSubmit={createAgreement} className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Partner</span>
          <select required value={agreementForm.partnerId} onChange={(event) => setAgreementForm({ ...agreementForm, partnerId: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">
            <option value="">Select partner</option>
            {partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Restaurant ${partner.restaurantId}`} · {partner.status}</option>)}
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
        <button disabled={busy || !partners.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> Create draft agreement</button>
      </form>
    </Section>
    </div>

    <Section eyebrow="Partner network" title="Restaurants and agreements" detail="A partner must be Active and have an Active agreement before it appears in customer eligibility results."><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{loading && !overview ? <div className="flex items-center justify-center py-14 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Currency</th><th className="px-3 py-3 font-medium">Partner</th><th className="px-3 py-3 font-medium">Agreements</th><th className="px-3 py-3 font-medium">Updated</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{partners.map((partner) => <tr key={partner.partnerId}><td className="px-3 py-3"><strong className="text-white">{partner.restaurantName || `Restaurant ${partner.restaurantId}`}</strong><p className="mt-1 text-gray-600">Restaurant ID {partner.restaurantId}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{partner.settlementCurrencyCode || 'USD'}</td><td className="px-3 py-3"><Badge status={partner.status} /></td><td className="px-3 py-3 text-gray-400">{partner.activeAgreementCount} active / {partner.agreementCount} total</td><td className="px-3 py-3 text-gray-500">{dateTime(partner.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{partner.status === 'pending' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Activate</button>}{partner.status === 'active' && <button disabled={busy} onClick={() => transitionPartner(partner, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Suspend</button>}{partner.status === 'suspended' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Reactivate</button>}</div></td></tr>)}</tbody></table>}</div></Section>

    <Section eyebrow="Agreement lifecycle" title="Active and pending terms" detail="Use lifecycle transitions instead of deleting agreements so the historical record remains intact."><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{!agreements.length ? <div className="py-14 text-center text-sm text-gray-500">No agreements created yet.</div> : <table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Version</th><th className="px-3 py-3 font-medium">Lifecycle</th><th className="px-3 py-3 font-medium">Coverage</th><th className="px-3 py-3 font-medium">Limits</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{agreements.map((agreement) => <tr key={agreement.id}><td className="px-3 py-3 text-white">{agreement.restaurantName || 'Partner restaurant'}<p className="mt-1 text-gray-600">{dateTime(agreement.startsAt)}{agreement.endsAt ? ` to ${dateTime(agreement.endsAt)}` : ''}</p></td><td className="px-3 py-3 text-gray-400">v{agreement.version}</td><td className="px-3 py-3"><Badge status={agreement.status} /></td><td className="max-w-[240px] px-3 py-3 text-gray-400">{agreement.requiresCustomerEntitlement ? <p className="font-semibold text-amber-300">Assigned customers only</p> : <p className="font-semibold text-emerald-300">Partner-wide</p>}{(agreement.allowedOrderTypes || []).join(', ') || 'No order types set'}{agreement.allowedCategories?.length ? <p className="mt-1 text-gray-600">{agreement.allowedCategories.join(', ')}</p> : null}{agreement.allowedMenuItemIds?.length ? <p className="mt-1 text-gray-600">{agreement.allowedMenuItemIds.length} menu items restricted</p> : null}{geographyLabel(agreement.geography) ? <p className="mt-1 break-words text-sky-300">{geographyLabel(agreement.geography)}</p> : <p className="mt-1 text-gray-600">All restaurant locations</p>}</td><td className="px-3 py-3 text-gray-400"><span className="font-semibold text-sky-300">{agreement.settlementCurrencyCode || 'USD'}</span><br />{agreement.maxTransactionCents ? money(agreement.maxTransactionCents, agreement.settlementCurrencyCode) : 'No per-transaction cap'}{agreement.dailyCustomerLimitCents ? <p className="mt-1 text-gray-600">Daily {money(agreement.dailyCustomerLimitCents, agreement.settlementCurrencyCode)}</p> : null}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{agreement.status === 'draft' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'pending_approval')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Submit</button>}{agreement.status === 'pending_approval' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Approve & activate</button>}{agreement.status === 'active' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Suspend</button>}{agreement.status === 'suspended' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Reactivate</button>}</div></td></tr>)}</tbody></table>}</div></Section>

    <OxsteedCreditEntitlements agreements={agreements} customerAccounts={customerAccounts} busy={busy} />

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-[#111318] p-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Settlement queue</p>
        <p className="mt-1 text-xs text-gray-500">Filter settlement history without loading every record at once.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
        {settlementPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendSettlements: true, settlementOffset: settlementPagination.nextOffset || 0 })} disabled={loadingMoreSettlements || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreSettlements ? 'Loading...' : 'Load older'}</button>}
      </div>
    </div>

    <Section eyebrow="Settlement & controls" title="Partner payables and reconciliation" detail="Create a period snapshot, approve it only after review, and mark it paid only with a traceable external payment reference. The reconciliation compares every account balance to its immutable journal entries; its integrity scope is always the all-time ledger for the selected currency."><div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"><form onSubmit={createSettlement} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Partner</span><select required value={settlementForm.partnerId} onChange={(event) => { const nextPartner = partners.find((partner) => String(partner.partnerId) === event.target.value); setSettlementForm({ ...settlementForm, partnerId: event.target.value, agreementId: '', currencyCode: nextPartner?.settlementCurrencyCode || 'USD' }); }} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">Select partner</option>{partners.filter((partner) => partner.status === 'active').map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Restaurant ${partner.restaurantId}`} · {partner.settlementCurrencyCode || 'USD'}</option>)}</select></label><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Agreement</span><select required value={settlementForm.agreementId} onChange={(event) => setSettlementForm({ ...settlementForm, agreementId: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">Select agreement</option>{settlementAgreements.map((agreement) => <option key={agreement.id} value={agreement.id}>v{agreement.version} · {agreement.status}</option>)}</select></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Currency</span><input value={settlementForm.currencyCode} readOnly className="w-full rounded-xl border border-gray-700 bg-gray-950/70 px-3 py-3 text-sm font-semibold text-sky-300 outline-none" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Period starts</span><input required type="datetime-local" value={settlementForm.periodStart} onChange={(event) => setSettlementForm({ ...settlementForm, periodStart: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label><span className="mb-1 block text-xs font-semibold text-gray-500">Period ends</span><input required type="datetime-local" value={settlementForm.periodEnd} onChange={(event) => setSettlementForm({ ...settlementForm, periodEnd: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Payment reference (optional until paid)</span><input value={settlementForm.paymentReference} onChange={(event) => setSettlementForm({ ...settlementForm, paymentReference: event.target.value })} placeholder="Bank transfer, payout, or processor reference" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label><div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" /> Create snapshot</button><button type="button" disabled={busy} onClick={runReconciliation} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> Reconcile ledger</button></div>{reconciliation && <div className={`rounded-xl border px-3 py-3 text-xs sm:col-span-2 ${reconciliation.status === 'balanced' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' : 'border-red-500/30 bg-red-950/20 text-red-300'}`}>Last run: <strong>{reconciliation.status}</strong> · Difference {money(reconciliation.differenceCents, reconciliation.currencyCode || settlementForm.currencyCode)} · {reconciliation.entryCount} journal entries · Integrity scope: {reconciliation.scope === 'all_time_ledger' ? 'all-time ledger' : 'unknown'}</div>}</form><div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[820px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Period</th><th className="px-3 py-3 font-medium">Net payable</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{!settlements.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">No settlement snapshots yet.</td></tr> : settlements.map((settlement) => <tr key={settlement.id}><td className="px-3 py-3 text-white">{settlement.restaurantName || `Partner ${settlement.partnerId}`}<p className="mt-1 text-gray-600">Gross {money(settlement.grossCents, settlement.currencyCode)} · refunds {money(settlement.refundCents, settlement.currencyCode)}</p></td><td className="px-3 py-3 text-gray-400">{dateTime(settlement.periodStart)}<br />to {dateTime(settlement.periodEnd)}</td><td className="px-3 py-3 font-semibold text-emerald-300">{money(settlement.netCents, settlement.currencyCode)}</td><td className="px-3 py-3"><Badge status={settlement.status} /></td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{settlement.status === 'pending' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'approved')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Approve</button>}{settlement.status === 'approved' && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'paid')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Mark paid</button>}{['pending', 'approved'].includes(settlement.status) && <button disabled={busy} onClick={() => transitionSettlement(settlement, 'voided')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Void</button>}</div></td></tr>)}</tbody></table></div></div></Section>

    <Section eyebrow="Disputes" title="Credit dispute queue" detail="Disputes preserve the original journal transaction. Filter by lifecycle state and load older cases from the server; resolve with a documented outcome and use a separate compensating refund or adjustment rather than editing history." action={<div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs font-semibold text-gray-500"><span>Status</span><select value={disputeStatus} onChange={(event) => setDisputeStatus(event.target.value)} disabled={loading || busy} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">All statuses</option><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select></label>{disputePagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendDisputes: true, disputeOffset: disputePagination.nextOffset || 0 })} disabled={loadingMoreDisputes || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreDisputes ? "Loading..." : "Load older"}</button>}</div>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Customer / restaurant</th><th className="px-3 py-3 font-medium">Transaction</th><th className="px-3 py-3 font-medium">Reason</th><th className="px-3 py-3 font-medium">Description</th><th className="px-3 py-3 font-medium">Opened</th><th className="px-3 py-3 font-medium">Controls</th></tr></thead><tbody className="divide-y divide-gray-800">{!disputes.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">No disputes match this status.</td></tr> : disputes.map((dispute) => <tr key={dispute.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{dispute.customerId}</span><p className="mt-1 text-gray-600">{dispute.restaurantName || 'OxSteed Credit'}</p><button type="button" disabled={busy} onClick={() => inspectDisputeCustomer(dispute)} className="mt-2 rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">Open Customer 360</button></td><td className="px-3 py-3 text-gray-400">{dispute.amountCents !== null && dispute.amountCents !== undefined ? <strong className="block text-emerald-300">{money(dispute.amountCents, dispute.currencyCode || 'USD')}</strong> : <strong className="block text-gray-600">Amount unavailable</strong>}<span className="mt-1 block font-mono text-[10px] text-gray-600">{String(dispute.transactionType || 'transaction').replace(/_/g, ' ')} · {dispute.transactionId}</span>{dispute.referenceId && <span className="mt-1 block break-all font-mono text-[10px] text-gray-700">Ref {dispute.referenceId}</span>}</td><td className="px-3 py-3"><Badge status={dispute.status} /><p className="mt-1 text-gray-500">{dispute.reasonCode}</p></td><td className="max-w-[280px] px-3 py-3 text-gray-400">{dispute.description}<textarea aria-label={`Resolution note for dispute ${dispute.id}`} value={disputeResolutionDrafts[dispute.id] || ''} onChange={(event) => setDisputeResolutionDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))} maxLength={4000} rows={2} placeholder="Required to resolve or reject" className="mt-3 w-full min-w-[220px] resize-y rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 text-xs text-white outline-none focus:border-orange-400" /></td><td className="px-3 py-3 text-gray-500">{dateTime(dispute.openedAt)}{dispute.postedAt && <p className="mt-1 text-gray-600">Posted {dateTime(dispute.postedAt)}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => resolveDispute(dispute, 'in_review')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Review</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'resolved')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Resolve</button><button disabled={busy || !String(disputeResolutionDrafts[dispute.id] || '').trim()} onClick={() => resolveDispute(dispute, 'rejected')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Reject</button></div></td></tr>)}</tbody></table></div></Section>

    <Section eyebrow="Audit history" title="OxSteed Credit control trail" detail="Every rail, partner, agreement, entitlement, account, dispute, and ledger action is append-only. Use this view to reconstruct why a customer or restaurant state changed."><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Action</th><th className="px-3 py-3 font-medium">Resource</th><th className="px-3 py-3 font-medium">Actor / customer</th><th className="px-3 py-3 font-medium">Reason</th><th className="px-3 py-3 font-medium">Changes</th></tr></thead><tbody className="divide-y divide-gray-800">{!auditEvents.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">No OxSteed Credit audit events yet.</td></tr> : auditEvents.map((event) => <tr key={event.id}><td className="px-3 py-3 text-gray-500">{dateTime(event.createdAt)}</td><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{event.actionType}</span></td><td className="px-3 py-3 text-gray-400">{event.resourceType}<p className="mt-1 font-mono text-[10px] text-gray-600">{event.resourceId}</p></td><td className="px-3 py-3 text-gray-400">{event.actorUserId || 'System'}{event.customerId && <p className="mt-1 font-mono text-[10px] text-gray-600">Customer {event.customerId}</p>}</td><td className="max-w-[280px] px-3 py-3 text-gray-400">{event.reason || 'No reason recorded'}</td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">View state</summary><pre className="mt-2 max-w-[360px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify({ before: event.beforeState, after: event.afterState }, null, 2)}</pre></details></td></tr>)}</tbody></table></div></Section>

    <div className="rounded-2xl border border-amber-500/20 bg-amber-950/15 p-4 text-xs leading-5 text-amber-200"><strong>Operational boundary:</strong> OxSteed Credit is implemented as restricted stored value. Do not market it as a bank, deposit account, cash equivalent, or money-transmission product without a separate legal/compliance review, custody plan, partner contracts, and any required licensing.</div>
  </main>;
}
