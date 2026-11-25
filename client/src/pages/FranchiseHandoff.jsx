import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3i (641/642/644, D-341/D-342/D-344): operator handoff —
// the outgoing operator initiates a handoff to a named incoming operator
// (a team member, or anyone by email), HQ approves or rejects it, and
// only approval moves anything: open issues transfer, records change
// hands by access, and the outgoing operator's access is revoked. The
// checklist is derived from live state, so what HQ sees here is always
// current; the snapshot stored at approval rides the approved row.
export default function FranchiseHandoff({
  handoffs = null,
  members = [],
  canInitiate = false,
  canReview = false,
  onInitiate = null,
  onCancel = null,
  onReview = null,
  onLoadTransfers = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [memberId, setMemberId] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [rejectReason, setRejectReason] = useState({});
  const [transfers, setTransfers] = useState({});
  const [transfersError, setTransfersError] = useState('');

  const list = handoffs?.handoffs || [];
  const checklist = handoffs?.checklist || null;
  const hasPending = list.some((handoff) => handoff.status === 'pending');
  const unlisted = (members || []).filter((member) => member.kind !== 'operator');

  async function submit(event) {
    event.preventDefault();
    if (!onInitiate) return;
    setFormError('');
    const body = { reason: reason.trim() || undefined };
    if (memberId) body.incoming_operator_id = memberId;
    else if (email.trim()) body.incoming_operator_email = email.trim();
    else {
      setFormError(copy('handoffInitiateFailed'));
      return;
    }
    try {
      await onInitiate(body);
      setMemberId('');
      setEmail('');
      setReason('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('handoffInitiateFailed'));
    }
  }

  async function cancel(handoff) {
    if (!onCancel) return;
    setFormError('');
    try {
      await onCancel(handoff.id);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('handoffCancelFailed'));
    }
  }

  async function review(handoff, decision) {
    if (!onReview) return;
    setFormError('');
    const decisionReason = decision === 'reject' ? (rejectReason[handoff.id] || '').trim() : (rejectReason[handoff.id] || '').trim() || undefined;
    if (decision === 'reject' && !decisionReason) {
      setFormError(copy('handoffRejectReasonLabel'));
      return;
    }
    try {
      await onReview(handoff.id, { decision, reason: decisionReason });
      setRejectReason((prev) => ({ ...prev, [handoff.id]: '' }));
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('handoffReviewFailed'));
    }
  }

  async function loadTransfers(handoff) {
    if (!onLoadTransfers) return;
    setTransfersError('');
    try {
      const rows = await onLoadTransfers(handoff.id);
      setTransfers((prev) => ({ ...prev, [handoff.id]: rows }));
    } catch {
      setTransfersError(copy('handoffReviewFailed'));
    }
  }

  function checklistItem(item) {
    const detail = [];
    if (item.code === 'open_exceptions' && item.open_urgent_count) {
      detail.push(copy('handoffUrgent', { count: item.open_urgent_count }));
    }
    if (item.code === 'open_corrective_actions' && item.awaiting_verification) {
      detail.push(copy('handoffAwaitingVerification', { count: item.awaiting_verification }));
    }
    return (
      <li key={item.code} className="fr-doc-file">
        <div>
          <div className="fr-doc-file-name">{copy(`handoffItem_${item.code}`)}</div>
          {detail.length > 0 && <div className="fr-doc-file-meta">{detail.join(' · ')}</div>}
        </div>
        <span className="fr-status-badge fr-status-pending">{item.count}</span>
      </li>
    );
  }

  function recordsList(snapshot) {
    if (!snapshot) return null;
    const rows = [
      ['handoffRecordsDocuments', snapshot.documents],
      ['handoffRecordsAcknowledgments', snapshot.standard_acknowledgments],
      ['handoffRecordsTraining', snapshot.training_assignments],
      ['handoffRecordsExceptions', snapshot.exceptions],
      ['handoffRecordsNotes', snapshot.expansion_notes],
      ['handoffRecordsActivity', snapshot.activity_entries],
    ];
    return (
      <div>
        <p className="fr-detail-list-label">{copy('handoffRecordsTitle')}</p>
        <ul className="fr-doc-files">
          {rows.map(([key, value]) => (
            <li key={key} className="fr-doc-file">
              <div className="fr-doc-file-name">{copy(key)}</div>
              <span className="fr-status-badge fr-status-pending">{value ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <ArrowRightLeft size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('handoffTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('handoffSubtitle')}</p>
        </div>
      </div>

      {checklist && (
        <div>
          <p className="fr-detail-list-label">{copy('handoffChecklistTitle')}</p>
          {checklist.open_count === 0 ? (
            <p className="fr-detail-empty">{copy('handoffChecklistEmpty')}</p>
          ) : (
            <ul className="fr-doc-files">{checklist.items.map(checklistItem)}</ul>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p className="fr-detail-empty">{copy('handoffEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {list.map((handoff) => (
            <li key={handoff.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">
                  {copy('handoffFromTo', { from: handoff.outgoing_operator_name || '—', to: handoff.incoming_operator_name || '—' })}
                </div>
                <div className="fr-doc-file-meta">
                  {copy(`handoffStatus_${handoff.status}`)}
                  {' · '}
                  {formatDate(handoff.created_at)}
                  {handoff.reason ? ` · ${handoff.reason}` : ''}
                </div>
                {handoff.decided_by_name && (
                  <div className="fr-doc-file-meta">
                    {copy('handoffDecidedBy', { name: handoff.decided_by_name })}
                    {handoff.decision_reason ? ` · ${handoff.decision_reason}` : ''}
                  </div>
                )}
                {handoff.status === 'approved' && recordsList(handoff.records_snapshot)}
                {handoff.status === 'approved' && (
                  <div>
                    <p className="fr-detail-list-label">{copy('handoffTransfersTitle')}</p>
                    {transfers[handoff.id] ? (
                      transfers[handoff.id].length === 0 ? (
                        <p className="fr-detail-empty">{copy('handoffTransfersEmpty')}</p>
                      ) : (
                        <ul className="fr-doc-files">
                          {transfers[handoff.id].map((transfer) => (
                            <li key={transfer.id} className="fr-doc-file">
                              <div>
                                <div className="fr-doc-file-name">
                                  {copy(`handoffTransferKind_${transfer.kind}`)}
                                  {transfer.ticket_number ? ` #${transfer.ticket_number}` : ''}
                                </div>
                                <div className="fr-doc-file-meta">
                                  {transfer.from_name || '—'} → {transfer.to_name || '—'}
                                  {transfer.due_date ? ` · ${formatDate(transfer.due_date)}` : ''}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : (
                      <button
                        type="button"
                        className="fr-btn-ghost"
                        disabled={busy}
                        onClick={() => loadTransfers(handoff)}
                        data-track="ui.78c9fd95e3.6"
                      >
                        {copy('handoffTransfersTitle')}
                      </button>
                    )}
                  </div>
                )}
                <div className="fr-doc-file-meta">
                  {handoff.status === 'pending' && (canInitiate || canReview) && (
                    <button
                      type="button"
                      className="fr-btn-ghost"
                      disabled={busy}
                      onClick={() => cancel(handoff)}
                      data-track="ui.78c9fd95e3.3"
                    >
                      {copy('handoffCancel')}
                    </button>
                  )}
                  {handoff.status === 'pending' && canReview && (
                    <>
                      <button
                        type="button"
                        className="fr-btn-primary"
                        disabled={busy}
                        onClick={() => review(handoff, 'approve')}
                        data-track="ui.78c9fd95e3.4"
                      >
                        {copy('handoffApprove')}
                      </button>
                      <button
                        type="button"
                        className="fr-btn-ghost"
                        disabled={busy}
                        onClick={() => review(handoff, 'reject')}
                        data-track="ui.78c9fd95e3.5"
                      >
                        {copy('handoffReject')}
                      </button>
                    </>
                  )}
                </div>
                {handoff.status === 'pending' && canReview && (
                  <div>
                    <label className="fr-detail-list-label" htmlFor={`handoff-reject-${handoff.id}`}>
                      {copy('handoffRejectReasonLabel')}
                    </label>
                    <input
                      id={`handoff-reject-${handoff.id}`}
                      className="fr-followup-input"
                      value={rejectReason[handoff.id] || ''}
                      onChange={(event) => setRejectReason((prev) => ({ ...prev, [handoff.id]: event.target.value }))}
                    />
                  </div>
                )}
              </div>
              <span className="fr-status-badge fr-status-pending">{copy(`handoffStatus_${handoff.status}`)}</span>
            </li>
          ))}
        </ul>
      )}

      {canInitiate && onInitiate && !hasPending && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.78c9fd95e3.1">
          <div>
            <p className="fr-detail-list-label">{copy('handoffInitiateTitle')}</p>
            <label className="fr-detail-list-label" htmlFor="handoff-incoming-member">
              {copy('handoffIncomingLabel')}
            </label>
            <select
              id="handoff-incoming-member"
              className="fr-followup-input"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">{copy('handoffIncomingNone')}</option>
              {unlisted.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.name} · {member.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="handoff-incoming-email">
              {copy('handoffIncomingEmailLabel')}
            </label>
            <input
              id="handoff-incoming-email"
              className="fr-followup-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={copy('handoffIncomingEmailPlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="handoff-reason">
              {copy('handoffReasonLabel')}
            </label>
            <input
              id="handoff-reason"
              className="fr-followup-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy('handoffReasonPlaceholder')}
            />
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || (!memberId && !email.trim())} data-track="ui.78c9fd95e3.2">
              {copy('handoffInitiate')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
      {formError && !canInitiate && <p className="fr-detail-error">{formError}</p>}
      {transfersError && <p className="fr-detail-error">{transfersError}</p>}
    </section>
  );
}
