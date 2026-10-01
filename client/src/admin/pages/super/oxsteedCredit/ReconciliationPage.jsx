import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  RefreshCw,
  Snowflake,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  Badge,
  CreditSubNav,
  DEFAULT_CURRENCY_OPTIONS,
  IntegritySummary,
  Section,
  dateTime,
  money,
  useCreditPageState,
} from './shared';

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

export default function OxsteedCreditReconciliationPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [overview, setOverview] = useState(null);
  const [reconciliationRuns, setReconciliationRuns] = useState([]);
  const [reconciliationStatus, setReconciliationStatus] = useState('');
  const [reconciliationCurrency, setReconciliationCurrency] = useState('all');
  const [reconciliationPagination, setReconciliationPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreReconciliationRuns, setLoadingMoreReconciliationRuns] = useState(false);
  const [externalReconRuns, setExternalReconRuns] = useState([]);
  const [externalReconStatus, setExternalReconStatus] = useState('');
  const [externalReconCurrency, setExternalReconCurrency] = useState('all');
  const [externalReconPagination, setExternalReconPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreExternalReconRuns, setLoadingMoreExternalReconRuns] = useState(false);
  const [externalReconReason, setExternalReconReason] = useState('');
  const currencyOptions = overview?.supportedCurrencies?.length ? overview.supportedCurrencies : DEFAULT_CURRENCY_OPTIONS;

  const load = useCallback(async ({ quiet = false, appendReconciliationRuns = false, reconciliationOffset = 0, appendExternalReconRuns = false, externalReconOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendReconciliationRuns && !appendExternalReconRuns) setLoading(true);
    if (appendReconciliationRuns) setLoadingMoreReconciliationRuns(true);
    if (appendExternalReconRuns) setLoadingMoreExternalReconRuns(true);
    setError('');
    try {
      const reconciliationParams = { limit: 50, offset: appendReconciliationRuns ? reconciliationOffset : 0 };
      if (reconciliationStatus) reconciliationParams.status = reconciliationStatus;
      if (reconciliationCurrency !== 'all') reconciliationParams.currencyCode = reconciliationCurrency;
      const externalReconParams = { limit: 50, offset: appendExternalReconRuns ? externalReconOffset : 0 };
      if (externalReconStatus) externalReconParams.status = externalReconStatus;
      if (externalReconCurrency !== 'all') externalReconParams.currencyCode = externalReconCurrency;
      const [overviewResponse, reconciliationResponse, externalReconResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/reconciliation', { params: reconciliationParams }),
        adminApi.get('/admin/super/oxsteed-credit/external-reconciliation', { params: externalReconParams }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
      const loadedReconciliationRuns = reconciliationResponse.data?.runs || [];
      if (appendReconciliationRuns) setReconciliationRuns((current) => [...current, ...loadedReconciliationRuns]);
      else setReconciliationRuns(loadedReconciliationRuns);
      setReconciliationPagination(reconciliationResponse.data?.pagination || { limit: reconciliationParams.limit, offset: reconciliationParams.offset, hasMore: false, nextOffset: null });
      const loadedExternalReconRuns = externalReconResponse.data?.runs || [];
      if (appendExternalReconRuns) setExternalReconRuns((current) => [...current, ...loadedExternalReconRuns]);
      else setExternalReconRuns(loadedExternalReconRuns);
      setExternalReconPagination(externalReconResponse.data?.pagination || { limit: externalReconParams.limit, offset: externalReconParams.offset, hasMore: false, nextOffset: null });
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendReconciliationRuns) setLoadingMoreReconciliationRuns(false);
        if (appendExternalReconRuns) setLoadingMoreExternalReconRuns(false);
      }
    }
  }, [reconciliationStatus, reconciliationCurrency, externalReconStatus, externalReconCurrency, t]);

  useEffect(() => { load(); }, [load]);

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
  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminReconciliationHistory')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminReconciliationHistoryDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
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
      </main>
    </>
  );
}
