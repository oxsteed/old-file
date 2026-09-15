import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { formatCreditMinorUnits, parseCreditMajorAmount } from '../../../lib/creditCurrency';

function requestKey() {
  if (globalThis.crypto?.randomUUID) return `credit-partner-funding:${globalThis.crypto.randomUUID()}`;
  return `credit-partner-funding:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function dateTime(value) {
  if (!value) return 'No activity';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function accountLabel(account, currencyCode) {
  return `${formatCreditMinorUnits(account?.balanceCents || 0, currencyCode)} · ${account?.status || 'unknown'}`;
}

export default function OxsteedCreditPartnerLedger({ partners, currencyOptions, busy, onError, onNotice }) {
  const [partnerId, setPartnerId] = useState('');
  const [ledger, setLedger] = useState(null);
  const [fundingRecords, setFundingRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ direction: 'fund', amount: '', externalReference: '', reason: '' });

  const availablePartners = useMemo(
    () => (partners || []).filter((partner) => partner.status !== 'terminated'),
    [partners]
  );

  useEffect(() => {
    if (!partnerId && availablePartners[0]?.partnerId) setPartnerId(String(availablePartners[0].partnerId));
    if (partnerId && !availablePartners.some((partner) => String(partner.partnerId) === String(partnerId))) {
      setPartnerId(availablePartners[0]?.partnerId ? String(availablePartners[0].partnerId) : '');
    }
  }, [availablePartners, partnerId]);

  const load = useCallback(async (selectedPartnerId = partnerId) => {
    if (!selectedPartnerId) {
      setLedger(null);
      setFundingRecords([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/partners/${selectedPartnerId}/ledger`, { params: { limit: 25, offset: 0 } });
      setLedger(response.data?.ledger || null);
      setFundingRecords(response.data?.funding?.records || []);
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Unable to load the restaurant Credit ledger.';
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [onError, partnerId]);

  useEffect(() => { load(); }, [load]);

  const submitFunding = async (event) => {
    event.preventDefault();
    if (!partnerId) return;
    setSaving(true);
    setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${partnerId}/funding`, {
        direction: form.direction,
        amountCents: parseCreditMajorAmount(form.amount, ledger?.currencyCode || 'USD'),
        currencyCode: ledger?.currencyCode || 'USD',
        externalReference: form.externalReference,
        reason: form.reason,
      }, { headers: { 'Idempotency-Key': requestKey() } });
      setForm({ direction: form.direction, amount: '', externalReference: '', reason: '' });
      onNotice?.(form.direction === 'fund' ? 'Restaurant reserve funded and recorded in the immutable Credit ledger.' : 'Restaurant reserve release recorded in the immutable Credit ledger.');
      await load();
    } catch (err) {
      const message = err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Restaurant reserve movement failed.';
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  return <section className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Restaurant operating ledger</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Payable, reserve, and funding trail</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">Each restaurant has its own payable account and protected reserve account. Funding records are immutable and require a reason, idempotency key, and external reference; this does not claim that a bank transfer occurred outside the system.</p>
      </div>
      <button type="button" onClick={() => load()} disabled={!partnerId || loading || saving || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh ledger</button>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Restaurant partner</span><select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} disabled={loading || saving || busy} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"><option value="">Select partner</option>{availablePartners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || `Restaurant ${partner.restaurantId}`} · {partner.settlementCurrencyCode || 'USD'}</option>)}</select></label>
        {loading && <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin text-amber-300" /> Loading ledger...</div>}
        {ledger && <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-gray-800 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Payable</span><strong className="mt-1 block text-lg text-emerald-300">{accountLabel(ledger.payableAccount, ledger.currencyCode)}</strong></div><div className="rounded-lg border border-gray-800 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Protected reserve</span><strong className="mt-1 block text-lg text-sky-300">{accountLabel(ledger.reserveAccount, ledger.currencyCode)}</strong></div><div className="text-xs text-gray-500 sm:col-span-2">Ledger {ledger.ledgerCode} · {ledger.currencyCode} · {ledger.status}<br />Funded {formatCreditMinorUnits(ledger.totalFundedCents, ledger.currencyCode)} · Released {formatCreditMinorUnits(ledger.totalReleasedCents, ledger.currencyCode)}</div></div>}
        {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs font-semibold text-red-300"><span>{error}</span><button type="button" onClick={() => load()} disabled={!partnerId || loading || saving || busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-red-200 hover:bg-red-500/10 disabled:opacity-50">Retry</button></div>}
      </div>
      <form onSubmit={submitFunding} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><h3 className="text-sm font-semibold text-white">Record reserve movement</h3><p className="mt-1 text-xs leading-5 text-gray-600">Funding moves value from the central treasury account into this restaurant reserve. Release reverses that movement. It cannot directly change restaurant payable earnings.</p></div>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Direction</span><select required value={form.direction} onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value }))} disabled={!ledger || saving || busy} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"><option value="fund">Fund reserve</option><option value="release">Release reserve</option></select></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">Amount ({ledger?.currencyCode || currencyOptions?.[0] || 'USD'})</span><input required inputMode="decimal" min="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} disabled={!ledger || saving || busy} placeholder="0.00" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">External reference</span><input required maxLength={160} value={form.externalReference} onChange={(event) => setForm((current) => ({ ...current, externalReference: event.target.value }))} disabled={!ledger || saving || busy} placeholder="Treasury transfer or release reference" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">Required reason</span><textarea required maxLength={1000} rows={2} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={!ledger || saving || busy} placeholder="Why is this reserve movement authorized?" className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label>
        <button type="submit" disabled={!ledger || saving || busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50 sm:col-span-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {form.direction === 'fund' ? 'Fund reserve' : 'Release reserve'}</button>
      </form>
    </div>
    {fundingRecords.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">Direction</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-3 py-3 font-medium">External reference</th><th className="px-3 py-3 font-medium">Reason / actor</th><th className="px-3 py-3 font-medium">Recorded</th></tr></thead><tbody className="divide-y divide-gray-800">{fundingRecords.map((record) => <tr key={record.id}><td className="px-3 py-3 font-semibold text-amber-200">{record.direction}</td><td className="px-3 py-3 font-semibold text-white">{formatCreditMinorUnits(record.amountCents, record.currencyCode)}</td><td className="px-3 py-3 break-all font-mono text-[11px] text-sky-300">{record.externalReference}</td><td className="px-3 py-3 text-gray-400">{record.reason}<br /><span className="text-[10px] text-gray-600">{record.actorUserId || 'system'}</span></td><td className="px-3 py-3 text-gray-500">{dateTime(record.createdAt)}</td></tr>)}</tbody></table></div>}
    {!fundingRecords.length && ledger && <p className="mt-4 inline-flex items-center gap-2 text-xs text-gray-600"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> No reserve movements recorded yet.</p>}
  </section>;
}
