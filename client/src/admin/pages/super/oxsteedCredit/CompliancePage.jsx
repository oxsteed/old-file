import { Fragment, useCallback, useEffect, useState } from 'react';
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

const MATCH_FIELDS = ['primary_name', 'alias', 'weak_alias'];
const QUEUE_PAGE_SIZE = 50;
const scorePct = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 1000) / 10}%` : '-';
};

/**
 * Gap fill 3: what a sanctions hit actually matched, so the clear/confirm
 * decision is made with the evidence on screen. The read is audited on the
 * server; a failed audit means the details are not shown.
 */
export function SanctionMatchDetails({ screeningId }) {
  const { t } = useTranslation('credit');
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    let alive = true;
    adminApi.get(`/admin/super/credit-licence/sanctions/screenings/${encodeURIComponent(screeningId)}/matches`)
      .then(({ data }) => { if (alive) setState({ loading: false, error: '', data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: safeCreditErrorMessage(err, t('adminComplianceMatchFailed')), data: null }); });
    return () => { alive = false; };
  }, [screeningId, t]);
  if (state.loading) return <p role="status" className="text-gray-500">{t('adminComplianceMatchLoading')}</p>;
  if (state.error) return <p role="alert" className="text-red-300">{state.error}</p>;
  const { screening, matches } = state.data || {};
  return (
    <div className="space-y-3" data-testid="sanction-match-details">
      {screening && (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <div><dt className="text-gray-500">{t('adminComplianceScreenedName')}</dt><dd className="font-semibold text-gray-900 dark:text-white"><bdi>{screening.screened_name || '-'}</bdi></dd></div>
          <div><dt className="text-gray-500">{t('adminComplianceTopScore')}</dt><dd className="font-semibold text-gray-900 dark:text-white"><bdi dir="ltr">{scorePct(screening.top_score)}</bdi></dd></div>
        </dl>
      )}
      {!matches?.length ? <p className="text-gray-500">{t('adminComplianceNoMatches')}</p> : (
        <ul className="space-y-2">
          {matches.map((m) => (
            <li key={m.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-gray-900 dark:text-white"><bdi>{m.matched_name}</bdi></strong>
                <span className="font-semibold text-amber-300">{t('adminComplianceMatchScore')}: <bdi dir="ltr">{scorePct(m.score)}</bdi></span>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <div><dt className="text-gray-500">{t('adminComplianceMatchListEntry')}</dt><dd><bdi>{m.primary_name || m.matched_name}</bdi> · <bdi dir="ltr" className="font-mono">{m.external_id}</bdi>{m.entry_type ? ` · ${m.entry_type}` : ''}</dd></div>
                <div><dt className="text-gray-500">{t('adminComplianceMatchSource')}</dt><dd><bdi>{m.source_name || m.source_id}</bdi>{m.source_authority ? ` · ${m.source_authority}` : ''}</dd></div>
                <div><dt className="text-gray-500">{t('adminComplianceMatchVersion')}</dt><dd><bdi dir="ltr" className="font-mono">{m.version_sha256 ? m.version_sha256.slice(0, 12) : (m.version_id || '-')}</bdi>{m.version_published_at ? ` · ${dateTime(m.version_published_at)}` : ''}</dd></div>
                <div><dt className="text-gray-500">{t('adminComplianceMatchFields')}</dt><dd>{(m.matched_fields || []).filter((f) => MATCH_FIELDS.includes(f)).map((f) => t(`adminComplianceMatchField_${f}`)).join(', ')}</dd></div>
                <div><dt className="text-gray-500">{t('adminComplianceMatchQuery')}</dt><dd><bdi>{m.query_name}</bdi></dd></div>
                {m.programs?.length > 0 && <div><dt className="text-gray-500">{t('adminComplianceMatchPrograms')}</dt><dd><bdi dir="ltr">{m.programs.join(', ')}</bdi></dd></div>}
                {m.countries?.length > 0 && <div><dt className="text-gray-500">{t('adminComplianceMatchCountries')}</dt><dd><bdi dir="ltr">{m.countries.join(', ')}</bdi></dd></div>}
                {m.birth_dates?.length > 0 && <div><dt className="text-gray-500">{t('adminComplianceMatchBirthDates')}</dt><dd><bdi dir="ltr">{m.birth_dates.join(', ')}</bdi></dd></div>}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Domain 7 #12: each queue list pages on its own. One shared pager driven
// by the max of three unrelated counts desynced the lists; each pager below
// is driven by its own list total.
function QueuePager({ page, total, onPage }) {
  const { t } = useTranslation('credit');
  const totalPages = Math.ceil(Number(total || 0) / QUEUE_PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page <= 0}
        className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {t('adminPrevious')}
      </button>
      <span className="text-xs text-gray-600 dark:text-gray-400">
        {t('adminPageOf', { page: page + 1, total: totalPages })}
      </span>
      <button
        type="button"
        onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {t('adminNext')}
      </button>
    </div>
  );
}

function ComplianceQueue({ queue, busy, decideCompliance, pages, onPage, loading, error }) {
  const { t } = useTranslation('credit');
  const verifications = queue?.verifications || [];
  const sanctions = queue?.sanctions || [];
  const cases = queue?.cases || [];
  const counts = queue?.counts || {};
  const [openMatches, setOpenMatches] = useState(() => new Set());
  const toggleMatches = (id) => setOpenMatches((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <Section eyebrow="Compliance queue" title="Identity, sanctions, and monitoring cases" detail="Pending identity verifications, uncleared sanctions hits, and open transaction-monitoring cases with SLA state. Every decision records the admin, the reason, and an audit event.">
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminCompliancePendingVerifications')}</p><strong className="mt-1 block text-lg text-amber-300">{Number(counts.pendingVerifications || 0)}</strong></div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminCompliancePendingSanctions')}</p><strong className="mt-1 block text-lg text-red-300">{Number(counts.pendingSanctions || 0)}</strong></div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminComplianceOpenCases')}</p><strong className="mt-1 block text-lg text-sky-300">{Number(counts.openCases || 0)}</strong></div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{t('adminComplianceSlaBreached')}</p><strong className={`mt-1 block text-lg ${Number(counts.slaBreachedCases || 0) > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{Number(counts.slaBreachedCases || 0)}</strong></div>
    </div>
    <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-white">{t('adminComplianceVerifications')}</h3>
    <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-400">{t('adminComplianceAppealsExplainer')}</p>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-gray-50/70 dark:bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminCustomer')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceRequestedTier')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceProvider')}</th><th className="px-3 py-3 font-medium">{t('adminOpened')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceAppealsColumn')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-200 dark:divide-gray-800">{loading ? <tr><td colSpan="6" role="status" className="px-3 py-10 text-center text-gray-500">{t('adminLoading')}</td></tr> : error ? <tr><td colSpan="6" role="alert" className="px-3 py-10 text-center text-red-300">{error}</td></tr> : !loading && !error && !verifications.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoVerifications')}</td></tr> : verifications.map((verification) => <tr key={verification.id}><td className="px-3 py-3 text-gray-900 dark:text-white"><span className="font-mono text-[11px]">{verification.customerId}</span>{verification.customerEmail && <p className="mt-1 text-gray-500">{verification.customerEmail}</p>}</td><td className="px-3 py-3 text-gray-600 dark:text-gray-400">{t('adminComplianceTier', { tier: verification.requestedTier })}</td><td className="px-3 py-3 text-gray-500">{verification.provider}</td><td className="px-3 py-3 text-gray-500">{dateTime(verification.createdAt)}</td><td className="px-3 py-3">{verification.appealStatus ? <><Badge status={verification.appealStatus} />{verification.appealReason && <p className="mt-1 text-gray-500">{verification.appealReason}</p>}</> : <span className="text-gray-500">-</span>}</td><td className="px-3 py-3">{verification.appealStatus === 'pending' ? <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('appeal', verification, 'approve')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminComplianceAppealsApprove')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('appeal', verification, 'reject')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminComplianceAppealsReject')}</button></div> : <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('verification', verification, 'approve')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApprove')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('verification', verification, 'reject')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div>}</td></tr>)}</tbody></table></div>
    <QueuePager page={pages.verifications} total={counts.pendingVerifications} onPage={(next) => onPage('verifications', next)} />
    <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-white">{t('adminComplianceSanctions')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800"><table className="min-w-[900px] w-full text-left text-xs"><thead className="bg-gray-50/70 dark:bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminComplianceSubject')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceHitContext')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceScreenedAt')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-200 dark:divide-gray-800">{loading ? <tr><td colSpan="4" role="status" className="px-3 py-10 text-center text-gray-500">{t('adminLoading')}</td></tr> : error ? <tr><td colSpan="4" role="alert" className="px-3 py-10 text-center text-red-300">{error}</td></tr> : !loading && !error && !sanctions.length ? <tr><td colSpan="4" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoSanctions')}</td></tr> : sanctions.map((hit) => <Fragment key={hit.id}><tr><td className="px-3 py-3 text-gray-900 dark:text-white"><Badge status={hit.subjectType} />{hit.subjectName && <p className="mt-1 font-semibold">{hit.subjectName}</p>}<span className="font-mono text-[11px] text-gray-600 dark:text-gray-400">{hit.subjectId}</span>{hit.subjectEmail && <p className="mt-1 text-gray-500">{hit.subjectEmail}</p>}</td><td className="px-3 py-3 text-amber-300">{hit.hitContext || t('adminComplianceManualReview')}</td><td className="px-3 py-3 text-gray-500">{dateTime(hit.screenedAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decideCompliance('sanction', hit, 'clear')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminComplianceClearHit')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('sanction', hit, 'confirm')} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminComplianceConfirmHit')}</button><button type="button" aria-expanded={openMatches.has(hit.id)} aria-controls={`sanction-matches-${hit.id}`} onClick={() => toggleMatches(hit.id)} className="rounded-lg border border-sky-500/30 px-2.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/10">{openMatches.has(hit.id) ? t('adminComplianceHideMatchDetails') : t('adminComplianceMatchDetails')}</button></div></td></tr>{openMatches.has(hit.id) && <tr id={`sanction-matches-${hit.id}`}><td colSpan="4" className="px-3 py-3 bg-gray-50/40 dark:bg-gray-950/40"><SanctionMatchDetails screeningId={hit.id} /></td></tr>}</Fragment>)}</tbody></table></div>
    <QueuePager page={pages.sanctions} total={counts.pendingSanctions} onPage={(next) => onPage('sanctions', next)} />
    <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-white">{t('adminComplianceCases')}</h3>
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-50/70 dark:bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminComplianceCaseType')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSubject')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSeverity')}</th><th className="px-3 py-3 font-medium">{t('adminStatus')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceSla')}</th><th className="px-3 py-3 font-medium">{t('adminComplianceEvidence')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-200 dark:divide-gray-800">{loading ? <tr><td colSpan="7" role="status" className="px-3 py-10 text-center text-gray-500">{t('adminLoading')}</td></tr> : error ? <tr><td colSpan="7" role="alert" className="px-3 py-10 text-center text-red-300">{error}</td></tr> : !loading && !error && !cases.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('adminComplianceNoCases')}</td></tr> : cases.map((c) => <tr key={c.id}><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{c.caseType}</span><p className="mt-1 font-mono text-[10px] text-gray-700">{c.id.slice(0, 8)}</p></td><td className="px-3 py-3 text-gray-900 dark:text-white"><Badge status={c.subjectType} /><span className="ml-2 font-mono text-[11px]">{c.subjectId}</span>{c.subjectEmail && <p className="mt-1 text-gray-500">{c.subjectEmail}</p>}</td><td className="px-3 py-3"><Badge status={c.severity} /></td><td className="px-3 py-3"><Badge status={c.status} /></td><td className="px-3 py-3">{c.slaBreached ? <span className="font-semibold text-red-300">{t('adminComplianceSlaBreachedLabel')}</span> : <span className="text-gray-600 dark:text-gray-400">{c.slaHoursRemaining !== null ? t('adminComplianceSlaHours', { hours: Math.max(0, Math.round(c.slaHoursRemaining)) }) : '-'}</span>}<p className="mt-1 text-gray-600">{t('adminComplianceDue')} {dateTime(c.slaDueAt)}</p></td><td className="px-3 py-3 text-gray-500"><details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[320px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify(c.evidence || {}, null, 2)}</pre></details></td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{c.status === 'open' && <button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'investigating')} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('adminReview')}</button>}<button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'escalated')} className="rounded-lg border border-amber-500/30 px-2.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">{t('adminComplianceEscalate')}</button><button type="button" disabled={busy} onClick={() => decideCompliance('case', c, 'resolved')} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminResolve')}</button></div></td></tr>)}</tbody></table></div>
    <QueuePager page={pages.cases} total={counts.openCases} onPage={(next) => onPage('cases', next)} />
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
  // Domain 7 #12: each queue list pages independently.
  const [verificationsPage, setVerificationsPage] = useState(0);
  const [sanctionsPage, setSanctionsPage] = useState(0);
  const [casesPage, setCasesPage] = useState(0);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    setQueueError('');
    try {
      const complianceResponse = await adminApi.get('/admin/super/oxsteed-credit/compliance-queue', {
        params: {
          limit: QUEUE_PAGE_SIZE,
          verificationsOffset: verificationsPage * QUEUE_PAGE_SIZE,
          sanctionsOffset: sanctionsPage * QUEUE_PAGE_SIZE,
          casesOffset: casesPage * QUEUE_PAGE_SIZE,
        },
      });
      if (requestId !== loadRequestRef.current) return;
      setComplianceQueue(complianceResponse.data || null);
    } catch (err) {
      if (requestId === loadRequestRef.current) setQueueError(safeCreditErrorMessage(err, t('adminLoadFailed')));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [t, verificationsPage, sanctionsPage, casesPage]);

  const setQueueListPage = (list, next) => {
    if (list === 'verifications') setVerificationsPage(next);
    else if (list === 'sanctions') setSanctionsPage(next);
    else setCasesPage(next);
  };

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
      // ADM-020: compliance decisions that unlock fiat funding require a
      // fresh step-up challenge, not just the admin session.
      const stepupActionTypes = {
        verification: 'compliance_verification_decision',
        appeal: 'compliance_verification_decision',
        sanction: 'compliance_sanction_decision',
        case: 'compliance_case_transition',
      };
      const challengeResponse = await adminApi.post('/admin/super/oxsteed-credit/stepup-challenges', {
        actionType: stepupActionTypes[kind],
      });
      const challengeId = challengeResponse.data?.challenge?.id;
      if (!challengeId) { setError(t('agentAdjQueueStepupFailed')); return; }
      setNotice(t('adminMakerCheckerStepupIssued'));
      const code = await requestDialog({
        kind: 'text',
        title: t('agentAdjQueueStepupTitle'),
        description: t('adminComplianceStepupDescription'),
        label: t('agentAdjQueueStepupLabel'),
      });
      if (!code?.trim()) { setError(t('agentAdjQueueStepupRequired')); return; }
      const endpoints = {
        verification: `/admin/super/oxsteed-credit/compliance/verifications/${item.id}/decision`,
        appeal: `/admin/super/oxsteed-credit/compliance/verifications/${item.id}/appeal-decision`,
        sanction: `/admin/super/oxsteed-credit/compliance/sanctions/${item.id}/decision`,
        case: `/admin/super/oxsteed-credit/compliance/cases/${item.id}/transition`,
      };
      const payload = kind === 'case'
        ? { toStatus: decision, reason: reason.trim(), stepupChallengeId: challengeId, stepupCode: code.trim() }
        : { decision, reason: reason.trim(), stepupChallengeId: challengeId, stepupCode: code.trim() };
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
      <header className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white sm:text-3xl">{t('adminComplianceQueue')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{t('adminComplianceQueueDescription')}</p>
          </div>
          <button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
      {queueError && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{queueError}</span><button type="button" onClick={() => load({ quiet: true })} disabled={loading || busy} className="rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">{t('adminRetry')}</button></div>}
      <ComplianceQueue
        queue={complianceQueue}
        busy={busy}
        decideCompliance={decideCompliance}
        pages={{ verifications: verificationsPage, sanctions: sanctionsPage, cases: casesPage }}
        onPage={setQueueListPage}
        loading={loading}
        error={queueError}
      />
      </main>
    </>
  );
}
