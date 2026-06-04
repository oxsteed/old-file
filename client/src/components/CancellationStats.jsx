import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import './CancellationStats.css';

/**
 * CancellationStats Component
 * Displays customer/helper cancellation history & reliability
 * Used in: Bid forms, profiles, job detail sidebars
 */
export default function CancellationStats({ userId, type = 'customer', showDetails = false }) {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchStats();
  }, [userId, type]);

  async function fetchStats() {
    setLoading(true);
    setError(null);
    try {
      const endpoint = type === 'customer'
        ? `/cancellation-stats/customer/${userId}${showDetails ? '' : '/summary'}`
        : `/cancellation-stats/helper/${userId}`;

      const { data } = await api.get(endpoint);
      setStats(data.data);
    } catch (err) {
      // Silently fail for missing data (new users)
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="cs-loading">{t('cancellationStats.loading')}</div>;
  if (!stats) return null;

  const reliabilityScore = stats.reliability_score;
  const formatDate = (value) => new Date(value).toLocaleDateString(i18n.resolvedLanguage || i18n.language);

  const getMessage = () => {
    if (type === 'customer') {
      if (stats.cancellation_rate === 0) {
        return t('cancellationStats.summaryCustomerClean', {
          count: stats.total_jobs_posted ?? 0,
        });
      }
      return t('cancellationStats.summaryCustomerRate', {
        jobs: stats.total_jobs_posted ?? 0,
        cancelled: stats.cancellations_total ?? 0,
        rate: stats.cancellation_rate ?? stats.cancellation_rate_percent ?? 0,
      });
    }

    if (!stats.accepted_job_cancellations) {
      return t('cancellationStats.summaryHelperClean', {
        count: stats.total_jobs_accepted ?? 0,
      });
    }
    return t('cancellationStats.summaryHelperRate', {
      jobs: stats.total_jobs_accepted ?? 0,
      cancelled: stats.accepted_job_cancellations ?? 0,
      rate: stats.accepted_job_cancellation_rate ?? 0,
    });
  };

  const getRiskColor = (score) => {
    if (!score) return '#4ade80';
    if (score === 'new_user' || score === 'new_helper') return '#94a3b8';
    if (score === 'reliable') return '#4ade80';
    if (score === 'caution') return '#eab308';
    if (score === 'warning') return '#f97316';
    return '#ef4444';
  };

  const getRiskIcon = (score) => {
    if (!score) return '?';
    if (score === 'new_user' || score === 'new_helper') return '✨';
    if (score === 'reliable') return '✓';
    if (score === 'caution') return '⚠️';
    if (score === 'warning') return '⚠️';
    return '🚨';
  };

  const riskColor = getRiskColor(reliabilityScore);
  const riskIcon = getRiskIcon(reliabilityScore);

  return (
    <div className="cs-container">
      {/* Quick summary card */}
      <div
        className={`cs-card cs-risk-${reliabilityScore}`}
        style={{ borderLeftColor: riskColor }}
      >
        <div className="cs-header" onClick={() => showDetails && setExpanded(!expanded)}>
          <div className="cs-icon">{riskIcon}</div>
          <div className="cs-content">
            <div className="cs-title">
              {type === 'customer' ? t('cancellationStats.customerTitle') : t('cancellationStats.helperTitle')}
            </div>
            <div className="cs-message">{getMessage()}</div>
          </div>
          {showDetails && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((previous) => !previous);
              }}
              className="cs-expand-btn"
              aria-label={expanded ? t('cancellationStats.collapseDetails') : t('cancellationStats.expandDetails')}
            >
              {expanded ? '−' : '+'}
            </button>
          )}
        </div>

        {/* Expanded details */}
        {showDetails && expanded && (
          <div className="cs-details">
            {type === 'customer' && stats.total_jobs_posted !== undefined && (
              <>
                <div className="cs-stat-row">
                  <span className="cs-label">{t('cancellationStats.totalJobsPosted')}</span>
                  <span className="cs-value">{stats.total_jobs_posted}</span>
                </div>
                {stats.cancellations_total > 0 && (
                  <>
                    <div className="cs-stat-row">
                      <span className="cs-label">{t('cancellationStats.cancellations')}</span>
                      <span className="cs-value">{stats.cancellations_total} ({stats.cancellation_rate_percent}%)</span>
                    </div>
                    <div className="cs-stat-row">
                      <span className="cs-label">{t('cancellationStats.averageDaysBeforeCancel')}</span>
                      <span className="cs-value">{t('cancellationStats.daysValue', { count: Math.round(stats.avg_days_before_cancel) })}</span>
                    </div>
                    {stats.cancellations_within_24h_of_start > 0 && (
                      <div className="cs-stat-row cs-warning">
                        <span className="cs-label">{t('cancellationStats.lastMinuteCancellations')}</span>
                        <span className="cs-value">{t('cancellationStats.within24HoursOfStart', { count: stats.cancellations_within_24h_of_start })}</span>
                      </div>
                    )}
                  </>
                )}
                {stats.last_job_posted && (
                  <div className="cs-stat-row">
                    <span className="cs-label">{t('cancellationStats.lastJobPosted')}</span>
                    <span className="cs-value">{formatDate(stats.last_job_posted)}</span>
                  </div>
                )}
              </>
            )}

            {type === 'helper' && stats.total_jobs_accepted !== undefined && (
              <>
                <div className="cs-stat-row">
                  <span className="cs-label">{t('cancellationStats.jobsAccepted')}</span>
                  <span className="cs-value">{stats.total_jobs_accepted}</span>
                </div>
                {stats.accepted_job_cancellations > 0 && (
                  <>
                    <div className="cs-stat-row">
                      <span className="cs-label">{t('cancellationStats.cancellations')}</span>
                      <span className="cs-value">{stats.accepted_job_cancellations} ({stats.accepted_job_cancellation_rate}%)</span>
                    </div>
                    <div className="cs-stat-row">
                      <span className="cs-label">{t('cancellationStats.averageDaysFromAcceptanceToCancel')}</span>
                      <span className="cs-value">{t('cancellationStats.daysValue', { count: Math.round(stats.avg_days_from_acceptance_to_cancel) })}</span>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="cs-disclaimer">
              {type === 'customer'
                ? t('cancellationStats.customerDisclaimer')
                : t('cancellationStats.helperDisclaimer')}
            </div>
          </div>
        )}
      </div>

      {/* Warning box for high-risk users */}
      {(reliabilityScore === 'warning' || reliabilityScore === 'high_risk') && (
        <div className="cs-warning-box">
          <div className="cs-warning-icon">⚠️</div>
          <div className="cs-warning-text">
            {type === 'customer'
              ? t('cancellationStats.customerWarning')
              : t('cancellationStats.helperWarning')}
          </div>
        </div>
      )}
    </div>
  );
}
