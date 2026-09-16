import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../lib/adminApi';
import { formatCreditMinorUnits, parseCreditMajorAmount } from '../../../lib/creditCurrency';
import { beginCreditRequest, invalidateCreditRequest, isCurrentCreditRequest } from './creditRequestGuards';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';
import { localizeCreditStatus } from '../../../lib/creditStatus';

function requestKey() {
  if (globalThis.crypto?.randomUUID) return `credit-partner-funding:${globalThis.crypto.randomUUID()}`;
  return `credit-partner-funding:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function dateTime(value) {
  const language = typeof document !== 'undefined' && document.documentElement?.lang;
  return formatCreditDateTime(value, value ? 'Unknown date' : 'No activity', language);
}

function accountLabel(account, currencyCode, translate) {
  return `${formatCreditMinorUnits(account?.balanceCents || 0, currencyCode)} · ${localizeCreditStatus(account?.status, translate)}`;
}

function directionLabel(direction, translate) {
  if (direction === 'fund') return translate('fundDirection');
  if (direction === 'release') return translate('releaseDirection');
  return translate('statusUnknown');
}

export default function OxsteedCreditPartnerLedger({ partners, currencyOptions, busy, onError, onNotice }) {
  const { t } = useTranslation('credit');
  const [partnerId, setPartnerId] = useState('');
  const [ledger, setLedger] = useState(null);
  const [fundingRecords, setFundingRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ direction: 'fund', amount: '', externalReference: '', reason: '' });
  const loadRequestRef = useRef(0);
  const mutationKeyRef = useRef(null);

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
    const requestId = beginCreditRequest(loadRequestRef);
    if (!selectedPartnerId) {
      setLedger(null);
      setFundingRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get(`/admin/super/oxsteed-credit/partners/${selectedPartnerId}/ledger`, { params: { limit: 25, offset: 0 } });
      if (!isCurrentCreditRequest(loadRequestRef, requestId)) return;
      setLedger(response.data?.ledger || null);
      setFundingRecords(response.data?.funding?.records || []);
    } catch (err) {
      if (!isCurrentCreditRequest(loadRequestRef, requestId)) return;
      const message = safeCreditErrorMessage(err, t('adminUnableLoadRestaurantLedger'));
      setError(message);
      onError?.(message);
    } finally {
      if (isCurrentCreditRequest(loadRequestRef, requestId)) setLoading(false);
    }
  }, [onError, partnerId]);

  useEffect(() => { load(); }, [load]);

  const submitFunding = async (event) => {
    event.preventDefault();
    if (!partnerId || loading || saving) return;
    const currencyCode = ledger?.currencyCode || 'USD';
    let amountCents;
    try {
      amountCents = parseCreditMajorAmount(form.amount, currencyCode);
    } catch (err) {
      const message = t('adminCreditAmountInvalid');
      setError(message);
      onError?.(message);
      return;
    }
    if (amountCents === null) {
      const message = t('adminCreditAmountInvalid');
      setError(message);
      onError?.(message);
      return;
    }
    const signature = JSON.stringify({ partnerId, direction: form.direction, amountCents, currencyCode, externalReference: form.externalReference, reason: form.reason });
    if (!mutationKeyRef.current || mutationKeyRef.current.signature !== signature) {
      mutationKeyRef.current = { signature, key: requestKey() };
    }
    setSaving(true);
    setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/partners/${partnerId}/funding`, {
        direction: form.direction,
        amountCents,
        currencyCode,
        externalReference: form.externalReference,
        reason: form.reason,
      }, { headers: { 'Idempotency-Key': mutationKeyRef.current.key } });
      mutationKeyRef.current = null;
      setForm({ direction: form.direction, amount: '', externalReference: '', reason: '' });
      onNotice?.(form.direction === 'fund' ? t('adminReserveFundedNotice') : t('adminReserveReleasedNotice'));
      await load(partnerId);
    } catch (err) {
      const message = safeCreditErrorMessage(err, t('adminReserveMovementFailed'));
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  const changePartner = (event) => {
    invalidateCreditRequest(loadRequestRef);
    mutationKeyRef.current = null;
    setPartnerId(event.target.value);
    setLedger(null);
    setFundingRecords([]);
    setError('');
  };

  return <section className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">{t('adminRestaurantLedgerEyebrow')}</p>
        <h2 className="mt-1 text-lg font-semibold text-white">{t('adminRestaurantLedgerTitle')}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">{t('adminRestaurantLedgerDescription')}</p>
      </div>
      <button type="button" onClick={() => load()} disabled={!partnerId || loading || saving || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {t('adminRefreshLedger')}</button>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRestaurantPartner')}</span><select value={partnerId} onChange={changePartner} disabled={saving || busy} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"><option value="">{t('adminSelectPartner')}</option>{availablePartners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminRestaurantFallback', { id: partner.restaurantId })} · {partner.settlementCurrencyCode || 'USD'}</option>)}</select></label>
        {loading && <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin text-amber-300" /> {t('adminLoadingLedger')}</div>}
        {ledger && <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-gray-800 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('payableBalance')}</span><strong className="mt-1 block text-lg text-emerald-300">{accountLabel(ledger.payableAccount, ledger.currencyCode, t)}</strong></div><div className="rounded-lg border border-gray-800 p-3"><span className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminProtectedReserve')}</span><strong className="mt-1 block text-lg text-sky-300">{accountLabel(ledger.reserveAccount, ledger.currencyCode, t)}</strong></div><div className="text-xs text-gray-500 sm:col-span-2">{t('adminLedgerStats', { code: ledger.ledgerCode, currency: ledger.currencyCode, status: localizeCreditStatus(ledger.status, t), funded: formatCreditMinorUnits(ledger.totalFundedCents, ledger.currencyCode), released: formatCreditMinorUnits(ledger.totalReleasedCents, ledger.currencyCode) })}</div></div>}
        {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-3 text-xs font-semibold text-red-300"><span>{error}</span><button type="button" onClick={() => load()} disabled={!partnerId || loading || saving || busy} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetry')}</button></div>}
      </div>
      <form onSubmit={submitFunding} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><h3 className="text-sm font-semibold text-white">{t('adminRecordReserveMovement')}</h3><p className="mt-1 text-xs leading-5 text-gray-600">{t('adminReserveMovementDescription')}</p></div>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminDirection')}</span><select required value={form.direction} onChange={(event) => setForm((current) => ({ ...current, direction: event.target.value }))} disabled={!ledger || loading || saving || busy} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300"><option value="fund">{t('fundReserve')}</option><option value="release">{t('releaseReserve')}</option></select></label>
        <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminAmount', { currency: ledger?.currencyCode || currencyOptions?.[0] || 'USD' })}</span><input required inputMode="decimal" min="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} disabled={!ledger || loading || saving || busy} placeholder={t('adminAmountPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminExternalReference')}</span><input required maxLength={160} value={form.externalReference} onChange={(event) => setForm((current) => ({ ...current, externalReference: event.target.value }))} disabled={!ledger || loading || saving || busy} placeholder={t('adminExternalReferencePlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredReason')}</span><textarea required maxLength={1000} rows={2} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={!ledger || loading || saving || busy} placeholder={t('adminReserveReasonPlaceholder')} className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label>
        <button type="submit" disabled={!ledger || loading || saving || busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50 sm:col-span-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {form.direction === 'fund' ? t('fundReserve') : t('releaseReserve')}</button>
      </form>
    </div>
    {fundingRecords.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminDirection')}</th><th className="px-3 py-3 font-medium">{t('adminAmountHeader')}</th><th className="px-3 py-3 font-medium">{t('adminExternalReference')}</th><th className="px-3 py-3 font-medium">{t('adminReasonActor')}</th><th className="px-3 py-3 font-medium">{t('adminRecorded')}</th></tr></thead><tbody className="divide-y divide-gray-800">{fundingRecords.map((record) => <tr key={record.id}><td className="px-3 py-3 font-semibold text-amber-200">{directionLabel(record.direction, t)}</td><td className="px-3 py-3 font-semibold text-white">{formatCreditMinorUnits(record.amountCents, record.currencyCode)}</td><td className="px-3 py-3 break-all font-mono text-[11px] text-sky-300">{record.externalReference}</td><td className="px-3 py-3 text-gray-400">{record.reason}<br /><span className="text-[10px] text-gray-600">{record.actorUserId || t('adminSystemActor')}</span></td><td className="px-3 py-3 text-gray-500">{dateTime(record.createdAt)}</td></tr>)}</tbody></table></div>}
    {!fundingRecords.length && ledger && <p className="mt-4 inline-flex items-center gap-2 text-xs text-gray-600"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> {t('adminNoReserveMovements')}</p>}
  </section>;
}
