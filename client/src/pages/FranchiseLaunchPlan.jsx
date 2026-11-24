import { useTranslation } from 'react-i18next';
import { Rocket } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const LAUNCH_PLAN_KEYS = {
  confirm_boundary: { title: 'launchPlanStepConfirmBoundary', desc: 'launchPlanStepConfirmBoundaryDesc' },
  complete_training: { title: 'launchPlanStepCompleteTraining', desc: 'launchPlanStepCompleteTrainingDesc' },
  secure_location: { title: 'launchPlanStepSecureLocation', desc: 'launchPlanStepSecureLocationDesc' },
  recruit_team: { title: 'launchPlanStepRecruitTeam', desc: 'launchPlanStepRecruitTeamDesc' },
  confirm_opening_date: { title: 'launchPlanStepConfirmOpeningDate', desc: 'launchPlanStepConfirmOpeningDateDesc' },
};
const STATUS_KEYS = {
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
const READINESS_KEYS = {
  not_ready: 'notReady',
  planning: 'planning',
  ready: 'ready',
  launched: 'launched',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Group 12 Slice 3b (609, D-309): the territory launch plan — plan steps
// with dates and owners on top of the readiness status. Seeded steps render
// localized titles by code; HQ-added steps render their stored title.
// `onStatusChange` is the operator's status control; without it the plan
// renders read-only (territory ops page passes its own handler).
export default function FranchiseLaunchPlan({ steps = [], readinessStatus = null, onStatusChange = null, disabled = false }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const completedCount = steps.filter((step) => step.status === 'completed').length;

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <Rocket size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('launchPlanTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('launchPlanSubtitle')}</p>
        </div>
      </div>

      <div>
        <span className="fr-status-badge">
          {copy('launchPlanReadiness')}: {readinessStatus && READINESS_KEYS[readinessStatus]
            ? t(`dashboards.franchise.readiness.${READINESS_KEYS[readinessStatus]}`)
            : copy('launchPlanNoReadiness')}
        </span>
        {steps.length > 0 && (
          <span className="fr-doc-file-meta"> · {copy('launchPlanProgress', { done: completedCount, total: steps.length })}</span>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="fr-detail-empty">{copy('launchPlanEmpty')}</p>
      ) : (
        <div className="fr-doc-list">
          {steps.map((step) => {
            const keys = LAUNCH_PLAN_KEYS[step.code];
            return (
              <div key={step.id} className="fr-doc-category">
                <div className="fr-doc-category-head">
                  <div>
                    <div className="fr-doc-category-name">{keys ? copy(keys.title) : step.title}</div>
                    <div className="fr-doc-file-meta">
                      {keys ? copy(keys.desc) : step.description}
                    </div>
                    <div className="fr-doc-file-meta">
                      {copy('launchPlanDue')}: {step.due_date ? formatDate(step.due_date) : copy('launchPlanNoDue')}
                      {' · '}
                      {copy('launchPlanOwner')}: {copy(OWNER_KEYS[step.owner_role] || 'launchPlanOwnerOperator')}
                    </div>
                  </div>
                  <span className={`fr-status-badge ${step.status === 'completed' ? 'fr-status-accepted' : step.status === 'blocked' ? 'fr-status-rejected' : 'fr-status-pending'}`}>
                    {copy(STATUS_KEYS[step.status] || 'launchPlanStatusPending')}
                  </span>
                </div>
                {onStatusChange && (
                  <div>
                    <label className="fr-detail-list-label" htmlFor={`fr-plan-status-${step.id}`}>{copy('launchPlanChangeStatus')}</label>
                    <select
                      id={`fr-plan-status-${step.id}`}
                      className="fr-followup-input"
                      value={step.status}
                      disabled={disabled}
                      onChange={(event) => onStatusChange(step.id, event.target.value)}
                    >
                      {Object.keys(STATUS_KEYS).map((status) => (
                        <option key={status} value={status}>{copy(STATUS_KEYS[status])}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
