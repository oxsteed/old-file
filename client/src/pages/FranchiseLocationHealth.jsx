import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const HEALTH_STATUS_KEYS = {
  healthy: 'healthStatus_healthy',
  attention: 'healthStatus_attention',
  at_risk: 'healthStatus_atRisk',
};

const HEALTH_REASON_KEYS = {
  blocked_milestone: 'healthReason_blockedMilestone',
  open_urgent_exception: 'healthReason_openUrgentException',
  not_launched: 'healthReason_notLaunched',
  no_manager: 'healthReason_noManager',
  open_exception: 'healthReason_openException',
  unavailable_service: 'healthReason_unavailableService',
};

// Group 12 Slice 3f (627, D-328): the per-location health view — status,
// KPIs, and compliance for each location inside the territory, derived on
// read. The brand-side store comparison is not reused here: it is
// brand-facing and not territory-scoped.
export default function FranchiseLocationHealth({ health = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  const locations = health?.locations || [];

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <MapPin size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('healthTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('healthSubtitle')}</p>
        </div>
      </div>

      {!health || locations.length === 0 ? (
        <p className="fr-detail-empty">{copy('healthEmpty')}</p>
      ) : (
        <>
          <p className="fr-doc-file-meta">
            {copy('healthHealthy', { count: health.healthy ?? 0 })}
            {' · '}
            {copy('healthAttention', { count: health.attention ?? 0 })}
            {' · '}
            {copy('healthAtRisk', { count: health.at_risk ?? 0 })}
          </p>
          <ul className="fr-doc-files">
            {locations.map((location) => (
              <li key={location.id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{location.name}</div>
                  <div className="fr-doc-file-meta">
                    {[location.city, location.region].filter(Boolean).join(', ') || '—'}
                    {' · '}
                    {copy('healthMilestones', {
                      done: location.milestones?.done ?? 0,
                      total: location.milestones?.total ?? 0,
                    })}
                    {' · '}
                    {copy('healthServices', {
                      available: location.services?.available ?? 0,
                      total: location.services?.total ?? 0,
                    })}
                    {' · '}
                    {copy('healthManager')}: {location.manager ? location.manager.name : copy('healthNoManager')}
                    {' · '}
                    {copy('healthTeam', { count: location.opening_team_count ?? 0 })}
                    {' · '}
                    {location.launch_complete ? copy('healthLaunchComplete') : copy('healthLaunchPending')}
                    {' · '}
                    {copy('healthExceptions', { count: location.exceptions?.open ?? 0 })}
                  </div>
                  {(location.reasons || []).length > 0 && (
                    <div className="fr-doc-file-meta">
                      {(location.reasons || []).map((reason) => copy(HEALTH_REASON_KEYS[reason])).join(' · ')}
                    </div>
                  )}
                </div>
                <span className={`fr-status-badge ${location.health === 'healthy' ? 'fr-status-accepted' : location.health === 'at_risk' ? 'fr-status-rejected' : 'fr-status-pending'}`}>
                  {copy(HEALTH_STATUS_KEYS[location.health])}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
