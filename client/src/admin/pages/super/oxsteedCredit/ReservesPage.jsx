import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  CreditSubNav,
  DEFAULT_CURRENCY_OPTIONS,
  Section,
  money,
  useCreditPageState,
} from './shared';

function ReservePolicySection({ busy, setBusy, setNotice, setError, currencyOptions }) {
  const { t } = useTranslation('credit');
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [partnerId, setPartnerId] = useState('');
  const [ratioBps, setRatioBps] = useState('1000');
  const [floorCents, setFloorCents] = useState('50000');

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/reserve-policies', { params: { currencyCode: currency } });
      setPolicies(response.data?.policies || []);
    } catch (err) {
      setLoadError(safeCreditErrorMessage(err, t('adminReservePolicyLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [currency, t]);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  const queueUpdate = async () => {
    const normalizedCurrency = String(currency || '').trim().toUpperCase();
    const ratio = Number(ratioBps);
    const floor = Number(floorCents);
    if (!normalizedCurrency) { setError(t('adminReservePolicyFormCurrencyRequired')); return; }
    if (!Number.isSafeInteger(ratio) || ratio < 0 || ratio > 10000) { setError(t('adminReservePolicyValidationHint')); return; }
    if (!Number.isSafeInteger(floor) || floor < 0) { setError(t('adminReservePolicyValidationHint')); return; }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.put('/admin/super/oxsteed-credit/reserve-policies', {
        currencyCode: normalizedCurrency,
        partnerId: partnerId.trim() === '' ? null : partnerId.trim(),
        ratioBps: ratio,
        floorCents: floor,
      });
      setNotice(t('adminReservePolicyQueued'));
      await loadPolicies();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminReservePolicyQueueFailed')));
    } finally { setBusy(false); }
  };

  return <Section eyebrow="Reserve policy" title="Reserve policies" detail="Reserve ratios and floors are per currency, with optional per-partner overrides. Changes queue for a second admin to approve in the maker-checker queue below; nothing applies until then.">
    {loadError && <div role="alert" aria-live="assertive" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{loadError}</span><button type="button" onClick={loadPolicies} disabled={loading || busy} className="rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">{t('adminRetry')}</button></div>}
    <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-4">
        <h3 className="text-sm font-semibold text-white">{t('adminReservePolicyUpdateTitle')}</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">{t('adminReservePolicyUpdateDescription')}</p>
        <div className="mt-4 grid gap-3">
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReservePolicyCurrency')}</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400">{(currencyOptions && currencyOptions.length ? currencyOptions : ['USD']).map((option) => <option key={option}>{option}</option>)}</select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReservePolicyPartner')}</span>
            <input value={partnerId} onChange={(event) => setPartnerId(event.target.value.replace(/[^0-9]/g, '').slice(0, 20))} inputMode="numeric" placeholder={t('adminReservePolicyPartnerPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReservePolicyRatio')}</span>
              <input value={ratioBps} onChange={(event) => setRatioBps(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))} inputMode="numeric" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
              <span className="mt-1 block text-[11px] leading-4 text-gray-600">{t('adminReservePolicyRatioHint')}</span>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminReservePolicyFloor')}</span>
              <input value={floorCents} onChange={(event) => setFloorCents(event.target.value.replace(/[^0-9]/g, '').slice(0, 12))} inputMode="numeric" className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-orange-400" />
              <span className="mt-1 block text-[11px] leading-4 text-gray-600">{t('adminReservePolicyFloorHint')}</span>
            </label>
          </div>
          <button type="button" disabled={busy} onClick={queueUpdate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> {t('adminReservePolicyQueueUpdate')}</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[520px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminReservePolicyScope')}</th><th className="px-3 py-3 font-medium">{t('adminReservePolicyRatioShort')}</th><th className="px-3 py-3 font-medium">{t('adminReservePolicyFloorShort')}</th><th className="px-3 py-3 font-medium">{t('adminReservePolicyCurrencyShort')}</th></tr></thead><tbody className="divide-y divide-gray-800">{loading ? <tr><td colSpan="4" className="px-3 py-10 text-center text-gray-500">{t('adminLoading')}</td></tr> : !policies.length ? <tr><td colSpan="4" className="px-3 py-10 text-center text-gray-500">{t('adminReservePolicyEmpty')}</td></tr> : policies.map((policy) => <tr key={policy.id}><td className="px-3 py-3 text-white">{policy.partnerId ? t('adminReservePolicyPartnerScope', { partnerId: policy.partnerId }) : <span className="font-semibold text-sky-300">{t('adminReservePolicyDefaultScope')}</span>}</td><td className="px-3 py-3 text-gray-400">{policy.ratioBps} bps</td><td className="px-3 py-3 text-gray-400">{money(policy.floorCents, policy.currencyCode)}</td><td className="px-3 py-3 font-mono text-[11px] text-gray-500">{policy.currencyCode}</td></tr>)}</tbody></table></div>
    </div>
  </Section>;
}

export default function OxsteedCreditReservesPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [overview, setOverview] = useState(null);
  const currencyOptions = overview?.supportedCurrencies?.length ? overview.supportedCurrencies : DEFAULT_CURRENCY_OPTIONS;

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const overviewResponse = await adminApi.get('/admin/super/oxsteed-credit/overview');
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminReservePolicyEyebrow')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminReservePolicySectionDetail')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <ReservePolicySection
        busy={busy}
        setBusy={setBusy}
        setNotice={setNotice}
        setError={setError}
        currencyOptions={currencyOptions}
      />
      </main>
    </>
  );
}
