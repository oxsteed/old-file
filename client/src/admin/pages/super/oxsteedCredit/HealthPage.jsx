import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Power,
  RefreshCw,
  Snowflake,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  Badge,
  CreditSubNav,
  CREDIT_WORKER_NAMES,
  dateTime,
  useCreditPageState,
  workerDisplayName,
  workerResultSummary,
} from './shared';

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

export default function OxsteedCreditHealthPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [overview, setOverview] = useState(null);
  const [rail, setRail] = useState(null);
  const [railFreezeReason, setRailFreezeReason] = useState('');
  const [railReason, setRailReason] = useState('');

  const notificationHealth = overview?.notificationHealth || { pending: 0, sending: 0, failed: 0, oldestPendingAt: null, backlogStale: false, backlogStaleAfterMinutes: 15, oldestFailedAt: null, failedNotifications: [], workerHeartbeat: {} };
  const workerHeartbeats = overview?.workerHeartbeats && typeof overview.workerHeartbeats === 'object'
    ? overview.workerHeartbeats
    : { [CREDIT_WORKER_NAMES[0]]: notificationHealth.workerHeartbeat || {} };

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [overviewResponse, railResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/overview'),
        adminApi.get('/admin/super/oxsteed-credit/rail'),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setOverview(overviewResponse.data || null);
      setRail(railResponse.data?.rail || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

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
  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminCreditHealthTitle')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminCreditHealthDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <section className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">{t('adminEmergencyControl')}</p><h2 className="mt-1 text-lg font-semibold text-white">{t('adminCreditRail')}</h2><p className="mt-1 text-xs leading-5 text-gray-400">{t('adminCreditRailDescription')}</p></div><Badge status={rail ? (rail.enabled ? 'enabled' : 'suspended') : 'unknown'} /></div>{rail?.frozen && <div role="alert" className="mt-4 flex flex-wrap items-start gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><Snowflake className="mt-0.5 h-4 w-4 shrink-0" /><div><strong>{t('adminRailFrozenBanner')}</strong><p className="mt-1 text-xs text-red-300/80">{t('adminRailFreezeReasonLabel')}: {rail.freeze?.reason || t('adminUnknown')}</p>{rail.freeze?.incidentRef && <p className="mt-1 font-mono text-[11px] text-red-300/70">{rail.freeze.incidentRef}</p>}<p className="mt-1 text-[11px] text-red-300/70">{t('adminRailFrozenAt')} {dateTime(rail.freeze?.frozenAt)}</p></div></div>}<form onSubmit={rail?.frozen ? unfreezeRail : freezeRail} className="mt-4 flex flex-col gap-3 border-t border-amber-500/15 pt-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredAuditReason')}</span><input value={railFreezeReason} onChange={(event) => setRailFreezeReason(event.target.value)} maxLength={1000} placeholder={rail?.frozen ? t('adminUnfreezeRailPlaceholder') : t('adminFreezeRailPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={!rail || busy || !railFreezeReason.trim()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${rail?.frozen ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}><Snowflake className="h-4 w-4" />{rail?.frozen ? t('adminUnfreezeRail') : t('adminFreezeRail')}</button></form><form onSubmit={updateRail} className="mt-4 flex flex-col gap-3 border-t border-amber-500/15 pt-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequiredAuditReason')}</span><input value={railReason} onChange={(event) => setRailReason(event.target.value)} maxLength={1000} placeholder={rail?.enabled ? t('adminSuspendRailPlaceholder') : t('adminEnableRailPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none focus:border-amber-300" /></label><button type="submit" disabled={!rail || busy || !railReason.trim()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 ${rail?.enabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}><Power className="h-4 w-4" />{rail?.enabled ? t('adminSuspendRail') : t('adminEnableRail')}</button></form></section>
      {rail?.prerequisites && <CreditRailPrerequisites prerequisites={rail.prerequisites} />}
      <CreditWorkerHealth heartbeats={workerHeartbeats} />
      </main>
    </>
  );
}
