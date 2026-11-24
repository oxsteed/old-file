import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const MILESTONE_STATUS_KEYS = {
  pending: 'launchPlanStatusPending',
  in_progress: 'launchPlanStatusInProgress',
  completed: 'launchPlanStatusCompleted',
  blocked: 'launchPlanStatusBlocked',
};
const OWNER_KEYS = {
  operator: 'launchPlanOwnerOperator',
  hq: 'launchPlanOwnerHq',
  shared: 'launchPlanOwnerShared',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Group 12 Slice 3c (611, D-311): the open locations — every location
// inside the territory with its launch milestones. HQ creates locations
// and milestones; the operator updates milestone status only (mirroring
// the 609 launch plan). Later slices in this cluster add the opening
// team (612), readiness reviews (613), service availability and the
// location launch (614), and the opening confirmation (615) to the same
// per-location card.
export default function FranchiseOpenLocations({
  locations = [],
  launchPlanSteps = [],
  onMilestoneStatusChange = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const linkedStepByMilestone = new Map(
    (launchPlanSteps || [])
      .filter((step) => step.milestone_id)
      .map((step) => [step.milestone_id, step]),
  );

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <MapPin size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('openLocationsTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('openLocationsSubtitle')}</p>
        </div>
      </div>

      {locations.length === 0 ? (
        <p className="fr-detail-empty">{copy('openLocationsEmpty')}</p>
      ) : (
        <div className="fr-doc-list">
          {locations.map((location) => {
            const milestones = location.milestones || [];
            const place = [location.city, location.region, location.country].filter(Boolean).join(', ');
            return (
              <div key={location.id} className="fr-doc-category">
                <div className="fr-doc-category-head">
                  <div>
                    <div className="fr-doc-category-name">{location.name}</div>
                    {place && <div className="fr-doc-file-meta">{place}</div>}
                  </div>
                  <span className={`fr-status-badge ${location.status === 'launched' ? 'fr-status-accepted' : 'fr-status-pending'}`}>
                    {location.status === 'launched' ? copy('locationLaunched') : copy('locationPlanned')}
                  </span>
                </div>

                {milestones.length === 0 ? (
                  <p className="fr-detail-empty">{copy('milestoneEmpty')}</p>
                ) : (
                  <ul className="fr-doc-files">
                    {milestones.map((milestone) => {
                      const linkedStep = linkedStepByMilestone.get(milestone.id);
                      return (
                        <li key={milestone.id} className="fr-doc-file">
                          <div>
                            <div className="fr-doc-file-name">{milestone.title}</div>
                            {milestone.description && (
                              <div className="fr-doc-file-meta">{milestone.description}</div>
                            )}
                            <div className="fr-doc-file-meta">
                              {copy('milestoneDue')}: {milestone.due_date ? formatDate(milestone.due_date) : copy('milestoneNoDue')}
                              {' · '}
                              {copy('milestoneOwner')}: {copy(OWNER_KEYS[milestone.owner_role] || 'launchPlanOwnerOperator')}
                              {linkedStep && (
                                <>
                                  {' · '}
                                  {copy('milestoneLinkedStep')}: {linkedStep.title}
                                </>
                              )}
                            </div>
                            {milestone.status === 'completed' && milestone.completed_at && (
                              <div className="fr-doc-file-meta">{formatDateTime(milestone.completed_at)}</div>
                            )}
                          </div>
                          <span className={`fr-status-badge ${milestone.status === 'completed' ? 'fr-status-accepted' : milestone.status === 'blocked' ? 'fr-status-rejected' : 'fr-status-pending'}`}>
                            {copy(MILESTONE_STATUS_KEYS[milestone.status] || 'launchPlanStatusPending')}
                          </span>
                          {onMilestoneStatusChange && (
                            <div>
                              <label className="fr-detail-list-label" htmlFor={`fr-milestone-status-${milestone.id}`}>{copy('milestoneChangeStatus')}</label>
                              <select
                                id={`fr-milestone-status-${milestone.id}`}
                                className="fr-followup-input"
                                value={milestone.status}
                                disabled={disabled}
                                onChange={(event) => onMilestoneStatusChange(location.id, milestone.id, event.target.value)}
                              >
                                {Object.keys(MILESTONE_STATUS_KEYS).map((status) => (
                                  <option key={status} value={status}>{copy(MILESTONE_STATUS_KEYS[status])}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
