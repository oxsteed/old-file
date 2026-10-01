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
  CreditSubNav,
  Section,
  dateTime,
  money,
  useCreditDialog,
  useCreditPageState,
} from './shared';

function PendingActionQueue({ busy, setBusy, setNotice, setError, requestDialog, refreshSignal = 0 }) {
  const { t } = useTranslation('credit');
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stepup, setStepup] = useState(null);
  const [stepupCode, setStepupCode] = useState('');

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/pending-actions', { params: { status: 'pending', limit: 50 } });
      setActions(response.data?.pendingActions || []);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [setError, t]);

  useEffect(() => { loadActions(); }, [loadActions, refreshSignal]);

  const payloadSummary = (action) => {
    const payload = action.payload || {};
    const parts = [];
    if (payload.amountCents !== undefined && payload.amountCents !== null) parts.push(money(payload.amountCents, payload.currencyCode || 'USD'));
    const ids = ['settlementId', 'withdrawalId', 'customerId', 'accountId', 'disputeId', 'id'];
    for (const key of ids) {
      if (payload[key]) { parts.push(`${key}: ${String(payload[key]).slice(0, 12)}`); break; }
    }
    if (payload.operationType) parts.push(payload.operationType);
    return parts.length ? parts.join(' · ') : t('adminMakerCheckerNoPayloadSummary');
  };

  const issueApproveChallenge = async (action) => {
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/stepup-challenges', {
        actionType: 'pending_action_approve',
        amountCents: action.amountCents || undefined,
        currencyCode: action.currencyCode || undefined,
      });
      setStepup({ actionId: action.id, challengeId: response.data?.challenge?.id, expiresAt: response.data?.challenge?.expiresAt });
      setStepupCode('');
      setNotice(t('adminMakerCheckerStepupIssued'));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerChallengeFailed')));
    } finally { setBusy(false); }
  };

  const confirmApprove = async () => {
    if (!stepup) return;
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/pending-actions/${stepup.actionId}/decision`, {
        decision: 'approve',
        stepupChallengeId: stepup.challengeId,
        stepupCode,
      });
      setNotice(t('adminMakerCheckerApproved'));
      setStepup(null); setStepupCode('');
      await loadActions();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerDecisionFailed')));
    } finally { setBusy(false); }
  };

  const rejectAction = async (action) => {
    const reason = await requestDialog({
      kind: 'text',
      title: t('adminMakerCheckerRejectTitle'),
      description: t('adminMakerCheckerRejectDescription', { type: action.actionType }),
      label: t('adminRequiredAuditReason'),
    });
    if (!reason?.trim()) { setError(t('adminMakerCheckerReasonRequired')); return; }
    setBusy(true); setNotice(''); setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/pending-actions/${action.id}/decision`, { decision: 'rejected', reason: reason.trim() });
      setNotice(t('adminMakerCheckerRejected'));
      await loadActions();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('adminMakerCheckerDecisionFailed')));
    } finally { setBusy(false); }
  };

  return <Section eyebrow="Pending actions" title="Maker-checker queue" detail="Money-moving actions queued by one admin wait here for a different admin to approve. Approving needs a fresh verification code; rejecting needs a reason. Nothing executes until a second identity approves it.">
    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-gray-950/70 text-gray-500"><tr><th className="px-3 py-3 font-medium">{t('adminMakerCheckerAction')}</th><th className="px-3 py-3 font-medium">{t('adminMakerCheckerMaker')}</th><th className="px-3 py-3 font-medium">{t('adminMakerCheckerPayload')}</th><th className="px-3 py-3 font-medium">{t('adminMakerCheckerExpires')}</th><th className="px-3 py-3 font-medium">{t('adminControls')}</th></tr></thead><tbody className="divide-y divide-gray-800">{loading ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminLoading')}</td></tr> : !actions.length ? <tr><td colSpan="5" className="px-3 py-10 text-center text-gray-500">{t('adminMakerCheckerEmpty')}</td></tr> : actions.map((action) => <tr key={action.id}><td className="px-3 py-3"><span className="font-mono text-[11px] text-orange-300">{action.actionType}</span><p className="mt-1 font-mono text-[10px] text-gray-700">{action.id.slice(0, 8)}</p></td><td className="px-3 py-3 text-white"><span className="font-mono text-[11px]">{action.requestedBy || t('adminUnknown')}</span><p className="mt-1 text-gray-600">{dateTime(action.requestedAt)}</p></td><td className="px-3 py-3 text-gray-400">{payloadSummary(action)}<details><summary className="cursor-pointer text-sky-300">{t('adminViewState')}</summary><pre className="mt-2 max-w-[320px] whitespace-pre-wrap break-words text-[10px] leading-4 text-gray-500">{JSON.stringify(action.payload || {}, null, 2)}</pre></details></td><td className="px-3 py-3 text-gray-500">{dateTime(action.expiresAt)}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => issueApproveChallenge(action)} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('adminApprove')}</button><button type="button" disabled={busy} onClick={() => rejectAction(action)} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('adminReject')}</button></div></td></tr>)}</tbody></table></div>
    {stepup && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs text-amber-200">{t('adminMakerCheckerStepupPrompt')}</p>
      <p className="mt-1 font-mono text-[10px] text-gray-500">{t('adminMakerCheckerExpires')}: {dateTime(stepup.expiresAt)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={stepupCode} onChange={(event) => setStepupCode(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" placeholder={t('adminMakerCheckerCodePlaceholder')} className="w-44 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-gray-600 focus:border-amber-400" />
        <button type="button" onClick={confirmApprove} disabled={busy || stepupCode.length < 4} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{t('adminMakerCheckerConfirmApprove')}</button>
        <button type="button" onClick={() => { setStepup(null); setStepupCode(''); }} disabled={busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">{t('cancel')}</button>
      </div>
    </div>}
  </Section>;
}

export default function OxsteedCreditApprovalsPage() {
  const { t } = useTranslation('credit');
  const { loading, setLoading, busy, setBusy, error, setError, notice, setNotice } = useCreditPageState();
  const { dialog, requestDialog, resolveDialog } = useCreditDialog();
  const [refreshSignal, setRefreshSignal] = useState(0);
  return (
    <>
      <AdminActionDialog dialog={dialog} onResolve={resolveDialog} />
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminPendingActionQueue')}</h1>
            <p className="mt-2 text-sm leading-6 text-gray-400">{t('adminPendingActionQueueDescription')}</p>
          </div>
          <button type="button" onClick={() => setRefreshSignal((value) => value + 1)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900/70 px-4 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('adminRefresh')}</button>
        </div>
      </header>
      {error && <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span><button type="button" onClick={() => setRefreshSignal((value) => value + 1)} disabled={loading || busy} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50">{t('adminRetryDashboard')}</button></div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
        <PendingActionQueue
          busy={busy}
          setBusy={setBusy}
          setNotice={setNotice}
          setError={setError}
          requestDialog={requestDialog}
          refreshSignal={refreshSignal}
        />
      </main>
    </>
  );
}
