import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';

const STATUS_KEYS = {
  assigned: 'trainingTasksStatusAssigned',
  in_progress: 'trainingTasksStatusInProgress',
  completed: 'trainingTasksStatusCompleted',
};
const STATUS_BADGE = {
  assigned: 'fr-status-pending',
  in_progress: 'fr-status-pending',
  completed: 'fr-status-accepted',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Group 12 Slice 3d (618, D-317): territory-scoped training task
// distribution — assign training modules/tasks to territory members by
// location or territory-wide, track completion per person. The module
// catalogue is the existing restaurant training modules; the assignment
// state lives on the territory, not on a restaurant.
export default function FranchiseTrainingTasks({
  assignments = [],
  members = [],
  locations = [],
  canAssign = false,
  canComplete = false,
  onAssign = null,
  onComplete = null,
  onRemove = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [assigneeId, setAssigneeId] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [locationId, setLocationId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState('');

  const locationNameById = new Map((locations || []).map((location) => [location.id, location.name]));

  async function submit(event) {
    event.preventDefault();
    if (!onAssign) return;
    setFormError('');
    try {
      await onAssign({
        assignee_user_id: assigneeId,
        module_title: moduleTitle.trim(),
        location_id: locationId || undefined,
        due_date: dueDate || undefined,
      });
      setAssigneeId('');
      setModuleTitle('');
      setLocationId('');
      setDueDate('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('trainingTasksAssignFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <GraduationCap size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('trainingTasksTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('trainingTasksSubtitle')}</p>
        </div>
      </div>

      {canAssign && onAssign && (
        <form onSubmit={submit} className="fr-doc-list">
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-training-assignee">{copy('trainingTasksAssigneeLabel')}</label>
            <select
              id="fr-training-assignee"
              className="fr-followup-input"
              value={assigneeId}
              disabled={disabled}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">{copy('trainingTasksAssigneeChoose')}</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.name}{member.email && member.name !== member.email ? ` (${member.email})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-training-module">{copy('trainingTasksModuleLabel')}</label>
            <input
              id="fr-training-module"
              type="text"
              required
              className="fr-followup-input"
              value={moduleTitle}
              disabled={disabled}
              onChange={(event) => setModuleTitle(event.target.value)}
              placeholder={copy('trainingTasksModulePlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-training-location">{copy('trainingTasksLocationLabel')}</label>
            <select
              id="fr-training-location"
              className="fr-followup-input"
              value={locationId}
              disabled={disabled}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">{copy('trainingTasksLocationTerritory')}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-training-due">{copy('trainingTasksDueLabel')}</label>
            <input
              id="fr-training-due"
              type="date"
              className="fr-followup-input"
              value={dueDate}
              disabled={disabled}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          {formError && <p className="fr-detail-empty">{formError}</p>}
          <div>
            <button type="submit" className="fr-btn-primary" disabled={disabled || !assigneeId || !moduleTitle.trim()}>
              {copy('trainingTasksAssign')}
            </button>
          </div>
        </form>
      )}

      {assignments.length === 0 ? (
        <p className="fr-detail-empty">{copy('trainingTasksEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {assignments.map((assignment) => {
            const assigneeName = [assignment.assignee_first_name, assignment.assignee_last_name].filter(Boolean).join(' ')
              || assignment.assignee_email || '';
            return (
              <li key={assignment.id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{assignment.module_title}</div>
                  <div className="fr-doc-file-meta">
                    {assigneeName}
                    {' · '}
                    {assignment.location_id ? (locationNameById.get(assignment.location_id) || '') : copy('trainingTasksTerritoryWide')}
                    {assignment.due_date && (
                      <>
                        {' · '}
                        {copy('trainingTasksDue', { date: formatDate(assignment.due_date) })}
                      </>
                    )}
                    {assignment.status === 'completed' && assignment.completed_at && (
                      <>
                        {' · '}
                        {copy('trainingTasksCompletedOn', { date: formatDate(assignment.completed_at) })}
                      </>
                    )}
                  </div>
                </div>
                <span className={`fr-status-badge ${STATUS_BADGE[assignment.status] || 'fr-status-pending'}`}>
                  {copy(STATUS_KEYS[assignment.status] || 'trainingTasksStatusAssigned')}
                </span>
                {canComplete && onComplete && assignment.status !== 'completed' && (
                  <button
                    type="button"
                    className="fr-btn-primary"
                    disabled={disabled}
                    onClick={() => onComplete(assignment.id)}
                  >
                    {copy('trainingTasksComplete')}
                  </button>
                )}
                {canAssign && onRemove && (
                  <button
                    type="button"
                    className="fr-btn-primary"
                    disabled={disabled}
                    onClick={() => onRemove(assignment.id)}
                  >
                    {copy('trainingTasksRemove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
