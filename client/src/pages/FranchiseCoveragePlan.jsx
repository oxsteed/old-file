import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Group 12 Slice 3d (619, D-319): territory coverage planning — a
// read-only rollup of the linked business's staff shifts for the next
// 14 days, with days that have no shifts flagged as gaps. Per-location
// coverage is the manager + opening-team presence, not per-location
// shifts: shifts are business-scoped and a franchise location has no
// separate business id.
export default function FranchiseCoveragePlan({ coverage = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  const gapCount = (coverage?.days || []).filter((day) => day.gap).length;

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <CalendarDays size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('coverageTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('coverageSubtitle')}</p>
        </div>
      </div>

      {!coverage ? (
        <p className="fr-detail-empty">{copy('coverageEmpty')}</p>
      ) : !coverage.linked_business_id ? (
        <p className="fr-detail-empty">{copy('coverageNoBusiness')}</p>
      ) : (
        <>
          <p className="fr-doc-file-meta">
            {copy('coverageGapDays', { count: gapCount })}
          </p>
          <ul className="fr-doc-files">
            {(coverage.days || []).map((day) => (
              <li key={day.date} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{formatDate(day.date)}</div>
                  <div className="fr-doc-file-meta">
                    {copy('coverageShifts')}: {day.shifts}
                    {' · '}
                    {copy('coverageStaff')}: {day.staff}
                  </div>
                </div>
                <span className={`fr-status-badge ${day.gap ? 'fr-status-rejected' : 'fr-status-accepted'}`}>
                  {day.gap ? copy('coverageGap') : copy('coverageCovered')}
                </span>
              </li>
            ))}
          </ul>

          <div className="fr-detail-list-label">{copy('coverageLocationsTitle')}</div>
          {(coverage.locations || []).length === 0 ? (
            <p className="fr-detail-empty">{copy('coverageEmpty')}</p>
          ) : (
            <ul className="fr-doc-files">
              {(coverage.locations || []).map((location) => (
                <li key={location.id} className="fr-doc-file">
                  <div>
                    <div className="fr-doc-file-name">{location.name}</div>
                    <div className="fr-doc-file-meta">
                      {copy('coverageManager')}: {location.manager ? location.manager.name : copy('coverageNoManager')}
                      {' · '}
                      {copy('coverageTeam', { count: location.opening_team_count ?? 0 })}
                      {' · '}
                      {location.launch_complete ? copy('coverageLaunchComplete') : copy('coverageLaunchPending')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
