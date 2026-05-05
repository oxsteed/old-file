import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw,
  ChevronDown, MessageSquare
} from 'lucide-react';
import './BookingRequestCard.css';

/**
 * BookingRequestCard Component
 *
 * Displays the status of a booking request:
 * - Pending: Awaiting helper response (with countdown timer to expiry)
 * - Accepted: Helper accepted, ready for next steps
 * - Declined: Helper declined, offer to convert to job posting
 * - Expired: Auto-expired after 24h, offer to convert to job posting
 * - Cancelled: Customer cancelled
 */
export default function BookingRequestCard({ booking, helperName, onConvertToJob }) {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [polling, setPolling] = useState(true);

  // Poll for status updates
  useEffect(() => {
    if (booking.status !== 'pending' || !polling) return;

    const pollInterval = setInterval(() => {
      fetch(`/api/bookings/${booking.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data.status !== 'pending') {
            // Status changed, stop polling
            setPolling(false);
            // Could update parent here with new booking data
          }
        })
        .catch(() => {
          // Continue polling on error
        });
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(pollInterval);
  }, [booking.id, booking.status, polling]);

  // Calculate time remaining until expiry
  useEffect(() => {
    if (booking.status !== 'pending') return;

    const updateCountdown = () => {
      const expiresAt = new Date(booking.expiresAt);
      const now = new Date();
      const diffMs = expiresAt - now;

      if (diffMs <= 0) {
        setTimeRemaining(null);
      } else {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        setTimeRemaining(`${hours}h ${minutes}m`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 60000); // Update every minute

    return () => clearInterval(timer);
  }, [booking.expiresAt, booking.status]);

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'status-pending',
      label: t('booking.statusPending'),
      description: t('booking.statusPendingDesc')
    },
    accepted: {
      icon: CheckCircle,
      color: 'status-accepted',
      label: t('booking.statusAccepted'),
      description: t('booking.statusAcceptedDesc')
    },
    declined: {
      icon: XCircle,
      color: 'status-declined',
      label: t('booking.statusDeclined'),
      description: t('booking.statusDeclinedDesc')
    },
    expired: {
      icon: AlertCircle,
      color: 'status-expired',
      label: t('booking.statusExpired'),
      description: t('booking.statusExpiredDesc')
    },
    cancelled: {
      icon: XCircle,
      color: 'status-cancelled',
      label: t('booking.statusCancelled'),
      description: t('booking.statusCancelledDesc')
    }
  };

  const config = statusConfig[booking.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  const shouldShowConvertOption =
    booking.status === 'declined' ||
    booking.status === 'expired' ||
    booking.status === 'cancelled';

  return (
    <div className="booking-request-card">
      <div className={`booking-status-header ${config.color}`}>
        <StatusIcon size={24} />
        <div className="booking-status-text">
          <h3>{config.label}</h3>
          {booking.status === 'pending' && timeRemaining && (
            <p className="booking-countdown">{t('booking.expiresIn')} {timeRemaining}</p>
          )}
          {booking.helper_response_reason && (
            <p className="booking-reason">{booking.helper_response_reason}</p>
          )}
        </div>
      </div>

      <div className="booking-status-body">
        <p className="booking-status-description">{config.description}</p>

        {/* Booking Details */}
        <div className="booking-details-summary">
          <div className="detail-row">
            <span className="detail-label">{t('booking.service')}:</span>
            <span className="detail-value">{booking.serviceName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.date')}:</span>
            <span className="detail-value">
              {new Date(booking.requestedDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.time')}:</span>
            <span className="detail-value">
              {booking.requestedStartTime} - {booking.requestedEndTime}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.location')}:</span>
            <span className="detail-value">{booking.serviceLocation}</span>
          </div>
        </div>

        {/* Expand Additional Details */}
        {booking.description && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="booking-expand-btn"
          >
            <ChevronDown size={18} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
            {t('booking.additionalDetails')}
          </button>
        )}

        {expanded && booking.description && (
          <div className="booking-description-section">
            <p>{booking.description}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="booking-status-actions">
          {booking.status === 'pending' && (
            <>
              <button className="booking-btn-secondary">
                <MessageSquare size={16} />
                {t('booking.contactHelper')}
              </button>
              <button className="booking-btn-secondary">
                <RefreshCw size={16} />
                {t('booking.refreshStatus')}
              </button>
            </>
          )}

          {booking.status === 'accepted' && (
            <div className="booking-accepted-actions">
              <button className="booking-btn-primary">
                {t('booking.nextSteps')}
              </button>
            </div>
          )}

          {shouldShowConvertOption && (
            <button
              onClick={onConvertToJob}
              className="booking-btn-primary"
            >
              {t('booking.postAsJob')}
            </button>
          )}
        </div>

        {/* Helper Info Card (for accepted bookings) */}
        {booking.status === 'accepted' && (
          <div className="booking-helper-card">
            <h4>{t('booking.nextStepsTitle')}</h4>
            <ul>
              <li>{t('booking.nextStepOne')}</li>
              <li>{t('booking.nextStepTwo')}</li>
              <li>{t('booking.nextStepThree')}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
