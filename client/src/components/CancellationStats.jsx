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
  const { t } = useTranslation();
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

  if (loading) return <div className="cs-loading">Loading reliability info...</div>;
  if (!stats) return null;

  const reliabilityScore = stats.reliability_score;
  const getMessage = () => {
    if (type === 'customer') {
      if (!stats.message) {
        // Construct message from summary data
        if (stats.cancellation_rate === 0) {
          return `Clean record: ${stats.total_jobs_posted} jobs posted, no cancellations`;
        }
        return `${stats.total_jobs_posted} jobs, ${stats.cancellations_total} cancelled (${stats.cancellation_rate}%)`;
      }
      return stats.message;
    } else {
      // Helper stats
      if (!stats.accepted_job_cancellations) {
        return `Reliable: ${stats.total_jobs_accepted} jobs accepted, no cancellations`;
      }
      return `${stats.total_jobs_accepted} jobs accepted, ${stats.accepted_job_cancellations} cancelled (${stats.accepted_job_cancellation_rate}%)`;
    }
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
              {type === 'customer' ? 'Customer Reliability' : 'Helper Reliability'}
            </div>
            <div className="cs-message">{getMessage()}</div>
          </div>
          {showDetails && (
            <button className="cs-expand-btn" aria-label="Expand details">
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
                  <span className="cs-label">Total jobs posted:</span>
                  <span className="cs-value">{stats.total_jobs_posted}</span>
                </div>
                {stats.cancellations_total > 0 && (
                  <>
                    <div className="cs-stat-row">
                      <span className="cs-label">Cancellations:</span>
                      <span className="cs-value">{stats.cancellations_total} ({stats.cancellation_rate_percent}%)</span>
                    </div>
                    <div className="cs-stat-row">
                      <span className="cs-label">Average days before cancel:</span>
                      <span className="cs-value">{Math.round(stats.avg_days_before_cancel)} days</span>
                    </div>
                    {stats.cancellations_within_24h_of_start > 0 && (
                      <div className="cs-stat-row cs-warning">
                        <span className="cs-label">⚠️ Last-minute cancellations:</span>
                        <span className="cs-value">{stats.cancellations_within_24h_of_start} within 24h of start</span>
                      </div>
                    )}
                  </>
                )}
                {stats.last_job_posted && (
                  <div className="cs-stat-row">
                    <span className="cs-label">Last job posted:</span>
                    <span className="cs-value">{new Date(stats.last_job_posted).toLocaleDateString()}</span>
                  </div>
                )}
              </>
            )}

            {type === 'helper' && stats.total_jobs_accepted !== undefined && (
              <>
                <div className="cs-stat-row">
                  <span className="cs-label">Jobs accepted:</span>
                  <span className="cs-value">{stats.total_jobs_accepted}</span>
                </div>
                {stats.accepted_job_cancellations > 0 && (
                  <>
                    <div className="cs-stat-row">
                      <span className="cs-label">Cancellations:</span>
                      <span className="cs-value">{stats.accepted_job_cancellations} ({stats.accepted_job_cancellation_rate}%)</span>
                    </div>
                    <div className="cs-stat-row">
                      <span className="cs-label">Avg days from acceptance to cancel:</span>
                      <span className="cs-value">{Math.round(stats.avg_days_from_acceptance_to_cancel)} days</span>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="cs-disclaimer">
              {type === 'customer'
                ? 'This information helps helpers understand your job posting history to make informed decisions.'
                : 'This information helps customers decide whether to hire this helper.'}
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
              ? 'This customer has a history of cancellations. Consider setting a higher rate or requesting upfront confirmation.'
              : 'This helper has cancelled accepted jobs. Review their reviews and consider asking for commitment confirmation.'}
          </div>
        </div>
      )}
    </div>
  );
}
