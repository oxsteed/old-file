import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import { localizeCreditOrderTypes, localizeCreditStatus } from '../../../../lib/creditStatus';
import { SuggestDropdown } from '../../../../components/SuggestDropdown';
import '../../../lib/suggestDropdownAdmin.css';
import { parseOptionalCreditMajorAmount } from '../../../../lib/creditCurrency';
import {
  AdminActionDialog,
  Badge,
  CreditSubNav,
  CUSTOMER_ACCOUNT_PAGE_SIZE,
  DEFAULT_CURRENCY_OPTIONS,
  PARTNER_DIRECTORY_PAGE_SIZE,
  Section,
  buildGeography,
  dateTime,
  geographyLabel,
  money,
  splitList,
  useCreditDialog,
  useCreditPageState,
} from './shared';
import OxsteedCreditPartnerLedger from '../OxsteedCreditPartnerLedger';
import OxsteedCreditEntitlements from '../OxsteedCreditEntitlements';

export default function OxsteedCreditPartnersPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [overview, setOverview] = useState(null);
  const [partners, setPartners] = useState([]);
  const [partnerDirectory, setPartnerDirectory] = useState([]);

  // Typeahead suggestions from the latest loaded partner rows.
  const partnerDirectorySuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const partner of partnerDirectory) {
      if (partner.partnerId == null || seen.has(partner.partnerId)) continue;
      seen.add(partner.partnerId);
      const title = partner.restaurantName || String(partner.partnerId);
      items.push({ id: partner.partnerId, title, meta: partner.settlementCurrencyCode || String(partner.restaurantId || '') || undefined });
    }
    return items;
  }, [partnerDirectory]);
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
  const partnerLookupRequestRef = useRef(0);
  const [partnerForm, setPartnerForm] = useState({ restaurantId: '', settlementCurrencyCode: 'USD', notes: '', reason: '' });
  const [agreementForm, setAgreementForm] = useState({ partnerId: '', startsAt: new Date().toISOString().slice(0, 16), endsAt: '', customerTerms: '', allowedOrderTypes: 'pickup, delivery, dine_in', allowedCategories: '', allowedMenuItemIds: '', coverageCities: '', coverageStates: '', coveragePostalCodes: '', coverageCountries: '', maxTransaction: '', dailyLimit: '', lifetimeLimit: '', requiresCustomerEntitlement: false, reason: '' });
  const [agreements, setAgreements] = useState([]);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const currencyOptions = overview?.supportedCurrencies?.length ? overview.supportedCurrencies : DEFAULT_CURRENCY_OPTIONS;

  const load = useCallback(async ({ quiet = false, appendPartnerDirectory = false, partnerDirectoryOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendPartnerDirectory) setLoading(true);
    if (appendPartnerDirectory) setLoadingMorePartnerDirectory(true);
    setError('');
    try {
      const directoryQuery = partnerDirectoryQuery;
      const partnerDirectoryParams = { limit: PARTNER_DIRECTORY_PAGE_SIZE, offset: appendPartnerDirectory ? partnerDirectoryOffset : 0 };
      if (directoryQuery.search) partnerDirectoryParams.search = directoryQuery.search;
      if (directoryQuery.status) partnerDirectoryParams.status = directoryQuery.status;
      const [overviewResponse, partnersResponse, partnerDirectoryResponse, agreementsResponse, accountResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/partners'),
        adminApi.get('/admin/super/oxsteed-credit/partners/directory', { params: partnerDirectoryParams }),
        adminApi.get('/admin/super/oxsteed-credit/agreements'),
        adminApi.get('/admin/super/oxsteed-credit/accounts', { params: { limit: CUSTOMER_ACCOUNT_PAGE_SIZE, offset: 0 } }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
      setPartners(partnersResponse.data?.partners || []);
      const loadedPartnerDirectory = partnerDirectoryResponse.data?.partners || [];
      if (appendPartnerDirectory) setPartnerDirectory((current) => [...current, ...loadedPartnerDirectory]);
      else setPartnerDirectory(loadedPartnerDirectory);
      setPartnerDirectoryPagination(partnerDirectoryResponse.data?.pagination || { limit: partnerDirectoryParams.limit, offset: partnerDirectoryParams.offset, total: loadedPartnerDirectory.length, hasMore: false, nextOffset: null });
      setAgreements(agreementsResponse.data?.agreements || []);
      setCustomerAccounts(accountResponse.data?.accounts || []);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendPartnerDirectory) setLoadingMorePartnerDirectory(false);
      }
    }
  }, [partnerDirectoryQuery, t]);

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

  const selectablePartners = useMemo(() => {
    const activeOptions = partnerPickerQuery ? partnerOptions : partners;
    const selectedIds = [agreementForm.partnerId].filter(Boolean).map(String);
    const selectedPartners = [...partners, ...partnerOptions].filter((partner) => selectedIds.includes(String(partner.partnerId)));
    return Array.from(new Map([...activeOptions, ...selectedPartners].map((partner) => [String(partner.partnerId), partner])).values());
  }, [agreementForm.partnerId, partnerOptions, partnerPickerQuery, partners]);

  const selectedPartner = useMemo(() => selectablePartners.find((partner) => String(partner.partnerId) === String(agreementForm.partnerId)), [agreementForm.partnerId, selectablePartners]);
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
  return (
    <>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminPartnerNetwork')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminPartnerNetworkDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
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
      <Section eyebrow="Partner network" title="Restaurants and agreements" detail="A partner must be Active and have an Active agreement before it appears in customer eligibility results." action={<div className="flex flex-wrap items-center gap-2"><span className="sr-only">{t('adminSearchPartners')}</span><span className="w-40" onKeyDown={(event) => { if (event.key === 'Enter' && !event.defaultPrevented) applyPartnerDirectoryFilters(); }}><SuggestDropdown
            id="credit-partner-directory-search"
            items={partnerDirectorySuggestItems}
            value={partnerDirectorySearch}
            onQueryChange={setPartnerDirectorySearch}
            onSelect={(item) => {
              const next = item.title || '';
              setPartnerDirectorySearch(next);
              setPartnerDirectoryQuery({
                search: next.trim(),
                status: partnerDirectoryStatus === 'all' ? '' : partnerDirectoryStatus,
                offset: 0,
              });
            }}
            recentsKey="oxsteed_admin_credit_partner_directory_search_recents"
            placeholder={t('adminSearchPartnersPlaceholder')}
            ariaLabel={t('adminSearchPartnersPlaceholder')}
            className="sd-admin-dark"
          /></span><select aria-label={t('adminPartnerStatusFilter')} value={partnerDirectoryStatus} onChange={(event) => setPartnerDirectoryStatus(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="all">{t('adminAllStatuses')}</option><option value="pending">{t('statusPending')}</option><option value="active">{t('statusActive')}</option><option value="suspended">{t('statusSuspended')}</option><option value="terminated">{t('statusTerminated')}</option></select><button type="button" onClick={applyPartnerDirectoryFilters} disabled={loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{t('adminApply')}</button><button type="button" onClick={clearPartnerDirectoryFilters} disabled={loading || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">{t('adminClear')}</button><button type="button" onClick={downloadPartnerDirectory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button></div>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{loading && !overview ? <div className="flex items-center justify-center py-14 text-gray-500"><Loader2 className="h-6 w-6 animate-spin text-orange-400" /></div> : <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminCurrency')}</th><th className="px-3 py-3 font-medium">{t('adminPartner')}</th><th className="px-3 py-3 font-medium">{t('adminAgreements')}</th><th className="px-3 py-3 font-medium">{t('adminUpdated')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!partnerDirectory.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{partnerDirectoryQuery.search || partnerDirectoryQuery.status ? t('adminNoPartnerFilterMatches') : t('adminNoPartnersEnrolled')}</td></tr> : partnerDirectory.map((partner) => <tr key={partner.partnerId}><td className="px-3 py-3"><strong className="text-white">{partner.restaurantName || t('adminRestaurantFallback', { id: partner.restaurantId })}</strong><p className="mt-1 text-gray-600">{t('adminRestaurantIdValue', { id: partner.restaurantId })}</p></td><td className="px-3 py-3 font-semibold text-sky-300">{partner.settlementCurrencyCode || 'USD'}</td><td className="px-3 py-3"><Badge status={partner.status} /></td><td className="px-3 py-3 text-gray-400">{t('adminActiveOfTotal', { active: partner.activeAgreementCount, total: partner.agreementCount })}</td><td className="px-3 py-3 text-gray-500">{dateTime(partner.updatedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{partner.status === 'pending' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminActivate')}</button>}{partner.status === 'active' && <button disabled={busy} onClick={() => transitionPartner(partner, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminSuspend')}</button>}{partner.status === 'suspended' && <button disabled={busy} onClick={() => transitionPartner(partner, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminReactivate')}</button>}</div></td></tr>)}</tbody></table>}</div>{partnerDirectoryPagination.hasMore && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-3 py-3 text-xs text-gray-500"><span>{t('adminShowingPartners', { shown: partnerDirectory.length, total: partnerDirectoryPagination.total })}</span><button type="button" onClick={() => load({ quiet: true, appendPartnerDirectory: true, partnerDirectoryOffset: partnerDirectoryPagination.nextOffset || 0 })} disabled={loadingMorePartnerDirectory || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMorePartnerDirectory ? t('adminLoading') : t('adminLoadMorePartners')}</button></div>}{!partnerDirectoryPagination.hasMore && partnerDirectory.length > 0 && <p className="mt-3 text-xs text-gray-600">{t('adminShowingAllPartners', { total: partnerDirectoryPagination.total })}</p>}</Section>
      <Section eyebrow="Agreement lifecycle" title="Active and pending terms" detail="Use lifecycle transitions instead of deleting agreements so the historical record remains intact." action={<button type="button" onClick={downloadAgreementHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}><div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">{!agreements.length ? <div className="py-14 text-center text-sm text-gray-500">{t('adminNoAgreementsCreated')}</div> : <table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminRestaurant')}</th><th className="px-3 py-3 font-medium">{t('adminVersion')}</th><th className="px-3 py-3 font-medium">{t('adminLifecycle')}</th><th className="px-3 py-3 font-medium">{t('adminCoverage')}</th><th className="px-3 py-3 font-medium">{t('adminLimits')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{agreements.map((agreement) => <tr key={agreement.id}><td className="px-3 py-3 text-white">{agreement.restaurantName || t('adminPartnerRestaurant')}<p className="mt-1 text-gray-600">{dateTime(agreement.startsAt)}{agreement.endsAt ? ` ${t('adminTo')} ${dateTime(agreement.endsAt)}` : ''}</p></td><td className="px-3 py-3 text-gray-400">{t('adminAgreementVersion', { version: agreement.version })}</td><td className="px-3 py-3"><Badge status={agreement.status} /></td><td className="max-w-[240px] px-3 py-3 text-gray-400">{agreement.requiresCustomerEntitlement ? <p className="font-semibold text-amber-300">{t('adminAssignedCustomersOnly')}</p> : <p className="font-semibold text-emerald-300">{t('adminPartnerWide')}</p>}{localizeCreditOrderTypes(agreement.allowedOrderTypes, t) || t('adminNoOrderTypesSet')}{agreement.allowedCategories?.length ? <p className="mt-1 text-gray-600">{agreement.allowedCategories.join(', ')}</p> : null}{agreement.allowedMenuItemIds?.length ? <p className="mt-1 text-gray-600">{t('adminMenuItemsRestricted', { count: agreement.allowedMenuItemIds.length })}</p> : null}{geographyLabel(agreement.geography, t) ? <p className="mt-1 break-words text-sky-300">{geographyLabel(agreement.geography, t)}</p> : <p className="mt-1 text-gray-600">{t('adminAllRestaurantLocations')}</p>}</td><td className="px-3 py-3 text-gray-400"><span className="font-semibold text-sky-300">{agreement.settlementCurrencyCode || 'USD'}</span><br />{agreement.maxTransactionCents ? money(agreement.maxTransactionCents, agreement.settlementCurrencyCode) : t('adminNoPerTransactionCap')}{agreement.dailyCustomerLimitCents ? <p className="mt-1 text-gray-600">{t('adminDailyAmount', { amount: money(agreement.dailyCustomerLimitCents, agreement.settlementCurrencyCode) })}</p> : null}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{agreement.status === 'draft' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'pending_approval')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminSubmitAgreement')}</button>}{agreement.status === 'pending_approval' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApproveActivate')}</button>}{agreement.status === 'active' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'suspended')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminSuspend')}</button>}{agreement.status === 'suspended' && <button disabled={busy} onClick={() => transitionAgreement(agreement, 'active')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminReactivate')}</button>}</div></td></tr>)}</tbody></table>}</div></Section>
      <OxsteedCreditEntitlements agreements={agreements} customerAccounts={customerAccounts} currencyMetadata={overview?.currencyMetadata} busy={busy} />
      </main>
    </>
  );
}
