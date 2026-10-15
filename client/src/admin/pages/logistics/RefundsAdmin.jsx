import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  adminListRefunds,
  adminGetRefund,
  adminGetRefundDecisions,
  adminProposeRefund,
  adminVerifyRefundStepUp,
  adminApproveRefund,
  adminRejectRefund,
  adminExecuteRefund,
} from '../../../api/logistics';
import { useAuth } from '../../../hooks/useAuth';
import AdminErrorState from '../../lib/AdminErrorState';
import LogisticsModal from '../../../components/logistics/LogisticsModal';
import LogisticsStatusPill from '../../../components/logistics/LogisticsStatusPill';
import '../../../styles/logistics/LogisticsHomePage.css';
import '../../../styles/logistics/LogisticsWorkspaces.css';

const NS = 'logistics.refunds';
const STATUSES = ['proposed', 'approved', 'executing', 'processed', 'failed', 'rejected', 'expired', 'pending', 'reviewing'];

const fmtMoney = (cents) => (cents == null ? '—' : `$${(Number(cents) / 100).toFixed(2)}`);
const fmtDate = (v, lang) => (v ? new Date(v).toLocaleString(lang) : '—');

export default function RefundsAdmin() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [busy, setBusy] = useState(false);

  // Propose form
  const [proposing, setProposing] = useState(false);
  const [pForm, setPForm] = useState({ payment_attempt_id: '', amount_usd: '', refund_method: 'stripe', reason: '' });

  // Step-up (approve) flow
  const [stepUp, setStepUp] = useState(null); // { caseId, code, verifying }
  const [stepUpFresh, setStepUpFresh] = useState(false);

  // Reject form
  const [rejecting, setRejecting] = useState(null); // caseId
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    adminListRefunds({ status: status || undefined })
      .then((r) => setRows(r.data || []))
      .catch(setLoadError)
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const openCase = async (row) => {
    setSelected(row);
    setStepUpFresh(false);
    try {
      const [detail, decs] = await Promise.all([
        adminGetRefund(row.id).then((r) => r.data).catch(() => row),
        adminGetRefundDecisions(row.id).then((r) => r.data).catch(() => []),
      ]);
      setSelected(detail);
      setDecisions(decs || []);
    } catch { /* keep the row snapshot */ }
  };

  const statusLabel = (value) => t(`${NS}.status.${value}`, { defaultValue: String(value).replace(/_/g, ' ') });

  const doPropose = async () => {
    const amountCents = Math.round(parseFloat(pForm.amount_usd) * 100);
    if (!pForm.payment_attempt_id.trim() || !Number.isInteger(amountCents) || amountCents <= 0 || !pForm.reason.trim()) {
      toast.error(t(`${NS}.proposeInvalid`));
      return;
    }
    setBusy(true);
    try {
      await adminProposeRefund({
        payment_attempt_id: pForm.payment_attempt_id.trim(),
        amount_cents: amountCents,
        refund_method: pForm.refund_method,
        reason: pForm.reason.trim(),
      });
      toast.success(t(`${NS}.toastProposed`));
      setProposing(false);
      setPForm({ payment_attempt_id: '', amount_usd: '', refund_method: 'stripe', reason: '' });
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const doVerifyStepUp = async () => {
    if (!stepUp?.code?.trim()) return;
    setStepUp({ ...stepUp, verifying: true });
    try {
      await adminVerifyRefundStepUp(stepUp.code.trim());
      toast.success(t(`${NS}.toastStepupOk`));
      setStepUp(null);
      setStepUpFresh(true);
    } catch (err) {
      toast.error(err?.response?.data?.error || t(`${NS}.toastStepupFailed`));
      setStepUp({ ...stepUp, verifying: false });
    }
  };

  const doApprove = async (note) => {
    setBusy(true);
    try {
      const res = await adminApproveRefund(selected.id, note ? { reason: note } : {});
      toast.success(t(`${NS}.toastApproved`));
      setStepUpFresh(false);
      openCase(res.data);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const doReject = async () => {
    if (!rejectReason.trim()) { toast.error(t(`${NS}.rejectReasonRequired`)); return; }
    setBusy(true);
    try {
      const res = await adminRejectRefund(rejecting, { reason: rejectReason.trim() });
      toast.success(t(`${NS}.toastRejected`));
      setRejecting(null);
      setRejectReason('');
      openCase(res.data);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const doExecute = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t(`${NS}.executeConfirmBody`))) return;
    setBusy(true);
    try {
      const res = await adminExecuteRefund(selected.id);
      if (res.failed) toast.error(t(`${NS}.toastExecuteFailed`));
      else if (res.replayed) toast.success(t(`${NS}.toastExecuteReplayed`));
      else toast.success(t(`${NS}.toastExecuted`));
      openCase(res.data);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const isProposer = selected && user && String(selected.proposed_by) === String(user.id);

  return (
    <div className="lx-page">
      <div className="lx-page-header">
        <h1 className="lx-page-title">{t(`${NS}.title`)}</h1>
        <p className="lx-page-sub">{t(`${NS}.subtitle`)}</p>
      </div>

      <div className="lx-filter-bar">
        <select className="lx-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t(`${NS}.filterStatus`)}>
          <option value="">{t(`${NS}.allStatuses`)}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <button className="lx-btn-primary" onClick={() => setProposing(true)}>{t(`${NS}.proposeButton`)}</button>
      </div>

      {loading && <div className="lx-loading">{t(`${NS}.loading`)}</div>}
      {!loading && loadError && <AdminErrorState onRetry={load} />}

      {!loading && !loadError && (
        <div className="lx-table-wrap">
          <table className="lx-table">
            <thead>
              <tr>
                <th>{t(`${NS}.thReference`)}</th>
                <th>{t(`${NS}.thAmount`)}</th>
                <th>{t(`${NS}.thMethod`)}</th>
                <th>{t(`${NS}.thReason`)}</th>
                <th>{t(`${NS}.thProposer`)}</th>
                <th>{t(`${NS}.thStatus`)}</th>
                <th>{t(`${NS}.thCreated`)}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><code style={{ fontSize: '.78rem' }}>{r.reference}</code></td>
                  <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{fmtMoney(r.amount_cents ?? (r.requested_amount_usd != null ? Math.round(r.requested_amount_usd * 100) : null))}</td>
                  <td style={{ fontSize: '.8rem' }}>{r.refund_method ? t(`${NS}.method.${r.refund_method}`, { defaultValue: r.refund_method }) : '—'}</td>
                  <td style={{ fontSize: '.82rem', maxWidth: '16rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.refund_reason}</td>
                  <td style={{ fontSize: '.82rem' }}>{r.proposer_name || '—'}</td>
                  <td><LogisticsStatusPill status={r.status} label={statusLabel(r.status)} /></td>
                  <td style={{ fontSize: '.8rem' }}>{fmtDate(r.created_at, i18n.language)}</td>
                  <td>
                    <button className="lx-btn-secondary" style={{ fontSize: '.72rem', padding: '.25rem .65rem' }} onClick={() => openCase(r)}>
                      {t(`${NS}.review`)}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="lx-table-empty-cell">{t(`${NS}.empty`)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail / review modal ─────────────────────────── */}
      <LogisticsModal open={!!selected} title={selected?.reference} onClose={() => { setSelected(null); setDecisions([]); }}>
        {selected && (
          <>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.35rem 1rem', fontSize: '.85rem', marginBottom: '1rem' }}>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dAmount`)}</dt><dd>{fmtMoney(selected.amount_cents)}</dd>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dMethod`)}</dt><dd>{selected.refund_method || '—'}</dd>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dPaymentAttempt`)}</dt><dd><code>{selected.original_payment_attempt_id || '—'}</code></dd>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dReason`)}</dt><dd>{selected.refund_reason}</dd>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dProposer`)}</dt><dd>{selected.proposer_name || '—'}</dd>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dApprover`)}</dt><dd>{selected.approver_name || '—'}</dd>
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dFreshAuthAt`)}</dt><dd>{fmtDate(selected.fresh_auth_at, i18n.language)}</dd>
              {selected.stripe_refund_id && (<><dt style={{ fontWeight: 700 }}>{t(`${NS}.dProcessorRef`)}</dt><dd><code>{selected.stripe_refund_id}</code></dd></>)}
              {selected.processor_ref && (<><dt style={{ fontWeight: 700 }}>{t(`${NS}.dProcessorRef`)}</dt><dd><code>{selected.processor_ref}</code></dd></>)}
              {selected.rejection_reason && (<><dt style={{ fontWeight: 700 }}>{t(`${NS}.dRejectionReason`)}</dt><dd>{selected.rejection_reason}</dd></>)}
              <dt style={{ fontWeight: 700 }}>{t(`${NS}.dStatus`)}</dt>
              <dd><LogisticsStatusPill status={selected.status} label={statusLabel(selected.status)} /></dd>
            </dl>

            {decisions.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '.85rem', marginBottom: '.5rem' }}>{t(`${NS}.dDecisions`)}</h4>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '.8rem' }}>
                  {decisions.map((d) => (
                    <li key={d.id} style={{ padding: '.4rem 0', borderTop: '1px solid var(--color-border)' }}>
                      <strong>{d.action}</strong> · {d.actor_name || t(`${NS}.system`)} · {fmtDate(d.decided_at, i18n.language)}
                      {d.reason && <div style={{ color: 'var(--color-text-muted)' }}>{d.reason}</div>}
                      {d.fresh_auth_ref && <div style={{ color: 'var(--color-text-muted)' }}><code>auth:{String(d.fresh_auth_ref).slice(0, 12)}…</code></div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Self-approval guard: the proposer can never approve their own case. */}
            {selected.status === 'proposed' && isProposer && (
              <div className="lx-alert" role="alert" style={{ marginBottom: '1rem' }}>
                {t(`${NS}.selfApprovalBlocked`)}
              </div>
            )}

            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {selected.status === 'proposed' && !isProposer && (
                <>
                  {!stepUpFresh ? (
                    <button className="lx-btn-primary" disabled={busy} onClick={() => setStepUp({ caseId: selected.id, code: '', verifying: false })}>
                      {t(`${NS}.approveButtonStepup`)}
                    </button>
                  ) : (
                    <button className="lx-btn-primary" disabled={busy} onClick={() => doApprove()}>
                      {t(`${NS}.approveButton`)}
                    </button>
                  )}
                  <button className="lx-btn-secondary" disabled={busy} onClick={() => setRejecting(selected.id)}>
                    {t(`${NS}.rejectButton`)}
                  </button>
                </>
              )}
              {selected.status === 'approved' && (
                <button className="lx-btn-primary" disabled={busy} onClick={doExecute}>
                  {t(`${NS}.executeButton`)}
                </button>
              )}
              {selected.status === 'executing' && (
                <span style={{ fontSize: '.8rem', color: 'var(--color-text-muted)' }}>{t(`${NS}.executingNote`)}</span>
              )}
            </div>
          </>
        )}
      </LogisticsModal>

      {/* ── Propose modal ─────────────────────────────────── */}
      <LogisticsModal open={proposing} title={t(`${NS}.proposeTitle`)} onClose={() => setProposing(false)}>
        <div style={{ display: 'grid', gap: '.75rem' }}>
          <label className="lx-label">{t(`${NS}.fPaymentAttemptId`)}
            <input className="lx-input" value={pForm.payment_attempt_id}
              onChange={(e) => setPForm((f) => ({ ...f, payment_attempt_id: e.target.value }))} />
          </label>
          <p style={{ fontSize: '.78rem', color: 'var(--color-text-muted)', margin: 0 }}>{t(`${NS}.fPaymentAttemptHelp`)}</p>
          <label className="lx-label">{t(`${NS}.fAmountUsd`)}
            <input className="lx-input" type="number" min="0.01" step="0.01" value={pForm.amount_usd}
              onChange={(e) => setPForm((f) => ({ ...f, amount_usd: e.target.value }))} />
          </label>
          <label className="lx-label">{t(`${NS}.fMethod`)}
            <select className="lx-select" value={pForm.refund_method}
              onChange={(e) => setPForm((f) => ({ ...f, refund_method: e.target.value }))}>
              <option value="stripe">{t(`${NS}.method.stripe`)}</option>
              <option value="credit">{t(`${NS}.method.credit`)}</option>
            </select>
          </label>
          <label className="lx-label">{t(`${NS}.fReason`)}
            <textarea className="lx-input" rows={3} maxLength={200} value={pForm.reason}
              onChange={(e) => setPForm((f) => ({ ...f, reason: e.target.value }))} />
          </label>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="lx-btn-secondary" onClick={() => setProposing(false)}>{t(`${NS}.cancel`)}</button>
            <button className="lx-btn-primary" disabled={busy} onClick={doPropose}>{t(`${NS}.submit`)}</button>
          </div>
        </div>
      </LogisticsModal>

      {/* ── Step-up modal (fresh TOTP auth before approve) ── */}
      <LogisticsModal open={!!stepUp} title={t(`${NS}.stepupTitle`)} onClose={() => setStepUp(null)}>
        <p style={{ fontSize: '.85rem' }}>{t(`${NS}.stepupBody`)}</p>
        <label className="lx-label">{t(`${NS}.fCode`)}
          <input className="lx-input" inputMode="numeric" autoComplete="one-time-code"
            value={stepUp?.code || ''} disabled={stepUp?.verifying}
            onChange={(e) => setStepUp((s) => ({ ...s, code: e.target.value }))} />
        </label>
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.75rem' }}>
          <button className="lx-btn-secondary" onClick={() => setStepUp(null)}>{t(`${NS}.cancel`)}</button>
          <button className="lx-btn-primary" disabled={stepUp?.verifying || !stepUp?.code?.trim()} onClick={doVerifyStepUp}>
            {t(`${NS}.verify`)}
          </button>
        </div>
      </LogisticsModal>

      {/* ── Reject modal ──────────────────────────────────── */}
      <LogisticsModal open={!!rejecting} title={t(`${NS}.rejectTitle`)} onClose={() => setRejecting(null)}>
        <label className="lx-label">{t(`${NS}.fRejectReason`)}
          <textarea className="lx-input" rows={3} value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.75rem' }}>
          <button className="lx-btn-secondary" onClick={() => setRejecting(null)}>{t(`${NS}.cancel`)}</button>
          <button className="lx-btn-primary" disabled={busy} onClick={doReject}>{t(`${NS}.rejectConfirm`)}</button>
        </div>
      </LogisticsModal>
    </div>
  );
}
