/**
 * HelperCancellationConfirmation.jsx
 * Helper-facing cancellation modal — Phase 2 moral accountability layer.
 *
 * Shows:
 *   • Customer's real name + reliability (completion %, cancellation history)
 *   • Helper's own cancellation pattern (visible on their profile)
 *   • Urgency framing if <24h before scheduled start
 *   • NO FEE for helpers — but the action is logged and market-visible
 *   • Explicit moral-acknowledgement checkbox before confirming
 *
 * Philosophy: Helpers deserve to know who they're helping and whether
 * this customer honours commitments. Accountability goes both ways.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, TrendingDown, User, Eye } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import './HelperCancellationConfirmation.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function hoursUntil(dateStr) {
  if (!dateStr) return null;
  return (new Date(dateStr) - Date.now()) / (1000 * 60 * 60);
}

function reliabilityLabel(rate) {
  if (rate == null) return null;
  if (rate <= 5)  return 'reliable';
  if (rate <= 15) return 'caution';
  return 'warning';
}

function reliabilityColor(rate) {
  if (rate == null) return '#6b7280';
  if (rate <= 5)  return '#22c55e';
  if (rate <= 15) return '#f59e0b';
  return '#ef4444';
}

function patternSummary(stats, t) {
  if (!stats) return null;
  const { cancellations_within_24h_of_start, cancellations_1_to_7_days_before } = stats;
  const lateCount = (cancellations_within_24h_of_start || 0) + (cancellations_1_to_7_days_before || 0);
  const total     = stats.cancellations_total || 0;
  if (total === 0) return null;
  if (lateCount === 0) return t('helperCancelConfirm.patternEarly', 'Usually cancels well in advance when they do cancel.');
  if (lateCount >= total * 0.5) return t('helperCancelConfirm.patternLate', 'Often cancels within a week of the start date.');
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HelperCancellationConfirmation({
  job,            // full job object
  customerName,   // string
  customerAvatar, // URL or null
  helperId,       // current user's ID (to fetch own stats)
  onCancel,       // () => void — keep the job
  onConfirm       // (data) => void — cancellation confirmed
}) {
  const { t } = useTranslation();

  const [acknowledged, setAcknowledged]   = useState(false);
  const [loading, setLoading]             = useState(false);
  const [customerStats, setCustomerStats] = useState(null);
  const [helperStats, setHelperStats]     = useState(null);
  const [statsLoading, setStatsLoading]   = useState(true);

  const hours = hoursUntil(job?.scheduled_date);
  const isLessThan24h = hours !== null && hours < 24;
  const displayCustomer = customerName || t('helperCancelConfirm.theCustomer', 'the customer');

  // ─── Fetch both parties' stats ─────────────────────────────────────────────
  useEffect(() => {
    if (!job?.client_id && !helperId) return;
    setStatsLoading(true);

    const fetches = [];

    if (job?.client_id) {
      fetches.push(
        api.get(`/cancellation-stats/customer/${job.client_id}`)
          .then(r => setCustomerStats(r.data?.data || null))
          .catch(() => setCustomerStats(null))
      );
    }

    if (helperId) {
      fetches.push(
        api.get(`/cancellation-stats/helper/${helperId}`)
          .then(r => setHelperStats(r.data?.data || null))
          .catch(() => setHelperStats(null))
      );
    }

    Promise.all(fetches).finally(() => setStatsLoading(false));
  }, [job?.client_id, helperId]);

  // ─── Derived stats ─────────────────────────────────────────────────────────
  const custTotal       = customerStats?.total_jobs_posted || 0;
  const custCancelled   = customerStats?.cancellations_total || 0;
  const custCompleted   = custTotal - custCancelled;
  const custRate        = customerStats?.cancellation_rate_percent ?? null;
  const custReliability = reliabilityLabel(custRate);
  const custColor       = reliabilityColor(custRate);

  const helperTotal     = helperStats?.total_jobs_accepted || 0;
  const helperCancelled = helperStats?.accepted_job_cancellations || 0;
  const helperRate      = helperStats?.accepted_job_cancellation_rate ?? null;
  const ownPattern      = patternSummary(customerStats, t);

  // ─── Submit ────────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!acknowledged) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/jobs/${job.id}/cancel`, {
        reason: null
      });
      toast.success(t('helperCancelConfirm.cancelled', 'Job cancelled. This has been logged on your profile.'));
      onConfirm(data.data);
    } catch (err) {
      const msg = err.response?.data?.message || t('common.error', 'Something went wrong');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="hcc-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hcc-title"
      onClick={e => { if (e.target === e.currentTarget && !loading) onCancel(); }}
    >
      <div className="hcc-panel">

        {/* ── Header ── */}
        <div className="hcc-header">
          {isLessThan24h && (
            <div className="hcc-urgency-banner" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              {t('helperCancelConfirm.urgencyBanner',
                'Cancelling less than 24 hours before the job, {{customer}} will need to find someone else at the last minute.',
                { customer: displayCustomer }
              )}
            </div>
          )}
          <h2 id="hcc-title" className="hcc-title">
            {t('helperCancelConfirm.title', 'Cancel this job?')}
          </h2>
        </div>

        {/* ── Customer reliability ── */}
        <div className="hcc-section">
          <div className="hcc-section-label">
            <User size={13} aria-hidden="true" />
            {t('helperCancelConfirm.customerReliabilityLabel', 'Customer reliability')}
          </div>

          <div className="hcc-customer-row">
            <div className="hcc-avatar" aria-hidden="true">
              {customerAvatar
                ? <img src={customerAvatar} alt="" className="hcc-avatar-img" />
                : <span className="hcc-avatar-initials">{getInitials(customerName)}</span>
              }
            </div>

            <div className="hcc-customer-info">
              <p className="hcc-customer-name">{displayCustomer}</p>

              {statsLoading ? (
                <p className="hcc-loading">{t('common.loading', 'Loading…')}</p>
              ) : custTotal > 0 ? (
                <div className="hcc-stats-row">
                  <span
                    className="hcc-rate-badge"
                    style={{ background: `${custColor}18`, color: custColor, borderColor: `${custColor}55` }}
                  >
                    {custRate != null ? `${custRate}% cancellation` : custReliability}
                  </span>
                  <span className="hcc-stat-text">
                    {t('helperCancelConfirm.custCompletedOf',
                      '{{completed}} / {{total}} jobs completed',
                      { completed: custCompleted, total: custTotal }
                    )}
                  </span>
                </div>
              ) : (
                <p className="hcc-stat-text">
                  {t('helperCancelConfirm.newCustomer', 'New customer: no cancellation history yet.')}
                </p>
              )}

              {custCancelled > 0 && (
                <p className="hcc-stat-text hcc-stat-muted">
                  {t('helperCancelConfirm.custCancellations', { count: custCancelled })}
                </p>
              )}

              {ownPattern && (
                <p className="hcc-stat-text hcc-stat-muted hcc-stat-italic">{ownPattern}</p>
              )}
            </div>
          </div>

          {/* What this means for them */}
          <p className="hcc-impact-note">
            {t('helperCancelConfirm.impactNote',
              'Cancelling now means {{customer}} will need to find someone else at the last minute.',
              { customer: displayCustomer }
            )}
          </p>
        </div>

        {/* ── Helper's own pattern ── */}
        <div className="hcc-section hcc-section--own">
          <div className="hcc-section-label">
            <Eye size={13} aria-hidden="true" />
            {t('helperCancelConfirm.yourRecordLabel', 'Your cancellation record (visible on your profile)')}
          </div>

          {statsLoading ? (
            <p className="hcc-loading">{t('common.loading', 'Loading…')}</p>
          ) : helperTotal > 0 ? (
            <div className="hcc-own-stats">
              <div className="hcc-own-stat">
                <span className="hcc-own-stat-value">{helperRate != null ? `${helperRate}%` : '—'}</span>
                <span className="hcc-own-stat-label">{t('helperCancelConfirm.cancellationRate', 'cancellation rate')}</span>
              </div>
              <div className="hcc-own-stat">
                <span className="hcc-own-stat-value">{helperCancelled}</span>
                <span className="hcc-own-stat-label">
                  {t('helperCancelConfirm.cancellationsOf',
                    'of {{total}} jobs',
                    { total: helperTotal }
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="hcc-stat-text">
              {t('helperCancelConfirm.cleanRecord', 'Clean record: no cancellations yet. This would be your first.')}
            </p>
          )}

          <p className="hcc-own-note">
            {t('helperCancelConfirm.ownNote',
              'Customers see this when reviewing your profile. Reliability is one of the top factors they consider.'
            )}
          </p>
        </div>

        {/* ── No fee notice ── */}
        <div className="hcc-no-fee">
          <TrendingDown size={13} aria-hidden="true" />
          <span>
            {t('helperCancelConfirm.noFeeNote',
              'No cancellation fee charged to you, but this cancellation will be logged and visible on your profile.'
            )}
          </span>
        </div>

        {/* ── Moral acknowledgement ── */}
        <label className={`hcc-ack ${acknowledged ? 'hcc-ack--checked' : ''}`}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            disabled={loading}
            aria-required="true"
            className="hcc-ack-input"
          />
          <span className="hcc-ack-text">
            {t('helperCancelConfirm.ackText',
              'I understand this affects {{customer}}\'s planning. I want to proceed.',
              { customer: displayCustomer }
            )}
          </span>
        </label>

        {/* ── Actions ── */}
        <div className="hcc-actions">
          <button
            className="hcc-btn-keep"
            onClick={onCancel}
            disabled={loading}
            type="button"
          >
            {t('helperCancelConfirm.keepJob', 'Keep the job')}
          </button>
          <button
            className={`hcc-btn-cancel ${!acknowledged ? 'hcc-btn-cancel--locked' : ''}`}
            onClick={handleConfirm}
            disabled={loading || !acknowledged}
            type="button"
            aria-disabled={!acknowledged}
          >
            {loading
              ? t('helperCancelConfirm.cancelling', 'Cancelling…')
              : t('helperCancelConfirm.confirmCancel', 'Confirm cancellation')
            }
          </button>
        </div>

      </div>
    </div>
  );
}
