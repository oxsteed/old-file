import { useTranslation } from 'react-i18next';
import { ListChecks } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const DEPENDENCY_KEYS = {
  agreement: 'dependency_agreement',
  training: 'dependency_training',
  staffing: 'dependency_staffing',
  milestones: 'dependency_milestones',
  compliance: 'dependency_compliance',
  readiness: 'dependency_readiness',
  services: 'dependency_services',
  exceptions: 'dependency_exceptions',
};

const DEPENDENCY_STATUS_KEYS = {
  satisfied: 'dependenciesStatus_satisfied',
  pending: 'dependenciesStatus_pending',
  blocked: 'dependenciesStatus_blocked',
};

const DEPENDENCY_STATUS_BADGE = {
  satisfied: 'fr-status-accepted',
  pending: 'fr-status-pending',
  blocked: 'fr-status-rejected',
};

const OVERALL_KEYS = {
  ready: 'dependenciesOverall_ready',
  pending: 'dependenciesOverall_pending',
  blocked: 'dependenciesOverall_blocked',
};

const OVERALL_BADGE = {
  ready: 'fr-status-accepted',
  pending: 'fr-status-pending',
  blocked: 'fr-status-rejected',
};

// Group 12 Slice 3h (639, D-339): the launch dependency overview —
// per location, the dependencies a launch needs (agreement, training,
// staffing, milestones, compliance, readiness, services, exceptions)
// with blocked/pending/satisfied status, derived from existing state.
// Only an unsigned agreement, a blocked milestone, no available
// service, or an open urgent exception blocks a launch.
export default function FranchiseLaunchDependencies({ dependencies = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  const locations = dependencies?.locations || [];

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <ListChecks size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('dependenciesTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('dependenciesSubtitle')}</p>
        </div>
      </div>

      {locations.length === 0 ? (
        <p className="fr-detail-empty">{copy('dependenciesEmpty')}</p>
      ) : (
        <>
          <p className="fr-doc-file-meta">
            {copy('dependenciesReady', { count: dependencies?.ready ?? 0 })}
            {' · '}
            {copy('dependenciesPending', { count: dependencies?.pending ?? 0 })}
            {' · '}
            {copy('dependenciesBlocked', { count: dependencies?.blocked ?? 0 })}
          </p>
          <ul className="fr-doc-files">
            {locations.map((location) => (
              <li key={location.location_id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{location.location_name}</div>
                  <div className="fr-doc-file-meta">
                    {location.ready_to_launch
                      ? copy('dependenciesReadyToLaunch')
                      : copy('dependenciesNotReady')}
                  </div>
                  {(location.dependencies || []).map((dependency) => (
                    <div key={dependency.code} className="fr-doc-file-meta">
                      {copy(DEPENDENCY_KEYS[dependency.code] || 'dependency_agreement')}
                      {' · '}
                      {copy(DEPENDENCY_STATUS_KEYS[dependency.status] || 'dependenciesStatus_pending')}
                      {dependency.blocks_launch ? ` · ${copy('dependenciesBlocksLaunch')}` : ''}
                      {' — '}
                      {dependency.detail}
                    </div>
                  ))}
                </div>
                <span className={`fr-status-badge ${OVERALL_BADGE[location.overall] || 'fr-status-pending'}`}>
                  {copy(OVERALL_KEYS[location.overall] || 'dependenciesOverall_pending')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
