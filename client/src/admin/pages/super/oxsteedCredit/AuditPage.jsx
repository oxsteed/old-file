import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  CreditSubNav,
  Section,
  dateTime,
  useCreditPageState,
} from './shared';

function CreditAuditHistory({ auditEvents, loading, busy, downloadAuditHistory }) {
  const { t } = useTranslation('credit');
  return <Section eyebrow="Audit history" title="OxSteed Credit control trail" detail="Every rail, partner, agreement, entitlement, account, dispute, and ledger action is append-only. Use this view to reconstruct why a customer or restaurant state changed." action={<button type="button" onClick={downloadAuditHistory} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {t('adminDownloadCsv')}</button>}>
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1120px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminWhen')}</th><th className="px-3 py-3 font-medium">{t('adminAction')}</th><th className="px-3 py-3 font-medium">{t('adminResource')}</th><th className="px-3 py-3 font-medium">{t('adminActorCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminReason')}</th><th className="px-3 py-3 font-medium">{t('adminIntegrity')}</th><th className="px-3 py-3 font-medium">{t('adminChanges')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!auditEvents.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminNoCreditAuditEvents')}</td></tr> : auditEvents.map((event) => <tr key={event.id}><td className="px-3 py-3 text-gray-500">{dateTime(event.createdAt)}</td><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{event.actionType}</span></td><td className="px-3 py-3 text-gray-400">{event.resourceType}<p className="mt-1 font-mono text-[10px] text-gray-600">{event.resourceId}</p></td><td className="px-3 py-3 text-gray-400">{event.actorUserId || t('adminSystem')}{event.customerId && <p className="mt-1 font-mono text-[10px] text-gray-600">{t('adminCustomer')} {event.customerId}</p>}{event.correlationId && <p className="mt-1 break-all font-mono text-[10px] text-gray-600">{t('adminRequest')} {event.correlationId}</p>}</td><td className="max-w-[280px] px-3 py-3 text-gray-400">{event.reason || t('adminNoReasonRecorded')}</td><td className="px-3 py-3 text-gray-500">{event.eventHash ? <details><summary className="cursor-pointer text-emerald-300">{t('adminChainEvidence')}</summary><p className="mt-2 break-all font-mono text-[10px] text-gray-600">{t('adminEventHash')} {event.eventHash}</p><p className="mt-1 break-all font-mono text-[10px] text-gray-700">{t('adminPreviousEvent')} {event.previousEventHash || t('adminGenesis')}</p></details> : <span className="text-gray-700">{t('adminLegacyEvent')}</span>}</td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[360px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify({ before: event.beforeState, after: event.afterState }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
  </Section>;
}

export default function OxsteedCreditAuditPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditActionType, setAuditActionType] = useState('');
  const [auditResourceType, setAuditResourceType] = useState('');
  const [auditPartnerId, setAuditPartnerId] = useState('');
  const [auditCorrelationId, setAuditCorrelationId] = useState('');
  const [auditPagination, setAuditPagination] = useState({ limit: 50, offset: 0, hasMore: false, nextOffset: null });
  const [loadingMoreAuditEvents, setLoadingMoreAuditEvents] = useState(false);
  const [partners, setPartners] = useState([]);

  const load = useCallback(async ({ quiet = false, appendAuditEvents = false, auditOffset = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet && !appendAuditEvents) setLoading(true);
    if (appendAuditEvents) setLoadingMoreAuditEvents(true);
    setError('');
    try {
      const auditParams = { limit: 50, offset: appendAuditEvents ? auditOffset : 0 };
      if (auditActionType) auditParams.actionType = auditActionType;
      if (auditResourceType) auditParams.resourceType = auditResourceType;
      if (auditPartnerId) auditParams.partnerId = auditPartnerId;
      if (auditCorrelationId) auditParams.correlationId = auditCorrelationId;
      const [auditEventsResponse, partnersResponse] = await Promise.all([
        adminApi.get('/admin/super/oxsteed-credit/audit-events', { params: auditParams }),
        adminApi.get('/admin/super/oxsteed-credit/partners'),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const loadedAuditEvents = auditEventsResponse.data?.auditEvents || [];
      if (appendAuditEvents) setAuditEvents((current) => [...current, ...loadedAuditEvents]);
      else setAuditEvents(loadedAuditEvents);
      setAuditPagination(auditEventsResponse.data?.pagination || { limit: auditParams.limit, offset: auditParams.offset, hasMore: false, nextOffset: null });
      setPartners(partnersResponse.data?.partners || []);
    } catch (err) {
      if (requestId === loadRequestRef.current) setError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        if (appendAuditEvents) setLoadingMoreAuditEvents(false);
      }
    }
  }, [auditActionType, auditResourceType, auditPartnerId, auditCorrelationId, t]);

  useEffect(() => { load(); }, [load]);

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
      setNotice(t('adminAuditCsvDownloaded'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminAuditCsvFailed')));
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
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminAuditHistory')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminAuditHistoryDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      <Section eyebrow="Audit history controls" title="Search the Credit control trail" detail="Filter the append-only control history before reviewing state changes. Results are bounded and can be loaded in older pages without downloading the entire ledger."
        action={auditPagination.hasMore && <button type="button" onClick={() => load({ quiet: true, appendAuditEvents: true, auditOffset: auditPagination.nextOffset || 0 })} disabled={loadingMoreAuditEvents || loading || busy} className="rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">{loadingMoreAuditEvents ? 'Loading...' : 'Load older audit events'}</button>}
      >
        <div className="mt-4 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/40 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminAction')}</span><input aria-label={t('adminAction')} value={auditActionType} onChange={(event) => setAuditActionType(event.target.value)} placeholder="credit.rail.suspended" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminResource')}</span><input aria-label={t('adminResource')} value={auditResourceType} onChange={(event) => setAuditResourceType(event.target.value)} placeholder="credit_transaction" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPartner')}</span><select aria-label={t('adminPartner')} value={auditPartnerId} onChange={(event) => setAuditPartnerId(event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400"><option value="">{t('adminAllPartners')}</option>{partners.map((partner) => <option key={partner.partnerId} value={partner.partnerId}>{partner.restaurantName || t('adminPartnerFallback', { id: partner.partnerId })}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRequestCorrelation')}</span><input aria-label={t('adminRequestCorrelation')} value={auditCorrelationId} onChange={(event) => setAuditCorrelationId(event.target.value)} placeholder="request-id-from-logs" className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-400" /></label>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">{t('adminShowingLoadedEvents', { count: auditEvents.length })}{auditPagination.hasMore ? ` · ${t('adminOlderEventsAvailable')}` : ''}</p>
      </Section>
      <CreditAuditHistory
        auditEvents={auditEvents}
        loading={loading}
        busy={busy}
        downloadAuditHistory={downloadAuditHistory}
      />
      </main>
    </>
  );
}
