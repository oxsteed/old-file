import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Percent, RefreshCw, Repeat } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { createStableIdempotencyKeyStore } from './creditIdempotency';
import { formatCreditDateTime } from '../../../lib/creditDateTime';
import { formatCreditMinorUnits } from '../../../lib/creditCurrency';
import { safeCreditErrorMessage } from '../../../lib/creditErrors';

const WITHDRAWAL_STATUSES = ['requested', 'approved', 'processing', 'paid', 'failed', 'rejected', 'cancelled', 'requires_attention'];
const PAGE_SIZE = 50;

function statusClass(status) {
  if (status === 'paid') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (['approved', 'processing'].includes(status)) return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  if (status === 'requested') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (['failed', 'rejected', 'requires_attention'].includes(status)) return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-gray-700 bg-gray-900 text-gray-400';
}

function Badge({ status, t }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>{t(`moneyOut.status.${status}`, { defaultValue: status.replace(/_/g, ' ') })}</span>;
}

function money(cents, currency) {
  return formatCreditMinorUnits(cents, currency || 'USD');
}

function dateTime(value, t) {
  return formatCreditDateTime(value, value ? t('moneyOut.unknown', { defaultValue: 'Unknown' }) : t('moneyOut.notAvailable', { defaultValue: 'N/A' }), t.lng);
}

function SectionShell({ icon: Icon, eyebrow, title, detail, action, children }) {
  return <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400"><Icon className="h-3.5 w-3.5" />{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        {detail && <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{detail}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>;
}

function StepupPrompt({ t, pending, code, setCode, onConfirm, onCancel, busy }) {
  return <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
    <p className="text-xs text-amber-200">{t('moneyOut.stepupPrompt', { defaultValue: 'A verification code was emailed to you. Enter it to confirm this money movement.' })}</p>
    <p className="mt-1 font-mono text-[10px] text-gray-500">{t('moneyOut.challengeExpires', { defaultValue: 'Challenge expires' })}: {dateTime(pending.expiresAt, t)}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" placeholder={t('moneyOut.stepupCodePlaceholder', { defaultValue: 'Verification code' })} className="w-44 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-gray-600 focus:border-amber-400" />
      <button type="button" onClick={onConfirm} disabled={busy || code.length < 4} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{t('moneyOut.confirmApprove', { defaultValue: 'Confirm approval' })}</button>
      <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">{t('moneyOut.cancel', { defaultValue: 'Cancel' })}</button>
    </div>
  </div>;
}

export default function OxsteedCreditMoneyOut({ busy = false }) {
  const { t } = useTranslation('credit');
  const [withdrawals, setWithdrawals] = useState([]);
  const [withdrawalStatus, setWithdrawalStatus] = useState('requested');
  const [conversions, setConversions] = useState([]);
  const [feeRows, setFeeRows] = useState([]);
  const [feeDrafts, setFeeDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingApproval, setPendingApproval] = useState(null);
  const [stepupCode, setStepupCode] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const idempotencyKeysRef = useRef(createStableIdempotencyKeyStore());

  const loadWithdrawals = async () => {
    try {
      const params = { limit: PAGE_SIZE, offset: 0 };
      if (withdrawalStatus !== 'all') params.status = withdrawalStatus;
      const response = await adminApi.get('/admin/super/oxsteed-credit/withdrawals', { params });
      setWithdrawals(response.data?.withdrawals || []);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.loadWithdrawals', { defaultValue: 'Could not load withdrawals.' })));
    }
  };

  const loadConversions = async () => {
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/restaurant-conversions', { params: { limit: PAGE_SIZE, offset: 0 } });
      setConversions(response.data?.conversions || []);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.loadConversions', { defaultValue: 'Could not load conversions.' })));
    }
  };

  const loadFees = async () => {
    try {
      const response = await adminApi.get('/admin/super/oxsteed-credit/fee-schedule');
      const rows = response.data?.schedule || [];
      setFeeRows(rows);
      const drafts = {};
      rows.forEach((row) => {
        drafts[row.id] = {
          fixedCents: String(row.fixed_cents ?? 0),
          percentageBps: String(row.percentage_bps ?? 0),
          minFeeCents: String(row.min_fee_cents ?? 0),
          maxFeeCents: row.max_fee_cents === null || row.max_fee_cents === undefined ? '' : String(row.max_fee_cents),
        };
      });
      setFeeDrafts(drafts);
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.loadFees', { defaultValue: 'Could not load the fee schedule.' })));
    }
  };

  const loadAll = async () => {
    setLoading(true);
    setError('');
    await Promise.all([loadWithdrawals(), loadConversions(), loadFees()]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadWithdrawals(); }, [withdrawalStatus]);

  const issueApprovalChallenge = async (withdrawal) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await adminApi.post('/admin/super/oxsteed-credit/stepup-challenges', {
        actionType: 'withdrawal',
        amountCents: withdrawal.amountCents,
        currencyCode: withdrawal.currencyCode,
      });
      setPendingApproval({ withdrawalId: withdrawal.id, challengeId: response.data?.challenge?.id, expiresAt: response.data?.challenge?.expiresAt });
      setStepupCode('');
      setNotice(t('moneyOut.stepupIssued', { defaultValue: 'Verification code sent. Enter it below to approve the withdrawal.' }));
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.issueChallenge', { defaultValue: 'Could not issue a verification challenge.' })));
    } finally {
      setSaving(false);
    }
  };

  const confirmApproval = async () => {
    if (!pendingApproval) return;
    setSaving(true);
    setError('');
    try {
      const key = idempotencyKeysRef.current.get(`withdrawal-approve:${pendingApproval.withdrawalId}`);
      const response = await adminApi.post(`/admin/super/oxsteed-credit/withdrawals/${pendingApproval.withdrawalId}/approve`, {
        stepupChallengeId: pendingApproval.challengeId,
        stepupCode,
      }, { headers: { 'Idempotency-Key': key } });
      // Phase 7 (gap 9): approval now queues as a pending action for a
      // second admin instead of executing immediately; 202 means queued.
      setNotice(response.status === 202
        ? t('moneyOut.approveQueued', { defaultValue: 'Approval request queued. A second admin must approve it before anything moves.' })
        : t('moneyOut.approved', { defaultValue: 'Withdrawal approved and payout initiated.' }));
      setPendingApproval(null);
      setStepupCode('');
      await loadWithdrawals();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.approve', { defaultValue: 'Could not approve the withdrawal.' })));
    } finally {
      setSaving(false);
    }
  };

  const rejectWithdrawal = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setError(t('moneyOut.errors.rejectReasonRequired', { defaultValue: 'A reason is required to reject a withdrawal. It is recorded in the audit log.' }));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await adminApi.post(`/admin/super/oxsteed-credit/withdrawals/${rejectTarget.id}/reject`, { reason: rejectReason.trim() });
      setNotice(t('moneyOut.rejected', { defaultValue: 'Withdrawal rejected.' }));
      setRejectTarget(null);
      setRejectReason('');
      await loadWithdrawals();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.reject', { defaultValue: 'Could not reject the withdrawal.' })));
    } finally {
      setSaving(false);
    }
  };

  const saveFeeRow = async (row) => {
    const draft = feeDrafts[row.id];
    if (!draft) return;
    const toIntOrNull = (value, allowEmpty) => {
      const text = String(value ?? '').trim();
      if (text === '' && allowEmpty) return null;
      if (!/^\d+$/.test(text)) return NaN;
      return Number.parseInt(text, 10);
    };
    const fixedCents = toIntOrNull(draft.fixedCents);
    const percentageBps = toIntOrNull(draft.percentageBps);
    const minFeeCents = toIntOrNull(draft.minFeeCents);
    const maxFeeCents = toIntOrNull(draft.maxFeeCents, true);
    if ([fixedCents, percentageBps, minFeeCents].some((v) => Number.isNaN(v)) || Number.isNaN(maxFeeCents)) {
      setError(t('moneyOut.errors.feeNumbers', { defaultValue: 'Fee values must be whole numbers of cents (max may be blank for no cap).' }));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await adminApi.put(`/admin/super/oxsteed-credit/fee-schedule/${row.id}`, {
        fixedCents, percentageBps, minFeeCents, maxFeeCents,
        reason: 'Fee schedule updated from the admin money-out page',
      });
      // Phase 7 (gap 9): fee schedule updates now queue as pending actions
      // for a second admin instead of applying immediately; 202 means queued.
      setNotice(response.status === 202
        ? t('moneyOut.feeQueued', { defaultValue: 'Fee schedule change queued. A second admin must approve it before it takes effect.' })
        : t('moneyOut.feeSaved', { defaultValue: 'Fee schedule updated.' }));
      await loadFees();
    } catch (err) {
      setError(safeCreditErrorMessage(err, t('moneyOut.errors.saveFee', { defaultValue: 'Could not save the fee schedule.' })));
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-6">
    {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
    {notice && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}

    <SectionShell
      icon={ArrowDownToLine}
      eyebrow={t('moneyOut.withdrawalEyebrow', { defaultValue: 'Money out' })}
      title={t('moneyOut.withdrawalTitle', { defaultValue: 'Withdrawal queue' })}
      detail={t('moneyOut.withdrawalDetail', { defaultValue: 'Customer withdrawals to their connected bank account. Approval locks the amount plus the quoted fee in the journal and initiates the Stripe payout; the withdrawal is marked paid only when Stripe confirms the transfer.' })}
      action={<div className="flex items-center gap-2">
        <select aria-label={t('moneyOut.statusFilter', { defaultValue: 'Status filter' })} value={withdrawalStatus} onChange={(event) => setWithdrawalStatus(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-orange-400">
          <option value="all">{t('moneyOut.allStatuses', { defaultValue: 'All statuses' })}</option>
          {WITHDRAWAL_STATUSES.map((status) => <option key={status} value={status}>{t(`moneyOut.status.${status}`, { defaultValue: status.replace(/_/g, ' ') })}</option>)}
        </select>
        <button type="button" onClick={loadWithdrawals} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{t('moneyOut.refresh', { defaultValue: 'Refresh' })}</button>
      </div>}
    >
      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">
        {loading ? <div className="py-14 text-center text-sm text-gray-500">{t('moneyOut.loading', { defaultValue: 'Loading...' })}</div> : (
          <table className="min-w-[1080px] w-full text-left text-xs">
            <thead className="bg-gray-950/70 text-gray-500">
              <tr>
                <th className="px-3 py-3 font-medium">{t('moneyOut.customer', { defaultValue: 'Customer' })}</th>
                <th className="px-3 py-3 font-medium">{t('moneyOut.amount', { defaultValue: 'Amount' })}</th>
                <th className="px-3 py-3 font-medium">{t('moneyOut.fee', { defaultValue: 'Fee' })}</th>
                <th className="px-3 py-3 font-medium">{t('moneyOut.net', { defaultValue: 'Net payout' })}</th>
                <th className="px-3 py-3 font-medium">{t('moneyOut.status', { defaultValue: 'Status' })}</th>
                <th className="px-3 py-3 font-medium">{t('moneyOut.requested', { defaultValue: 'Requested' })}</th>
                <th className="px-3 py-3 font-medium">{t('moneyOut.controls', { defaultValue: 'Controls' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {!withdrawals.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('moneyOut.noWithdrawals', { defaultValue: 'No withdrawals in this state.' })}</td></tr> :
                withdrawals.map((w) => <tr key={w.id}>
                  <td className="px-3 py-3 text-gray-300">{w.customerEmail || <span className="font-mono text-[10px] text-gray-500">{String(w.customerId).slice(0, 8)}</span>}<p className="mt-1 font-mono text-[10px] text-gray-700">{w.id}</p></td>
                  <td className="px-3 py-3 font-semibold text-white">{money(w.amountCents, w.currencyCode)}</td>
                  <td className="px-3 py-3 text-gray-400">{money(w.feeCents, w.currencyCode)}</td>
                  <td className="px-3 py-3 font-semibold text-emerald-300">{money(w.netAmountCents, w.currencyCode)}</td>
                  <td className="px-3 py-3"><Badge status={w.status} t={t} />{w.statusReasonCode && <p className="mt-1 font-mono text-[10px] text-gray-600">{w.statusReasonCode}</p>}</td>
                  <td className="px-3 py-3 text-gray-500">{dateTime(w.createdAt, t)}</td>
                  <td className="px-3 py-3">
                    {w.status === 'requested' && <div className="flex flex-wrap gap-2">
                      <button disabled={busy || saving} onClick={() => issueApprovalChallenge(w)} className="rounded-lg bg-emerald-600 px-2.5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{t('moneyOut.approve', { defaultValue: 'Approve' })}</button>
                      <button disabled={busy || saving} onClick={() => { setRejectTarget(w); setRejectReason(''); }} className="rounded-lg border border-red-500/30 px-2.5 py-2 font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">{t('moneyOut.reject', { defaultValue: 'Reject' })}</button>
                    </div>}
                  </td>
                </tr>)}
            </tbody>
          </table>
        )}
      </div>
      {pendingApproval && <StepupPrompt t={t} pending={pendingApproval} code={stepupCode} setCode={setStepupCode} onConfirm={confirmApproval} onCancel={() => { setPendingApproval(null); setStepupCode(''); }} busy={busy || saving} />}
      {rejectTarget && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
        <p className="text-xs text-red-200">{t('moneyOut.rejectPrompt', { defaultValue: 'Reject this withdrawal? The customer keeps their full balance; nothing moves.' })}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder={t('moneyOut.rejectReasonPlaceholder', { defaultValue: 'Reason (shown in the audit log)' })} className="w-72 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-red-400" />
          <button type="button" onClick={rejectWithdrawal} disabled={busy || saving} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">{t('moneyOut.confirmReject', { defaultValue: 'Confirm rejection' })}</button>
          <button type="button" onClick={() => { setRejectTarget(null); setRejectReason(''); }} disabled={busy || saving} className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-gray-800 disabled:opacity-50">{t('moneyOut.cancel', { defaultValue: 'Cancel' })}</button>
        </div>
      </div>}
    </SectionShell>

    <SectionShell
      icon={Percent}
      eyebrow={t('moneyOut.feeEyebrow', { defaultValue: 'Fee schedule' })}
      title={t('moneyOut.feeTitle', { defaultValue: 'Money-out fees' })}
      detail={t('moneyOut.feeDetail', { defaultValue: 'Fee = fixed + amount x bps / 10000, clamped between min and max. The fee quoted to the customer at request time is stored and the posted fee leg must match it exactly. Deploy-time environment overrides take precedence over these rows when set.' })}
    >
      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">
        <table className="min-w-[860px] w-full text-left text-xs">
          <thead className="bg-gray-950/70 text-gray-500">
            <tr>
              <th className="px-3 py-3 font-medium">{t('moneyOut.operation', { defaultValue: 'Operation' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.currency', { defaultValue: 'Currency' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.fixedCents', { defaultValue: 'Fixed (cents)' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.bps', { defaultValue: 'Basis points' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.minCents', { defaultValue: 'Min (cents)' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.maxCents', { defaultValue: 'Max (cents, blank = none)' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.controls', { defaultValue: 'Controls' })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {!feeRows.length ? <tr><td colSpan="7" className="px-3 py-10 text-center text-gray-500">{t('moneyOut.noFees', { defaultValue: 'No fee rows configured.' })}</td></tr> :
              feeRows.map((row) => {
                const draft = feeDrafts[row.id] || {};
                const setDraft = (field, value) => setFeeDrafts((prev) => ({ ...prev, [row.id]: { ...prev[row.id], [field]: value } }));
                return <tr key={row.id}>
                  <td className="px-3 py-3 font-semibold text-white">{t(`moneyOut.operation.${row.operation_type}`, { defaultValue: row.operation_type })}</td>
                  <td className="px-3 py-3 text-sky-300">{row.currency_code}</td>
                  {[['fixedCents', draft.fixedCents], ['percentageBps', draft.percentageBps], ['minFeeCents', draft.minFeeCents], ['maxFeeCents', draft.maxFeeCents]].map(([field, value]) => (
                    <td key={field} className="px-3 py-3"><input value={value ?? ''} onChange={(event) => setDraft(field, event.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="w-24 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-orange-400" /></td>
                  ))}
                  <td className="px-3 py-3"><button disabled={busy || saving} onClick={() => saveFeeRow(row)} className="rounded-lg bg-sky-600 px-2.5 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{t('moneyOut.save', { defaultValue: 'Save' })}</button></td>
                </tr>;
              })}
          </tbody>
        </table>
      </div>
    </SectionShell>

    <SectionShell
      icon={Repeat}
      eyebrow={t('moneyOut.conversionEyebrow', { defaultValue: 'Conversions' })}
      title={t('moneyOut.conversionTitle', { defaultValue: 'Restaurant credit conversions' })}
      detail={t('moneyOut.conversionDetail', { defaultValue: 'Conversions between OxSteed Credit and restaurant food-wallet credit. Both directions post atomically; the rate residual is an explicit fee leg, never silent value loss.' })}
      action={<button type="button" onClick={loadConversions} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />{t('moneyOut.refresh', { defaultValue: 'Refresh' })}</button>}
    >
      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-800">
        <table className="min-w-[860px] w-full text-left text-xs">
          <thead className="bg-gray-950/70 text-gray-500">
            <tr>
              <th className="px-3 py-3 font-medium">{t('moneyOut.direction', { defaultValue: 'Direction' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.sourceAmount', { defaultValue: 'Source' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.convertedAmount', { defaultValue: 'Converted' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.fee', { defaultValue: 'Fee' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.rate', { defaultValue: 'Rate' })}</th>
              <th className="px-3 py-3 font-medium">{t('moneyOut.created', { defaultValue: 'Created' })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {!conversions.length ? <tr><td colSpan="6" className="px-3 py-10 text-center text-gray-500">{t('moneyOut.noConversions', { defaultValue: 'No conversions yet.' })}</td></tr> :
              conversions.map((c) => <tr key={c.id}>
                <td className="px-3 py-3 text-gray-300">{t(`moneyOut.direction.${c.direction}`, { defaultValue: c.direction.replace(/_/g, ' ') })}</td>
                <td className="px-3 py-3 font-semibold text-white">{money(c.sourceAmountCents, c.currencyCode)}</td>
                <td className="px-3 py-3 font-semibold text-emerald-300">{money(c.convertedAmountCents, c.currencyCode)}</td>
                <td className="px-3 py-3 text-gray-400">{money(c.feeCents, c.currencyCode)}</td>
                <td className="px-3 py-3 font-mono text-gray-400">{c.rate}</td>
                <td className="px-3 py-3 text-gray-500">{dateTime(c.createdAt, t)}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </SectionShell>
  </div>;
}
