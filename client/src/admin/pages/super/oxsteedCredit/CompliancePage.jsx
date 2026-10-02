import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../../../lib/adminApi';
import { safeCreditErrorMessage } from '../../../../lib/creditErrors';
import {
  AdminActionDialog,
  Badge,
  CreditSubNav,
  Section,
  dateTime,
  useCreditDialog,
  useCreditPageState,
} from './shared';

function ComplianceQueue({ queue, busy, decideCompliance }) {
  const { t } = useTranslation('credit');
  const verifications = queue?.verifications || [];
  const sanctions = queue?.sanctions || [];
  const cases = queue?.cases || [];
  const counts = queue?.counts || {};
  return <Section eyebrow="Compliance queue" title="Identity, sanctions, and monitoring cases" detail="Pending identity verifications, uncleared sanctions hits, and open transaction-monitoring cases with SLA state. Every decision records the admin, the reason, and an audit event.">
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminCompliancePendingVerifications')}</p><strong className="mt-1 block text-lg text-amber-300">{Number(counts.pendingVerifications || 0)}</strong></div>
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminCompliancePendingSanctions')}</p><strong className="mt-1 block text-lg text-red-300">{Number(counts.pendingSanctions || 0)}</strong></div>
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminComplianceOpenCases')}</p><strong className="mt-1 block text-lg text-sky-300">{Number(counts.openCases || 0)}</strong></div>
      <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminComplianceSlaBreached')}</p><strong className={`mt-1 block text-lg ${Number(counts.slaBreachedCases || 0) > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{Number(counts.slaBreachedCases || 0)}</strong></div>
    </div>
    <h3 className="mt-6 text-sm font-semibold text-white">{t('adminComplianceVerifications')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceRequestedTier')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceProvider')}</th><th className="px-3 py-3 font-medium">{t('adminOpened')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!verifications.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoVerifications')}</td></tr> : verifications.map((verification) => <tr key={verification.id}><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{verification.customerId}</span>{verification.customerEmail && <p className="mt-1 text-gray-500">{verification.customerEmail}</p>}</td><td className="px-3 py-3 text-gray-400">{t('adminComplianceTier', { tier: verification.requestedTier })}</td><td className="px-3 py-3 text-gray-500">{verification.provider}</td><td className="px-3 py-3 text-gray-500">{dateTime(verification.createdAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('verification', verification, 'approve')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApprove')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('verification', verification, 'reject')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div></td></tr>)}</tbody></table></div>
    <h3 className="mt-6 text-sm font-semibold text-white">{t('adminComplianceSanctions')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminComplianceSubject')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceHitContext')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceScreenedAt')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!sanctions.length ? <tr><td colSpan="4" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoSanctions')}</td></tr> : sanctions.map((hit) => <tr key={hit.id}><td className="px-3 py-3 text-white"><Badge status={hit.subjectType} /><span className="ml-2 font-mono text-[11px]">{hit.subjectId}</span>{hit.subjectEmail && <p className="mt-1 text-gray-500">{hit.subjectEmail}</p>}</td><td className="px-3 py-3 text-amber-300">{hit.hitContext || t('adminComplianceManualReview')}</td><td className="px-3 py-3 text-gray-500">{dateTime(hit.screenedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('sanction', hit, 'clear')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminComplianceClearHit')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('sanction', hit, 'confirm')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminComplianceConfirmHit')}</button></div></td></tr>)}</tbody></table></div>
    <h3 className="mt-6 text-sm font-semibold text-white">{t('adminComplianceCases')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminComplianceCaseType')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSubject')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSeverity')}</th><th className="px-3 py-3 font-medium">{t('adminStatus')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSla')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceEvidence')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{!cases.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoCases')}</td></tr> : cases.map((c) => <tr key={c.id}><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{c.caseType}</span><p className="mt-1 font-mono text-[10px] text-gray-700">{c.id.slice(0, 8)}</p></td><td className="px-3 py-3 text-white"><Badge status={c.subjectType} /><span className="ml-2 font-mono text-[11px]">{c.subjectId}</span>{c.subjectEmail && <p className="mt-1 text-gray-500">{c.subjectEmail}</p>}</td><td className="px-3 py-3"><Badge status={c.severity} /></td><td className="px-3 py-3"><Badge status={c.status} /></td><td className="px-3 py-3">{c.slaBreached ? <span className="font-semibold text-red-300">{t('adminComplianceSlaBreachedLabel')}</span> : <span className="text-gray-400">{c.slaHoursRemaining !== null ? t('adminComplianceSlaHours', { hours: Math.max(0, Math.round(c.slaHoursRemaining)) }) : '-'}</span>}<p className="mt-1 text-gray-600">{t('adminComplianceDue')} {dateTime(c.slaDueAt)}</p></td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[320px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify(c.evidence || {}, null, 2)}</pre></details></td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{c.status === 'open' && <button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'investigating')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminReview')}</button>}<button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'escalated')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminComplianceEscalate')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'resolved')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminResolve')}</button></div></td></tr>)}</tbody></table></div>
  </Section>;
}

// Phase 7 (gap 9): maker-checker queue. The maker (the admin who queued the
// action) cannot approve it; the checker approves with a fresh step-up code.

export default function OxsteedCreditCompliancePage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice, idempotencyKeysRef, loadRequestRef } = useCreditPageState();
  const [complianceQueue, setComplianceQueue] = useState(null);
  const [queueError, setQueueError] = useState('');
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  // T38-F02: paginate the compliance queue.
  const [queuePage, setQueuePage] = useState(0);
  const QUEUE_PAGE_SIZE = 50;

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    setQueueError('');
    try {
      const complianceResponse = await adminApi.get('/admin/super/oxsteed-credit/compliance-queue', {
        params: { limit: QUEUE_PAGE_SIZE, offset: queuePage * QUEUE_PAGE_SIZE },
      });
      if (requestId !== loadRequestRef.current) return;
      setComplianceQueue(complianceResponse.data || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) setQueueError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t, queuePage]);

  useEffect(() => { load(); }, [load]);

  const decideCompliance = async (kind, item, decision) => {
    const reason = await requestDialog({
      kind: 'text',
      title: t('adminComplianceDecisionTitle', { decision }),
      description: t('adminComplianceDecisionDescription', { kind, id: String(item.id).slice(0, 8) }),
      label: t('adminRequiredAuditReason'),
    });
    if (!reason?.trim()) {
      setError(t('adminComplianceReasonRequired'));
      return;
    }
    setBusy(true); setNotice(''); setError('');
    try {
      const endpoints = {
        verification: `/admin/super/oxsteed-credit/compliance/verifications/${item.id}/decision`,
        sanction: `/admin/super/oxsteed-credit/compliance/sanctions/${item.id}/decision`,
        case: `/admin/super/oxsteed-credit/compliance/cases/${item.id}/transition`,
      };
      const payload = kind === 'case' ? { toStatus: decision, reason: reason.trim() } : { decision, reason: reason.trim() };
      await adminApi.post(endpoints[kind], payload, { headers: { 'Idempotency-Key': idempotencyKeysRef.current.get('credit-compliance', { kind, id: item.id, decision }) } });
      idempotencyKeysRef.current.clear('credit-compliance', { kind, id: item.id, decision });
      setNotice(t('adminComplianceDecided', { kind, decision }));
      await load({ quiet: true });
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminComplianceDecisionFailed')));
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
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminComplianceQueue')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminComplianceQueueDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      {queueError && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{queueError}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">{t('adminRetry')}</button></div>}
      <ComplianceQueue
        queue={complianceQueue}
        busy={busy}
        decideCompliance={decideCompliance}
      />
      {/* T38-F02: queue pagination */}
      {(() => {
        const counts = complianceQueue?.counts || {};
        const total = Math.max(
          Number(counts.pendingVerifications || 0),
          Number(counts.pendingSanctions || 0),
          Number(counts.openCases || 0)
        );
        const totalPages = Math.ceil(total / QUEUE_PAGE_SIZE);
        if (totalPages <= 1) return null;
        return (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setQueuePage(p => Math.max(0, p - 1))}
              disabled={queuePage <= 0}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {t('adminPrevious')}
            </button>
            <span className="text-xs text-gray-400">
              {t('adminPageOf', { page: queuePage + 1, total: totalPages })}
            </span>
            <button
              type="button"
              onClick={() => setQueuePage(p => Math.min(totalPages - 1, p + 1))}
              disabled={queuePage >= totalPages - 1}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {t('adminNext')}
            </button>
          </div>
        );
      })()}
      </main>
    </>
  );
}
