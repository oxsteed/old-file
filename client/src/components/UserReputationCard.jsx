import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, TrendingUp, AlertCircle, CheckCircle, DollarSign, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../api/axios';
import '../styles/UserReputationCard.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diffDays = Math.round((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30)  return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.round(diffDays / 30)} months ago`;
  return `${Math.round(diffDays / 365)} years ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const UserReputationCard = ({ userId, showFeeHistory = false, className = '' }) => {
  const { t } = useTranslation();
  const [reputation, setReputation] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  // Fee history (only fetched when showFeeHistory=true)
  const [feeHistory, setFeeHistory]         = useState(null);
  const [feeHistoryLoading, setFeeHistoryLoading] = useState(false);
  const [showFeeList, setShowFeeList]       = useState(false);

  // ── Fetch reputation ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`/reputation/${userId}`)
      .then(r => r.data)
      .then(({ data }) => setReputation(data))
      .catch(err => setError(err?.message || 'Failed to fetch'))
      .finally(() => setLoading(false));
  }, [userId]);

  // ── Fetch fee history (lazy — only when section is revealed) ──────────────
  useEffect(() => {
    if (!showFeeHistory || !userId || feeHistory !== null) return;
    setFeeHistoryLoading(true);
    api.get(`/reputation/${userId}/fee-history`)
      .then(r => setFeeHistory(r.data?.data || null))
      .catch(() => setFeeHistory({ error: true }))
      .finally(() => setFeeHistoryLoading(false));
  }, [showFeeHistory, userId, feeHistory]);

  if (loading) {
    return (
      <div className={`reputation-card ${className}`}>
        <div className="reputation-skeleton" />
      </div>
    );
  }

  if (error || !reputation) return null;

  const getCautionColor = (level) => {
    switch (level) {
      case 'restricted': return '#dc2626';
      case 'caution':    return '#f59e0b';
      default:           return '#10b981';
    }
  };

  const getCautionIcon = (level) => {
    switch (level) {
      case 'restricted': return <AlertTriangle size={16} />;
      case 'caution':    return <AlertCircle size={16} />;
      default:           return <CheckCircle size={16} />;
    }
  };

  const getCautionLabel = (level) => {
    switch (level) {
      case 'restricted': return t('reputation.cautionRestricted');
      case 'caution':    return t('reputation.cautionCaution');
      default:           return t('reputation.cautionNone');
    }
  };

  const completionRate = reputation.totalJobs > 0
    ? Math.round((reputation.completedJobs / reputation.totalJobs) * 100)
    : 0;
  const hasEnoughHistory = reputation.totalJobs > 0 || reputation.completedJobs > 0;

  const hasFees = feeHistory && !feeHistory.error && feeHistory.totalFeesPaidCents > 0;

  return (
    <div className={`reputation-card ${className}`}>
      {/* ── Header ── */}
      <div className="rep-header">
        <h3 className="rep-title">{t('reputation.reliability')}</h3>
        <div
          className="rep-caution-badge"
          style={{ borderColor: getCautionColor(reputation.cautionLevel) }}
        >
          {getCautionIcon(reputation.cautionLevel)}
          <span>{getCautionLabel(reputation.cautionLevel)}</span>
        </div>
      </div>

      {/* ── Score + completion ── */}
      {hasEnoughHistory ? (
      <div className="rep-score-section">
        <div className="rep-score-circle">
          <div className="rep-score-value">{reputation.reliabilityScore}</div>
          <div className="rep-score-label">{t('reputation.score')}</div>
        </div>
        <div className="rep-score-info">
          <p className="rep-jobs-stat">
            <span className="rep-stat-number">{reputation.completedJobs}</span>
            <span className="rep-stat-label">{t('reputation.jobsCompleted')}</span>
          </p>
          <p className="rep-completion-rate">
            <TrendingUp size={14} />
            <span>{completionRate}% {t('reputation.completionRate')}</span>
          </p>
        </div>
      </div>
      ) : (
        <div className="rep-new-helper">
          <div className="rep-new-helper-badge">{t('reputation.newHelperBadge', 'New helper')}</div>
          <div>
            <p className="rep-new-helper-title">{t('reputation.notEnoughHistoryTitle', 'Not enough job history yet')}</p>
            <p className="rep-new-helper-copy">
              {t(
                'reputation.notEnoughHistoryCopy',
                'Reliability score appears after completed OxSteed jobs. For now, review verification badges, services, availability, and how clearly the helper communicates.'
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Stats grid ── */}
      {reputation.totalJobs > 0 && (
        <div className="rep-stats-grid">
          <div className="rep-stat-item">
            <div className="rep-stat-label">{t('reputation.totalJobs')}</div>
            <div className="rep-stat-value">{reputation.totalJobs}</div>
          </div>
          <div className="rep-stat-item">
            <div className="rep-stat-label">{t('reputation.cancelled')}</div>
            <div className="rep-stat-value" style={{ color: '#ef4444' }}>
              {reputation.cancelledJobs}
            </div>
          </div>
          <div className="rep-stat-item">
            <div className="rep-stat-label">{t('reputation.cancellationRate')}</div>
            <div className="rep-stat-value">
              {reputation.cancellationRate.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* ── Timing analysis ── */}
      {reputation.totalJobs > 0 && (
        <div className="rep-timing-analysis">
          <h4 className="rep-section-title">{t('reputation.cancellationTiming')}</h4>
          <div className="rep-timing-items">
            <div className="rep-timing-item">
              <span className="rep-timing-label">{t('reputation.lessThan24h')}</span>
              <span className="rep-timing-count">{reputation.cancellationPattern.lessThan24h}</span>
            </div>
            <div className="rep-timing-item">
              <span className="rep-timing-label">{t('reputation.from24hTo3d')}</span>
              <span className="rep-timing-count">{reputation.cancellationPattern.from24hTo3d}</span>
            </div>
            <div className="rep-timing-item">
              <span className="rep-timing-label">{t('reputation.threeDaysPlus')}</span>
              <span className="rep-timing-count">{reputation.cancellationPattern.threeDaysPlus}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Fee History (customer-only, opt-in via showFeeHistory prop) ── */}
      {showFeeHistory && (
        <div className="rep-fee-history">
          <div className="rep-fee-header">
            <div className="rep-fee-header-left">
              <DollarSign size={14} aria-hidden="true" className="rep-fee-icon" />
              <span className="rep-section-title">{t('reputation.feeHistory', 'Cancellation fees paid')}</span>
            </div>

            {feeHistoryLoading && (
              <span className="rep-fee-loading">{t('common.loading', 'Loading…')}</span>
            )}

            {hasFees && (
              <button
                className="rep-fee-toggle"
                onClick={() => setShowFeeList(v => !v)}
                aria-expanded={showFeeList}
                type="button"
              >
                {showFeeList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showFeeList
                  ? t('reputation.feesHide', 'Hide')
                  : t('reputation.feesShow', 'Show')
                }
              </button>
            )}
          </div>

          {feeHistory && !feeHistory.error && (
            <div className="rep-fee-summary">
              {feeHistory.cancellationCount > 0 ? (
                <>
                  <span className="rep-fee-count">
                    {t('reputation.feesCount',
                      '{{n}} cancellation fee{{s}} paid',
                      {
                        n: feeHistory.cancellationCount,
                        s: feeHistory.cancellationCount !== 1 ? 's' : ''
                      }
                    )}
                  </span>
                  <span className="rep-fee-total">
                    {formatCurrency(feeHistory.totalFeesPaidCents)} {t('reputation.feesTotal', 'total')}
                  </span>
                </>
              ) : (
                <span className="rep-fee-none">
                  ✓ {t('reputation.feesNone', 'No cancellation fees — great track record.')}
                </span>
              )}
            </div>
          )}

          {/* Timeline list */}
          {showFeeList && hasFees && (
            <ul className="rep-fee-list" aria-label={t('reputation.feeHistory', 'Fee history')}>
              {feeHistory.recentFees.map(fee => (
                <li key={fee.id} className="rep-fee-item">
                  <div className="rep-fee-item-left">
                    <span className="rep-fee-job">{fee.jobTitle || t('reputation.feeUnknownJob', 'Job')}</span>
                    <span className="rep-fee-helper">
                      {t('reputation.feeTo', 'To')} {fee.helperName}
                    </span>
                  </div>
                  <div className="rep-fee-item-right">
                    <span className="rep-fee-amount">{formatCurrency(fee.amountCents)}</span>
                    <span className="rep-fee-date">{formatRelativeDate(fee.date)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reputation.lastCalculatedAt && (
        <p className="rep-last-updated">
          {t('reputation.lastCalculated')} {new Date(reputation.lastCalculatedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
};

export default UserReputationCard;
