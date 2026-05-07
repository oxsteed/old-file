/**
 * JobCancellationConfirmation.jsx
 * Customer-facing cancellation modal — Phase 2 moral accountability layer.
 *
 * Shows:
 *   • Helper's real name + avatar
 *   • The calendar block they set aside for this job
 *   • The exact fee (10% of budget, capped at $100) and what it represents
 *   • Explicit moral-acknowledgement checkbox before confirming
 *
 * Philosophy: Fee is recognition of harm, not punishment.
 * The customer chooses — we just make the consequences visible.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, DollarSign, AlertTriangle, User } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import './JobCancellationConfirmation.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  } catch { return null; }
}

function formatTime(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit'
    });
  } catch { return null; }
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function hoursUntil(dateStr) {
  if (!dateStr) return null;
  return (new Date(dateStr) - Date.now()) / (1000 * 60 * 60);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function JobCancellationConfirmation({
  job,          // full job object
  bid,          // accepted bid
  helperName,   // string — use real first name
  helperAvatar, // URL or null
  onCancel,     // () => void  — user chose to keep the job
  onConfirm     // (data) => void — cancellation succeeded
}) {
  const { t } = useTranslation();

  const [acknowledged, setAcknowledged]     = useState(false);
  const [loading, setLoading]               = useState(false);
  const [blockedSlot, setBlockedSlot]       = useState(null);  // appointment row
  const [slotLoading, setSlotLoading]       = useState(true);

  // ─── Fetch the appointment the helper has blocked ──────────────────────────
  useEffect(() => {
    if (!job?.id) return;
    setSlotLoading(true);
    api.get(`/api/jobs/${job.id}/appointment`)
      .then(res => setBlockedSlot(res.data?.data || null))
      .catch(() => setBlockedSlot(null))
      .finally(() => setSlotLoading(false));
  }, [job?.id]);

  // ─── Fee calculation ───────────────────────────────────────────────────────
  // 10% of budget_max, capped at $100
  const budgetCents   = Math.round((job?.budget_max || bid?.amount || 0) * 100);
  const feeCents      = Math.min(Math.round(budgetCents * 0.10), 10000); // $100 cap
  const isOxsteed     = bid?.payment_method === 'oxsteed';
  const feeApplies    = isOxsteed && feeCents > 0;
  const hours         = hoursUntil(job?.scheduled_date);

  // Flat fee: 10% of budget capped at $100. Always applies for OxSteed-payment jobs.
  const activeFee = feeApplies ? feeCents : 0;

  const displayHelper = helperName || t('cancellationConfirm.theHelper', 'the helper');

  // ─── Submit ────────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!acknowledged) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/jobs/${job.id}/cancel`, {
        reason: null
      });
      const feeMsg = activeFee > 0
        ? ` ${t('cancellationConfirm.feeNotice', { fee: formatCurrency(activeFee) }, `A recognition fee of ${formatCurrency(activeFee)} will go to ${displayHelper}.`)}`
        : '';
      toast.success(t('cancellationConfirm.cancelled', 'Job cancelled.') + feeMsg);
      onConfirm(data.data);
    } catch (err) {
      const msg = err.response?.data?.message || t('common.error', 'Something went wrong');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  // ─── Blocked time display ──────────────────────────────────────────────────
  const slotStart = blockedSlot?.start_time || blockedSlot?.scheduled_start || job?.scheduled_date;
  const slotEnd   = blockedSlot?.end_time   || blockedSlot?.scheduled_end;
  const slotDay   = formatDate(slotStart);
  const slotFrom  = formatTime(slotStart);
  const slotTo    = formatTime(slotEnd);

  return (
    <div
      className="jcc-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="jcc-title"
      onClick={e => { if (e.target === e.currentTarget && !loading) onCancel(); }}
    >
      <div className="jcc-panel">

        {/* ── Header ── */}
        <div className="jcc-header">
          <AlertTriangle size={20} className="jcc-header-icon" aria-hidden="true" />
          <h2 id="jcc-title" className="jcc-title">
            {t('cancellationConfirm.title', 'Cancel this job?')}
          </h2>
        </div>

        {/* ── Helper identity ── */}
        <div className="jcc-helper-card">
          <div className="jcc-avatar" aria-hidden="true">
            {helperAvatar
              ? <img src={helperAvatar} alt="" className="jcc-avatar-img" />
              : <span className="jcc-avatar-initials">{getInitials(helperName)}</span>
            }
          </div>
          <div className="jcc-helper-info">
            <p className="jcc-helper-name">{displayHelper}</p>
            <p className="jcc-helper-sub">
              {t('cancellationConfirm.helperSub', 'By cancelling, you\'re freeing up their time — but they may have already turned down other work for this.')}
            </p>
          </div>
        </div>

        {/* ── Blocked calendar time ── */}
        <div className="jcc-block">
          <div className="jcc-block-header">
            <Calendar size={15} aria-hidden="true" />
            <span>{t('cancellationConfirm.blockedTimeTitle', 'Time they set aside for your job')}</span>
          </div>

          {slotLoading ? (
            <p className="jcc-slot-loading">{t('common.loading', 'Loading...')}</p>
          ) : slotDay ? (
            <div className="jcc-slot">
              <span className="jcc-slot-day">{slotDay}</span>
              {slotFrom && (
                <span className="jcc-slot-time">
                  <Clock size={12} aria-hidden="true" />
                  {slotFrom}{slotTo ? ` – ${slotTo}` : ''}
                </span>
              )}
            </div>
          ) : job?.scheduled_date ? (
            <div className="jcc-slot">
              <span className="jcc-slot-day">{formatDate(job.scheduled_date)}</span>
              {formatTime(job.scheduled_date) && (
                <span className="jcc-slot-time">
                  <Clock size={12} aria-hidden="true" />
                  {formatTime(job.scheduled_date)}
                </span>
              )}
            </div>
          ) : (
            <p className="jcc-slot-none">
              {t('cancellationConfirm.noSlotFound', 'Scheduled date not set — they were available when you needed them.')}
            </p>
          )}
        </div>

        {/* ── Fee explanation ── */}
        {isOxsteed && (
          <div className={`jcc-fee-block ${activeFee > 0 ? 'jcc-fee-block--active' : 'jcc-fee-block--zero'}`}>
            <div className="jcc-fee-header">
              <DollarSign size={15} aria-hidden="true" />
              <span>{t('cancellationConfirm.feeTitle', 'Cancellation recognition fee')}</span>
            </div>

            {activeFee > 0 ? (
              <>
                <p className="jcc-fee-amount">{formatCurrency(activeFee)}</p>
                <p className="jcc-fee-explain">
                  {t('cancellationConfirm.feeExplain',
                    'This is 10% of the job budget (capped at $100). It goes directly to {{helper}} to recognise the time they blocked and the other work they may have turned down.',
                    { helper: displayHelper }
                  )}
                </p>
                <p className="jcc-fee-philosophy">
                  {t('cancellationConfirm.feePhilosophy',
                    'This is recognition of the impact on their livelihood — not a platform fine.'
                  )}
                </p>
              </>
            ) : !feeApplies ? (
              <p className="jcc-fee-zero">
                ✓ {t('cancellationConfirm.feeZeroOffPlatform',
                  'No OxSteed fee because this job uses an off-platform payment method.'
                )}
              </p>
            ) : null}
          </div>
        )}

        {/* ── Moral acknowledgement checkbox ── */}
        <label className={`jcc-ack ${acknowledged ? 'jcc-ack--checked' : ''}`}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            disabled={loading}
            aria-required="true"
            className="jcc-ack-input"
          />
          <span className="jcc-ack-text">
            {activeFee > 0
              ? t('cancellationConfirm.ackWithFee',
                  'I understand this may impact {{helper}}\'s earnings and I want to proceed.',
                  { helper: displayHelper }
                )
              : t('cancellationConfirm.ackNoFee',
                  'I understand {{helper}} arranged their schedule for this job and I want to cancel.',
                  { helper: displayHelper }
                )
            }
          </span>
        </label>

        {/* ── Actions ── */}
        <div className="jcc-actions">
          <button
            className="jcc-btn-keep"
            onClick={onCancel}
            disabled={loading}
            type="button"
          >
            {t('cancellationConfirm.keepJob', 'Keep the job')}
          </button>
          <button
            className={`jcc-btn-cancel ${!acknowledged ? 'jcc-btn-cancel--locked' : ''}`}
            onClick={handleConfirm}
            disabled={loading || !acknowledged}
            type="button"
            aria-disabled={!acknowledged}
            title={!acknowledged ? t('cancellationConfirm.checkboxRequired', 'Please check the box above to continue') : ''}
          >
            {loading
              ? t('cancellationConfirm.cancelling', 'Cancelling…')
              : t('cancellationConfirm.confirmCancel', 'Confirm cancellation')
            }
          </button>
        </div>

      </div>
    </div>
  );
}
