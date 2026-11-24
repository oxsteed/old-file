import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatRange(start, end) {
  if (!start) return '—';
  if (!end || start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

// Group 12 Slice 3f (630, D-330): the territory coverage trend —
// coverage % by day and by week over time, derived from the linked
// business's staff shifts. Territory-level only: shifts are
// business-scoped and a franchise location has no separate business id.
export default function FranchiseCoverageTrend({ trend = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <TrendingUp size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('trendTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('trendSubtitle')}</p>
        </div>
      </div>

      {!trend ? (
        <p className="fr-detail-empty">{copy('trendEmpty')}</p>
      ) : !trend.linked_business_id ? (
        <p className="fr-detail-empty">{copy('trendNoBusiness')}</p>
      ) : (
        <>
          <p className="fr-doc-file-meta">
            {copy('trendOverall', { pct: trend.coverage_pct ?? 0 })}
            {' · '}
            {formatRange(trend.from, trend.to)}
          </p>

          <div className="fr-detail-list-label">{copy('trendWeeksTitle')}</div>
          <ul className="fr-doc-files">
            {(trend.weeks || []).map((week) => (
              <li key={week.week_start} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{formatRange(week.week_start, week.week_end)}</div>
                  <div className="fr-doc-file-meta">
                    {copy('trendCoveredDays', { covered: week.covered_days ?? 0, days: week.days ?? 0 })}
                  </div>
                </div>
                <span className={`fr-status-badge ${week.coverage_pct >= 80 ? 'fr-status-accepted' : week.coverage_pct >= 50 ? 'fr-status-pending' : 'fr-status-rejected'}`}>
                  {week.coverage_pct ?? 0}%
                </span>
              </li>
            ))}
          </ul>

          <div className="fr-detail-list-label">{copy('trendDaysTitle')}</div>
          <ul className="fr-doc-files">
            {(trend.days || []).map((day) => (
              <li key={day.date} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{formatDate(day.date)}</div>
                  <div className="fr-doc-file-meta">
                    {copy('coverageShifts')}: {day.shifts}
                    {' · '}
                    {copy('coverageStaff')}: {day.staff}
                  </div>
                </div>
                <span className={`fr-status-badge ${day.covered ? 'fr-status-accepted' : 'fr-status-rejected'}`}>
                  {day.covered ? copy('coverageCovered') : copy('coverageGap')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
