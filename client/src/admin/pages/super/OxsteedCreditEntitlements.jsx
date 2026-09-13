import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

const ENTITLEMENT_STATUSES = ['active', 'suspended', 'revoked', 'expired'];
const ENTITLEMENT_PAGE_SIZE = 250;

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
  if (!value) return 'No date limit';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status) {
  if (status === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'suspended') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'revoked' || status === 'expired') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{String(status || 'unknown').replace(/_/g, ' ')}</span>;
}

export default function OxsteedCreditEntitlements({ agreements = [], customerAccounts = [], busy = false }) {
  const [entitlements, setEntitlements] = useState([]);
  const [form, setForm] = useState({ customerId: '', agreementId: '', status: 'active', startsAt: '', endsAt: '', maxTransaction: '', dailyLimit: '', reason: '' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [agreementOptions, setAgreementOptions] = useState([]);
  const [agreementSearch, setAgreementSearch] = useState('');
  const [agreementLookupQuery, setAgreementLookupQuery] = useState('');
  const [agreementLookupTotal, setAgreementLookupTotal] = useState(0);
  const [loadingAgreementOptions, setLoadingAgreementOptions] = useState(false);
  const [agreementOptionsError, setAgreementOptionsError] = useState('');
  const [bulkAgreementIds, setBulkAgreementIds] = useState([]);
  const agreementLookupRequestRef = useRef(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: ENTITLEMENT_PAGE_SIZE, offset };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (appliedSearch) params.search = appliedSearch;
      const response = await adminApi.get('/admin/super/oxsteed-credit/entitlements', { params });
      setEntitlements(response.data?.entitlements || []);
      setTotal(Number(response.data?.total || 0));
      setHasMore(Boolean(response.data?.hasMore));
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Unable to load customer restaurant access.');
    } finally {
      setLoading(false);
    }
  };

  const downloadEntitlements = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (appliedSearch) params.search = appliedSearch;
      const response = await adminApi.get('/admin/super/oxsteed-credit/entitlements.csv', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `oxsteed-credit-entitlements-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice('Customer access CSV downloaded with the active filters.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Unable to export customer restaurant access.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, offset, appliedSearch]);

  const visibleEntitlements = entitlements;

  const loadAgreementOptions = async (searchValue) => {
    const requestId = ++agreementLookupRequestRef.current;
    const query = String(searchValue || '').trim();
    setLoadingAgreementOptions(true);
    setAgreementOptionsError('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/agreements', { params: query ? { search: query } : {} });
      if (requestId !== agreementLookupRequestRef.current) return;
      const loadedOptions = response.data?.agreements || [];
      setAgreementOptions(loadedOptions);
      setAgreementLookupTotal(loadedOptions.length);
    } catch (err) {
      if (requestId === agreementLookupRequestRef.current) {
        setAgreementOptionsError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Agreement lookup failed.');
      }
    } finally {
      if (requestId === agreementLookupRequestRef.current) setLoadingAgreementOptions(false);
    }
  };

  const applyAgreementLookup = () => {
    const query = agreementSearch.trim();
    setAgreementLookupQuery(query);
    loadAgreementOptions(query);
  };

  const clearAgreementLookup = () => {
    agreementLookupRequestRef.current += 1;
    setAgreementSearch('');
    setAgreementLookupQuery('');
    setAgreementOptions([]);
    setAgreementLookupTotal(0);
    setAgreementOptionsError('');
    setLoadingAgreementOptions(false);
  };

  const selectableAgreements = useMemo(() => {
    const activeOptions = agreementLookupQuery ? agreementOptions : agreements;
    const selectedAgreements = [...agreements, ...agreementOptions].filter((agreement) => String(agreement.id) === String(form.agreementId));
    return Array.from(new Map([...activeOptions, ...selectedAgreements].map((agreement) => [String(agreement.id), agreement])).values());
  }, [agreementLookupQuery, agreementOptions, agreements, form.agreementId]);

  const selectedAgreement = useMemo(() => selectableAgreements.find((agreement) => String(agreement.id) === String(form.agreementId)), [form.agreementId, selectableAgreements]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await adminApi.post(`/admin/super/oxsteed-credit/agreements/${form.agreementId}/entitlements`, {
        customerId: form.customerId.trim(),
        status: form.status,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        maxTransactionCents: dollarsToCents(form.maxTransaction),
        dailyLimitCents: dollarsToCents(form.dailyLimit),
        reason: form.reason.trim() || undefined,
      });
      setNotice(response.data?.replayed ? 'That customer access record was already up to date.' : `Customer access saved for ${selectedAgreement?.restaurantName || 'the selected restaurant'}.`);
      setForm((current) => ({ ...current, agreementId: '', maxTransaction: '', dailyLimit: '', reason: '' }));
      setBulkAgreementIds([]);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Customer access update failed.');
    } finally {
      setSaving(false);
    }
  };

  const submitBulk = async () => {
    if (!form.customerId.trim() || !form.reason.trim()) {
      setError('Customer UUID and a reason are required for bulk customer access.');
      return;
    }
    if (!bulkAgreementIds.length) {
      setError('Select at least one restaurant agreement for bulk customer access.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/entitlements/bulk', {
        customerId: form.customerId.trim(),
        agreementIds: bulkAgreementIds,
        status: form.status,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        maxTransactionCents: dollarsToCents(form.maxTransaction),
        dailyLimitCents: dollarsToCents(form.dailyLimit),
        reason: form.reason.trim(),
      }, { headers: { 'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
      setNotice(response.data?.replayed ? 'That bulk customer access action was already applied.' : `Customer access saved across ${response.data?.count || bulkAgreementIds.length} restaurant agreements.`);
      setForm((current) => ({ ...current, agreementId: '', maxTransaction: '', dailyLimit: '', reason: '' }));
      setBulkAgreementIds([]);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || 'Bulk customer access update failed. No partial changes were saved.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">Customer access</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Where each customer can spend</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">Access is assigned per partner agreement. Keep the same customer ID and submit another agreement to authorize spending at multiple restaurants. This does not move balance or bypass the agreement’s own rules.</p>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={downloadEntitlements} disabled={loading || saving || busy} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download CSV</button><button type="button" onClick={load} disabled={loading || saving || busy} className="rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Refresh access</button></div>
    </div>

    {(error || notice) && <div className={`mt-4 rounded-xl border px-3 py-3 text-xs ${error ? 'border-red-500/30 bg-red-950/20 text-red-300' : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'}`}>{error || notice}</div>}

    <form onSubmit={submit} className="mt-5 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="lg:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Customer UUID</span><input required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })} list="oxsteed-credit-customers" placeholder="Paste UUID or choose from loaded wallets" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /><datalist id="oxsteed-credit-customers">{customerAccounts.map((account) => <option key={account.accountId} value={account.customerId}>{account.name || account.email || account.customerId}</option>)}</datalist></label>
      <label className="lg:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Partner agreement</span><div className="mb-2 flex flex-wrap gap-2"><input value={agreementSearch} onChange={(event) => setAgreementSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyAgreementLookup(); }} placeholder="Search restaurant or partner ID" className="min-w-[180px] flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /><button type="button" onClick={applyAgreementLookup} disabled={loadingAgreementOptions || loading || saving || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingAgreementOptions ? 'Searching...' : 'Find agreements'}</button>{agreementLookupQuery && <button type="button" onClick={clearAgreementLookup} disabled={loadingAgreementOptions || loading || saving || busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Clear</button>}</div><select required value={form.agreementId} onChange={(event) => setForm({ ...form, agreementId: event.target.value })} disabled={loadingAgreementOptions} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400"><option value="">{loadingAgreementOptions ? 'Loading agreements...' : 'Choose a restaurant agreement'}</option>{selectableAgreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.restaurantName || 'Partner restaurant'} · v{agreement.version} · {agreement.status} · {agreement.settlementCurrencyCode || 'USD'}</option>)}</select>{agreementOptionsError && <p className="mt-2 text-xs font-semibold text-red-300">{agreementOptionsError}</p>}<p className="mt-2 text-[11px] text-gray-600">{agreementLookupQuery ? `Showing ${agreementLookupTotal} matching agreement${agreementLookupTotal === 1 ? '' : 's'}.` : 'Use Find agreements to search beyond the initial agreement list.'}</p><div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-950/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-semibold text-sky-200">Authorize the same customer at multiple restaurants</span><span className="text-[10px] text-gray-600">{bulkAgreementIds.length} selected</span></div><div className="mt-2 grid max-h-36 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{selectableAgreements.map((agreement) => <label key={`bulk-${agreement.id}`} className="flex min-w-0 items-start gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-2 py-2 text-[11px] text-gray-300"><input type="checkbox" checked={bulkAgreementIds.includes(String(agreement.id))} onChange={(event) => setBulkAgreementIds((current) => event.target.checked ? [...new Set([...current, String(agreement.id)])] : current.filter((id) => id !== String(agreement.id)))} disabled={loadingAgreementOptions || loading || saving || busy} className="mt-0.5 accent-sky-500" /><span className="truncate">{agreement.restaurantName || 'Partner restaurant'} <span className="text-gray-600">· v{agreement.version}</span></span></label>)}</div><button type="button" onClick={submitBulk} disabled={busy || saving || !bulkAgreementIds.length} className="mt-3 w-full rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50">Authorize selected restaurants atomically</button></div></label>
      <label><span className="mb-1 block text-xs font-semibold text-gray-500">Access state</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{ENTITLEMENT_STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
      <label><span className="mb-1 block text-xs font-semibold text-gray-500">Starts (optional)</span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label>
      <label><span className="mb-1 block text-xs font-semibold text-gray-500">Ends (optional)</span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label>
      <label><span className="mb-1 block text-xs font-semibold text-gray-500">Max / transaction ($)</span><input inputMode="decimal" value={form.maxTransaction} onChange={(event) => setForm({ ...form, maxTransaction: event.target.value })} placeholder="Optional" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label>
      <label><span className="mb-1 block text-xs font-semibold text-gray-500">Daily limit ($)</span><input inputMode="decimal" value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: event.target.value })} placeholder="Optional" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label>
      <label className="lg:col-span-3"><span className="mb-1 block text-xs font-semibold text-gray-500">Reason</span><input required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Why this customer is eligible for this partner" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" /></label>
      <button disabled={busy || saving || !selectableAgreements.length} className="self-end rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50">Save customer access</button>
    </form>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-white">Current assignments</h3><p className="mt-1 text-xs text-gray-600">{total ? `Showing ${offset + 1}–${Math.min(offset + entitlements.length, total)} of ${total} assignments` : 'No assignments loaded.'}</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setAppliedSearch(search.trim()); setOffset(0); } }} placeholder="Search customer or restaurant" className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400" /><button type="button" onClick={() => { setAppliedSearch(search.trim()); setOffset(0); }} disabled={loading || saving} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Apply</button><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setOffset(0); }} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-400"><option value="all">All access states</option>{ENTITLEMENT_STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select><button type="button" onClick={() => setOffset((current) => Math.max(0, current - ENTITLEMENT_PAGE_SIZE))} disabled={loading || saving || offset === 0} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Previous</button><button type="button" onClick={() => setOffset((current) => current + ENTITLEMENT_PAGE_SIZE)} disabled={loading || saving || !hasMore} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">Next</button></div>
    </div>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
      <table className="min-w-[1000px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Customer</th><th className="px-3 py-3 font-medium">Restaurant</th><th className="px-3 py-3 font-medium">Agreement</th><th className="px-3 py-3 font-medium">State</th><th className="px-3 py-3 font-medium">Limits</th><th className="px-3 py-3 font-medium">Validity</th></tr></thead><tbody className="divide-y divide-gray-800">{loading ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">Loading customer access...</td></tr> : !visibleEntitlements.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">No customer restaurant access matches these filters.</td></tr> : visibleEntitlements.map((entitlement) => <tr key={entitlement.id}><td className="px-3 py-3"><strong className="text-white">{entitlement.customerName || 'Unnamed customer'}</strong><p className="mt-1 text-gray-500">{entitlement.customerEmail || 'No email'}</p><p className="mt-1 font-mono text-[10px] text-gray-700">{entitlement.customerId}</p></td><td className="px-3 py-3 text-white">{entitlement.restaurantName || `Restaurant ${entitlement.restaurantId}`}<p className="mt-1 text-gray-600">{entitlement.currencyCode || 'USD'}</p></td><td className="px-3 py-3 text-gray-400">v{entitlement.agreementVersion || '?'}<p className="mt-1 text-gray-600">{entitlement.agreementStatus || 'unknown'}</p></td><td className="px-3 py-3"><Badge status={entitlement.status} /></td><td className="px-3 py-3 text-gray-400">{entitlement.maxTransactionCents ? `Max ${money(entitlement.maxTransactionCents, entitlement.currencyCode)}` : 'Agreement cap'}{entitlement.dailyLimitCents ? <p className="mt-1 text-gray-600">Daily {money(entitlement.dailyLimitCents, entitlement.currencyCode)}</p> : null}</td><td className="px-3 py-3 text-gray-500">{dateTime(entitlement.startsAt)}<br />to {dateTime(entitlement.endsAt)}</td></tr>)}</tbody></table>
    </div>
  </section>;
}
