import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const STATE_BADGE = {
  open: 'fr-status-rejected',
  awaiting_verification: 'fr-status-pending',
  resolved: 'fr-status-accepted',
};

const ACTION_BADGE = {
  open: 'fr-status-pending',
  in_progress: 'fr-status-pending',
  resolved: 'fr-status-pending',
  verified: 'fr-status-accepted',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3g (632-635, D-332/D-333/D-334/D-335): resolve
// exceptions — per linked exception: the remediation assignment, the
// corrective-action checklist with its status workflow, file evidence
// on each action, and the HQ resolution review. The resolution state
// rides the bundle (derived, never stored); the lists below are the
// working surface on top of it.
export default function FranchiseExceptionResolution({
  resolution = null,
  correctiveActions = [],
  members = [],
  canAssign = false,
  canCreateAction = false,
  canUpdateAction = false,
  canUploadEvidence = false,
  canReview = false,
  onAssignRemediation = null,
  onCreateAction = null,
  onUpdateActionStatus = null,
  onUploadEvidence = null,
  onLoadEvidence = null,
  onReview = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [assignForm, setAssignForm] = useState({});
  const [newAction, setNewAction] = useState({});
  const [reviewReason, setReviewReason] = useState({});
  const [evidenceByAction, setEvidenceByAction] = useState({});
  const [evidenceOpen, setEvidenceOpen] = useState({});
  const [evidenceFile, setEvidenceFile] = useState({});
  const [evidenceNote, setEvidenceNote] = useState({});
  const [formError, setFormError] = useState('');
  const [formScope, setFormScope] = useState('');

  const items = resolution?.items || [];
  const actionsByTicket = new Map();
  (correctiveActions || []).forEach((action) => {
    if (!actionsByTicket.has(action.ticket_id)) actionsByTicket.set(action.ticket_id, []);
    actionsByTicket.get(action.ticket_id).push(action);
  });

  function setAssign(ticketId, patch) {
    setAssignForm((prev) => ({ ...prev, [ticketId]: { ...(prev[ticketId] || {}), ...patch } }));
  }

  function setNew(ticketId, patch) {
    setNewAction((prev) => ({ ...prev, [ticketId]: { ...(prev[ticketId] || {}), ...patch } }));
  }

  async function submitAssign(event, ticketId) {
    event.preventDefault();
    const form = assignForm[ticketId] || {};
    if (!onAssignRemediation || !form.owner_user_id || !form.due_date) return;
    setFormError('');
    setFormScope(`assign-${ticketId}`);
    try {
      await onAssignRemediation(ticketId, { owner_user_id: form.owner_user_id, due_date: form.due_date });
      setAssignForm((prev) => ({ ...prev, [ticketId]: { owner_user_id: '', due_date: '' } }));
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('remediationFailed'));
    }
  }

  async function submitAction(event, ticketId) {
    event.preventDefault();
    const form = newAction[ticketId] || {};
    if (!onCreateAction || !form.title?.trim()) return;
    setFormError('');
    setFormScope(`action-${ticketId}`);
    try {
      await onCreateAction(ticketId, { title: form.title.trim(), description: form.description?.trim() || undefined });
      setNewAction((prev) => ({ ...prev, [ticketId]: { title: '', description: '' } }));
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('actionAddFailed'));
    }
  }

  async function moveAction(actionId, status) {
    if (!onUpdateActionStatus) return;
    setFormError('');
    setFormScope(`move-${actionId}`);
    try {
      await onUpdateActionStatus(actionId, status);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('actionUpdateFailed'));
    }
  }

  async function submitReview(actionId, decision) {
    if (!onReview) return;
    const reason = (reviewReason[actionId] || '').trim();
    if (decision === 'reject' && !reason) {
      setFormError(copy('actionReviewReasonRequired'));
      setFormScope(`review-${actionId}`);
      return;
    }
    setFormError('');
    setFormScope(`review-${actionId}`);
    try {
      await onReview(actionId, { decision, reason: reason || undefined });
      setReviewReason((prev) => ({ ...prev, [actionId]: '' }));
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('actionReviewFailed'));
    }
  }

  async function toggleEvidence(actionId) {
    const open = !evidenceOpen[actionId];
    setEvidenceOpen((prev) => ({ ...prev, [actionId]: open }));
    if (open && onLoadEvidence && !evidenceByAction[actionId]) {
      try {
        const evidence = await onLoadEvidence(actionId);
        setEvidenceByAction((prev) => ({ ...prev, [actionId]: evidence || [] }));
      } catch {
        setEvidenceByAction((prev) => ({ ...prev, [actionId]: [] }));
      }
    }
  }

  async function submitEvidence(event, actionId) {
    event.preventDefault();
    const file = evidenceFile[actionId];
    if (!onUploadEvidence || !file) return;
    setFormError('');
    setFormScope(`evidence-${actionId}`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const note = (evidenceNote[actionId] || '').trim();
      if (note) formData.append('note', note);
      await onUploadEvidence(actionId, formData);
      setEvidenceFile((prev) => ({ ...prev, [actionId]: null }));
      setEvidenceNote((prev) => ({ ...prev, [actionId]: '' }));
      if (onLoadEvidence) {
        const evidence = await onLoadEvidence(actionId);
        setEvidenceByAction((prev) => ({ ...prev, [actionId]: evidence || [] }));
      }
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('evidenceUploadFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <CheckCircle2 size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('resolutionTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('resolutionSubtitle')}</p>
        </div>
      </div>

      {!resolution || resolution.total === 0 ? (
        <p className="fr-detail-empty">{copy('resolutionEmpty')}</p>
      ) : (
        <>
          <ul className="fr-doc-files">
            <li className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{copy('resolutionOpen', { count: resolution.open ?? 0 })}</div>
                <div className="fr-doc-file-meta">
                  {copy('resolutionAwaiting', { count: resolution.awaiting_verification ?? 0 })}
                  {' · '}
                  {copy('resolutionResolved', { count: resolution.resolved ?? 0 })}
                </div>
              </div>
            </li>
          </ul>

          {items.map((item) => {
            const ticketActions = actionsByTicket.get(item.ticket_id) || [];
            const assign = assignForm[item.ticket_id] || {};
            const draft = newAction[item.ticket_id] || {};
            return (
              <div key={item.ticket_id} className="fr-doc-list">
                <div className="fr-doc-file">
                  <div>
                    <div className="fr-doc-file-name">
                      #{item.ticket_number} — {item.subject}
                    </div>
                    <div className="fr-doc-file-meta">
                      {item.location_name || copy('exceptionTerritoryWide')}
                      {' · '}
                      {item.status}
                      {' · '}
                      {item.priority}
                    </div>
                    <div className="fr-doc-file-meta">
                      <Link to={`/support/my-tickets/${item.ticket_id}`} className="fr-btn-ghost">
                        {copy('exceptionViewTicket')}
                      </Link>
                    </div>
                  </div>
                  <span className={`fr-status-badge ${STATE_BADGE[item.exception_state] || 'fr-status-pending'}`}>
                    {copy(`resolutionState_${item.exception_state}`)}
                  </span>
                </div>

                {item.remediation ? (
                  <p className="fr-doc-file-meta">
                    {copy('remediationAssigned', { name: item.remediation.owner_name || '—', date: formatDate(item.remediation.due_date) })}
                  </p>
                ) : (
                  <p className="fr-doc-file-meta">{copy('remediationNone')}</p>
                )}

                {canAssign && onAssignRemediation && (
                  <form onSubmit={(event) => submitAssign(event, item.ticket_id)} className="fr-doc-list" data-track="ui.4c732161d6.1">
                    <div>
                      <label className="fr-detail-list-label" htmlFor={`remediation-owner-${item.ticket_id}`}>
                        {copy('remediationOwnerLabel')}
                      </label>
                      <select
                        id={`remediation-owner-${item.ticket_id}`}
                        className="fr-followup-input"
                        value={assign.owner_user_id || item.remediation?.owner_user_id || ''}
                        disabled={busy}
                        onChange={(event) => setAssign(item.ticket_id, { owner_user_id: event.target.value })}
                      >
                        <option value="">{copy('remediationOwnerChoose')}</option>
                        {(members || []).map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.name}{member.email && member.name !== member.email ? ` (${member.email})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="fr-detail-list-label" htmlFor={`remediation-due-${item.ticket_id}`}>
                        {copy('remediationDueLabel')}
                      </label>
                      <input
                        id={`remediation-due-${item.ticket_id}`}
                        type="date"
                        className="fr-followup-input"
                        value={assign.due_date || (item.remediation?.due_date ? String(item.remediation.due_date).slice(0, 10) : '')}
                        disabled={busy}
                        onChange={(event) => setAssign(item.ticket_id, { due_date: event.target.value })}
                      />
                    </div>
                    <div>
                      <button
                        type="submit"
                        className="fr-btn-primary"
                        disabled={busy || !(assign.owner_user_id || item.remediation?.owner_user_id) || !(assign.due_date || item.remediation?.due_date)} data-track="ui.4c732161d6.2"
                      >
                        {copy('remediationAssign')}
                      </button>
                    </div>
                    {formScope === `assign-${item.ticket_id}` && formError && (
                      <p className="fr-detail-error">{formError}</p>
                    )}
                  </form>
                )}

                <div className="fr-detail-list-label">{copy('actionTitle')}</div>
                {ticketActions.length === 0 ? (
                  <p className="fr-detail-empty">{copy('actionEmpty')}</p>
                ) : (
                  <ul className="fr-doc-files">
                    {ticketActions.map((action) => (
                      <li key={action.id} className="fr-doc-file">
                        <div>
                          <div className="fr-doc-file-name">{action.title}</div>
                          {action.description && (
                            <div className="fr-doc-file-meta">{action.description}</div>
                          )}
                          <div className="fr-doc-file-meta">
                            {action.remediation_owner_name || copy('remediationNone')}
                            {action.remediation_due_date && (
                              <>
                                {' · '}
                                {formatDate(action.remediation_due_date)}
                              </>
                            )}
                            {action.evidence_count > 0 && (
                              <>
                                {' · '}
                                {copy('evidenceCount', { count: action.evidence_count })}
                              </>
                            )}
                            {action.review_reason && (
                              <>
                                {' · '}
                                {copy('actionReviewedBy', { reason: action.review_reason })}
                              </>
                            )}
                          </div>
                          {canUpdateAction && onUpdateActionStatus && action.status === 'open' && (
                            <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => moveAction(action.id, 'in_progress')} data-track="ui.4c732161d6.3">
                              {copy('actionStart')}
                            </button>
                          )}
                          {canUpdateAction && onUpdateActionStatus && action.status === 'in_progress' && (
                            <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => moveAction(action.id, 'resolved')} data-track="ui.4c732161d6.4">
                              {copy('actionResolve')}
                            </button>
                          )}
                          {formScope === `move-${action.id}` && formError && (
                            <p className="fr-detail-error">{formError}</p>
                          )}
                          {canReview && onReview && action.status === 'resolved' && (
                            <div className="fr-doc-list">
                              <div>
                                <label className="fr-detail-list-label" htmlFor={`review-reason-${action.id}`}>
                                  {copy('actionReviewReason')}
                                </label>
                                <input
                                  id={`review-reason-${action.id}`}
                                  className="fr-followup-input"
                                  value={reviewReason[action.id] || ''}
                                  disabled={busy}
                                  onChange={(event) => setReviewReason((prev) => ({ ...prev, [action.id]: event.target.value }))}
                                  placeholder={copy('actionReviewReasonPlaceholder')}
                                />
                              </div>
                              <div>
                                <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => submitReview(action.id, 'accept')} data-track="ui.4c732161d6.5">
                                  {copy('actionAccept')}
                                </button>
                                {' '}
                                <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => submitReview(action.id, 'reject')} data-track="ui.4c732161d6.6">
                                  {copy('actionReject')}
                                </button>
                              </div>
                              {formScope === `review-${action.id}` && formError && (
                                <p className="fr-detail-error">{formError}</p>
                              )}
                            </div>
                          )}
                          <div className="fr-doc-list">
                            <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => toggleEvidence(action.id)} data-track="ui.4c732161d6.7">
                              {copy(evidenceOpen[action.id] ? 'evidenceHide' : 'evidenceShow')}
                            </button>
                            {evidenceOpen[action.id] && (
                              <>
                                {(evidenceByAction[action.id] || []).length === 0 ? (
                                  <p className="fr-detail-empty">{copy('evidenceEmpty')}</p>
                                ) : (
                                  <ul className="fr-doc-files">
                                    {(evidenceByAction[action.id] || []).map((evidence) => (
                                      <li key={evidence.id} className="fr-doc-file">
                                        <div>
                                          <div className="fr-doc-file-name">{evidence.file_name || copy('evidenceTitle')}</div>
                                          <div className="fr-doc-file-meta">
                                            {evidence.note || ''}
                                            {evidence.note && evidence.uploaded_by_name ? ' · ' : ''}
                                            {evidence.uploaded_by_name
                                              ? copy('evidenceBy', { name: evidence.uploaded_by_name })
                                              : ''}
                                            {' · '}
                                            {formatDate(evidence.created_at)}
                                          </div>
                                        </div>
                                        {evidence.download_url && (
                                          <a className="fr-btn-ghost" href={evidence.download_url} target="_blank" rel="noreferrer" data-track="ui.4c732161d6.8">
                                            {copy('evidenceDownload')}
                                          </a>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {canUploadEvidence && onUploadEvidence && (
                                  <form onSubmit={(event) => submitEvidence(event, action.id)} className="fr-doc-list" data-track="ui.4c732161d6.9">
                                    <div>
                                      <label className="fr-detail-list-label" htmlFor={`evidence-file-${action.id}`}>
                                        {copy('evidenceChooseFile')}
                                      </label>
                                      <input
                                        id={`evidence-file-${action.id}`}
                                        type="file"
                                        className="fr-followup-input"
                                        disabled={busy}
                                        onChange={(event) => setEvidenceFile((prev) => ({ ...prev, [action.id]: event.target.files?.[0] || null }))}
                                      />
                                    </div>
                                    <div>
                                      <label className="fr-detail-list-label" htmlFor={`evidence-note-${action.id}`}>
                                        {copy('evidenceNoteLabel')}
                                      </label>
                                      <input
                                        id={`evidence-note-${action.id}`}
                                        className="fr-followup-input"
                                        value={evidenceNote[action.id] || ''}
                                        disabled={busy}
                                        onChange={(event) => setEvidenceNote((prev) => ({ ...prev, [action.id]: event.target.value }))}
                                        placeholder={copy('evidenceNotePlaceholder')}
                                      />
                                    </div>
                                    <div>
                                      <button type="submit" className="fr-btn-primary" disabled={busy || !evidenceFile[action.id]} data-track="ui.4c732161d6.10">
                                        {copy('evidenceUpload')}
                                      </button>
                                    </div>
                                    {formScope === `evidence-${action.id}` && formError && (
                                      <p className="fr-detail-error">{formError}</p>
                                    )}
                                  </form>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <span className={`fr-status-badge ${ACTION_BADGE[action.status] || 'fr-status-pending'}`}>
                          {copy(`actionStatus_${action.status}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {canCreateAction && onCreateAction && (
                  <form onSubmit={(event) => submitAction(event, item.ticket_id)} className="fr-doc-list" data-track="ui.4c732161d6.11">
                    <div>
                      <label className="fr-detail-list-label" htmlFor={`action-title-${item.ticket_id}`}>
                        {copy('actionTitleLabel')}
                      </label>
                      <input
                        id={`action-title-${item.ticket_id}`}
                        className="fr-followup-input"
                        value={draft.title || ''}
                        disabled={busy}
                        onChange={(event) => setNew(item.ticket_id, { title: event.target.value })}
                        placeholder={copy('actionTitlePlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="fr-detail-list-label" htmlFor={`action-description-${item.ticket_id}`}>
                        {copy('actionDescriptionLabel')}
                      </label>
                      <input
                        id={`action-description-${item.ticket_id}`}
                        className="fr-followup-input"
                        value={draft.description || ''}
                        disabled={busy}
                        onChange={(event) => setNew(item.ticket_id, { description: event.target.value })}
                      />
                    </div>
                    <div>
                      <button type="submit" className="fr-btn-primary" disabled={busy || !draft.title?.trim()} data-track="ui.4c732161d6.12">
                        {copy('actionAdd')}
                      </button>
                    </div>
                    {formScope === `action-${item.ticket_id}` && formError && (
                      <p className="fr-detail-error">{formError}</p>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
