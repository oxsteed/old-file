import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const STATUS_BADGE = {
  open: 'fr-status-pending',
  in_progress: 'fr-status-pending',
  resolved: 'fr-status-accepted',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3j (648, D-349): training escalation — a training
// issue/gap raised to HQ with the training context attached. The
// escalation rides a training assignment when there is one (member,
// module, and location come from the assignment), otherwise the
// operator names the member + module (+ location). One live escalation
// per training item; HQ resolves it with a resolution note.
export default function FranchiseTrainingEscalations({
  escalations = [],
  assignments = [],
  members = [],
  locations = [],
  canEscalate = false,
  canResolve = false,
  onEscalate = null,
  onResolve = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [assignmentId, setAssignmentId] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [resolutionById, setResolutionById] = useState({});
  const [resolveError, setResolveError] = useState('');

  const locationNameById = new Map((locations || []).map((location) => [location.id, location.name]));
  const assignmentName = (assignment) => {
    const assignee = [assignment.assignee_first_name, assignment.assignee_last_name].filter(Boolean).join(' ')
      || assignment.assignee_email || '';
    return `${assignment.module_title}${assignee ? ` — ${assignee}` : ''}`;
  };

  async function submit(event) {
    event.preventDefault();
    if (!onEscalate || !reason.trim()) return;
    if (!assignmentId && (!memberUserId || !moduleTitle.trim())) return;
    setFormError('');
    try {
      await onEscalate({
        assignment_id: assignmentId || undefined,
        member_user_id: assignmentId ? undefined : memberUserId,
        module_title: assignmentId ? undefined : moduleTitle.trim(),
        location_id: assignmentId ? undefined : (locationId || undefined),
        reason: reason.trim(),
      });
      setAssignmentId('');
      setMemberUserId('');
      setModuleTitle('');
      setLocationId('');
      setReason('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('trainingEscFailed'));
    }
  }

  async function resolve(escalationId, status) {
    if (!onResolve) return;
    setResolveError('');
    try {
      await onResolve(escalationId, {
        status,
        resolution: status === 'resolved' ? (resolutionById[escalationId] || '').trim() : undefined,
      });
      setResolutionById((prev) => ({ ...prev, [escalationId]: '' }));
    } catch (err) {
      setResolveError(err?.response?.data?.error || copy('trainingEscResolveFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <GraduationCap size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('trainingEscTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('trainingEscSubtitle')}</p>
        </div>
      </div>

      {escalations.length === 0 ? (
        <p className="fr-detail-empty">{copy('trainingEscEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {escalations.map((escalation) => (
            <li key={escalation.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{escalation.module_title || copy('trainingEscTitle')}</div>
                <div className="fr-doc-file-meta">
                  {escalation.member_name || '—'}
                  {' · '}
                  {escalation.location_id ? (escalation.location_name || locationNameById.get(escalation.location_id) || '') : copy('exceptionTerritoryWide')}
                  {' · '}
                  {escalation.reason}
                </div>
                <div className="fr-doc-file-meta">
                  {copy('trainingEscBy', { name: escalation.escalated_by_name || '—' })}
                  {' · '}
                  {formatDate(escalation.created_at)}
                  {escalation.status === 'resolved' && escalation.resolution && (
                    <>
                      {' · '}
                      {copy('trainingEscResolvedBy', { resolution: escalation.resolution })}
                    </>
                  )}
                </div>
                {canResolve && onResolve && escalation.status !== 'resolved' && (
                  <div className="fr-doc-list">
                    <div>
                      <label className="fr-detail-list-label" htmlFor={`training-esc-resolution-${escalation.id}`}>
                        {copy('trainingEscResolutionLabel')}
                      </label>
                      <input
                        id={`training-esc-resolution-${escalation.id}`}
                        className="fr-followup-input"
                        value={resolutionById[escalation.id] || ''}
                        disabled={busy}
                        onChange={(event) => setResolutionById((prev) => ({ ...prev, [escalation.id]: event.target.value }))}
                        placeholder={copy('trainingEscResolutionPlaceholder')}
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        className="fr-btn-ghost"
                        disabled={busy}
                        onClick={() => resolve(escalation.id, 'in_progress')}
                      >
                        {copy('trainingEscStart')}
                      </button>
                      <button
                        type="button"
                        className="fr-btn-primary"
                        disabled={busy || !(resolutionById[escalation.id] || '').trim()}
                        onClick={() => resolve(escalation.id, 'resolved')}
                      >
                        {copy('trainingEscResolve')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <span className={`fr-status-badge ${STATUS_BADGE[escalation.status] || 'fr-status-pending'}`}>
                {copy(`trainingEscStatus_${escalation.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {resolveError && <p className="fr-detail-error">{resolveError}</p>}

      {canEscalate && onEscalate && (
        <form onSubmit={submit} className="fr-doc-list">
          <div>
            <label className="fr-detail-list-label" htmlFor="training-esc-assignment">
              {copy('trainingEscAssignmentLabel')}
            </label>
            <select
              id="training-esc-assignment"
              className="fr-followup-input"
              value={assignmentId}
              disabled={busy}
              onChange={(event) => setAssignmentId(event.target.value)}
            >
              <option value="">{copy('trainingEscAssignmentNone')}</option>
              {(assignments || []).map((assignment) => (
                <option key={assignment.id} value={assignment.id}>{assignmentName(assignment)}</option>
              ))}
            </select>
          </div>
          {!assignmentId && (
            <>
              <div>
                <label className="fr-detail-list-label" htmlFor="training-esc-member">
                  {copy('trainingEscMemberLabel')}
                </label>
                <select
                  id="training-esc-member"
                  className="fr-followup-input"
                  value={memberUserId}
                  disabled={busy}
                  onChange={(event) => setMemberUserId(event.target.value)}
                >
                  <option value="">{copy('trainingEscMemberChoose')}</option>
                  {(members || []).map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.name}{member.email && member.name !== member.email ? ` (${member.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="fr-detail-list-label" htmlFor="training-esc-module">
                  {copy('trainingEscModuleLabel')}
                </label>
                <input
                  id="training-esc-module"
                  className="fr-followup-input"
                  value={moduleTitle}
                  disabled={busy}
                  onChange={(event) => setModuleTitle(event.target.value)}
                  placeholder={copy('trainingEscModulePlaceholder')}
                />
              </div>
              <div>
                <label className="fr-detail-list-label" htmlFor="training-esc-location">
                  {copy('trainingEscLocationLabel')}
                </label>
                <select
                  id="training-esc-location"
                  className="fr-followup-input"
                  value={locationId}
                  disabled={busy}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  <option value="">{copy('exceptionTerritoryWide')}</option>
                  {(locations || []).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="fr-detail-list-label" htmlFor="training-esc-reason">
              {copy('trainingEscReasonLabel')}
            </label>
            <textarea
              id="training-esc-reason"
              className="fr-followup-input"
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy('trainingEscReasonPlaceholder')}
              rows={3}
            />
          </div>
          <div>
            <button
              type="submit"
              className="fr-btn-primary"
              disabled={busy || !reason.trim() || (!assignmentId && (!memberUserId || !moduleTitle.trim()))}
            >
              {copy('trainingEscSubmit')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
    </section>
  );
}
