import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw,
  ChevronDown,
} from 'lucide-react';
import api from '../../api/axios';
import './BookingRequestCard.css';

function statusDescriptionKey(status) {
  const map = {
    pending: 'booking.statusPendingDesc',
    accepted: 'booking.statusAcceptedDesc',
    declined: 'booking.statusDeclinedDesc',
    expired: 'booking.statusExpiredDesc',
    cancelled: 'booking.statusCancelledDesc',
    accepted_cancelled: 'booking.statusAcceptedCancelledDesc',
  };
  return map[status] || 'booking.statusPendingDesc';
}

/**
 * Booking request status card with optional "Post as public job" when booking failed.
 */
export default function BookingRequestCard({ booking, onConvertToJob }) {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [live, setLive] = useState(booking);

  useEffect(() => {
    setLive(booking);
  }, [booking]);

  useEffect(() => {
    if (live.status !== 'pending') return;

    const pollInterval = setInterval(() => {
      api
        .get(`/bookings/${live.id}`)
        .then((res) => {
          const data = res.data?.data;
          if (data && data.status !== live.status) {
            setLive(data);
          }
        })
        .catch(() => {});
    }, 8000);

    return () => clearInterval(pollInterval);
  }, [live.id, live.status]);

  useEffect(() => {
    if (live.status !== 'pending') return;

    const updateCountdown = () => {
      const expiresAt = new Date(live.expiresAt);
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
    const timer = setInterval(updateCountdown, 60000);

    return () => clearInterval(timer);
  }, [live.expiresAt, live.status]);

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'status-pending',
      label: t('booking.statusPending'),
    },
    accepted: {
      icon: CheckCircle,
      color: 'status-accepted',
      label: t('booking.statusAccepted'),
    },
    declined: {
      icon: XCircle,
      color: 'status-declined',
      label: t('booking.statusDeclined'),
    },
    expired: {
      icon: AlertCircle,
      color: 'status-expired',
      label: t('booking.statusExpired'),
    },
    cancelled: {
      icon: XCircle,
      color: 'status-cancelled',
      label: t('booking.statusCancelled'),
    },
    accepted_cancelled: {
      icon: XCircle,
      color: 'status-declined',
      label: t('booking.statusAcceptedCancelled'),
    },
  };

  const config = statusConfig[live.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  const shouldShowConvertOption =
    live.status === 'declined' ||
    live.status === 'expired' ||
    live.status === 'cancelled' ||
    live.status === 'accepted_cancelled';

  const refresh = () => {
    api.get(`/bookings/${live.id}`).then((res) => {
      if (res.data?.data) setLive(res.data.data);
    });
  };

  return (
    <div className="booking-request-card">
      <div className={`booking-status-header ${config.color}`}>
        <StatusIcon size={24} />
        <div className="booking-status-text">
          <h3>{config.label}</h3>
          {live.status === 'pending' && timeRemaining && (
            <p className="booking-countdown">
              {t('booking.expiresIn')} {timeRemaining}
            </p>
          )}
          {live.helperResponseReason && (
            <p className="booking-reason">{live.helperResponseReason}</p>
          )}
        </div>
      </div>

      <div className="booking-status-body">
        <p className="booking-status-description">{t(statusDescriptionKey(live.status))}</p>

        <div className="booking-details-summary">
          <div className="detail-row">
            <span className="detail-label">{t('booking.service')}:</span>
            <span className="detail-value">{live.serviceName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.date')}:</span>
            <span className="detail-value">
              {new Date(live.requestedDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.time')}:</span>
            <span className="detail-value">
              {live.requestedStartTime} - {live.requestedEndTime}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.location')}:</span>
            <span className="detail-value">{live.serviceLocation}</span>
          </div>
          {live.confirmationHours != null && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.confirmationWindowShort')}:</span>
              <span className="detail-value">
                {t('booking.hoursCount', { count: live.confirmationHours })}
              </span>
            </div>
          )}
        </div>

        {live.description && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="booking-expand-btn">
            <ChevronDown size={18} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
            {t('booking.additionalDetails')}
          </button>
        )}

        {expanded && live.description && (
          <div className="booking-description-section">
            <p>{live.description}</p>
          </div>
        )}

        <div className="booking-status-actions">
          {live.status === 'pending' && (
            <>
              <Link
                className="booking-btn-secondary"
                to={`/messages?helperId=${encodeURIComponent(live.helperId)}`}
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {t('booking.contactHelper')}
              </Link>
              <button type="button" className="booking-btn-secondary" onClick={refresh}>
                <RefreshCw size={16} />
                {t('booking.refreshStatus')}
              </button>
            </>
          )}

          {live.status === 'accepted' && (
            <div className="booking-accepted-actions">
              <Link to="/calendar" className="booking-btn-primary" style={{ textDecoration: 'none' }}>
                {t('booking.viewCalendar')}
              </Link>
            </div>
          )}

          {shouldShowConvertOption && (
            <button type="button" onClick={onConvertToJob} className="booking-btn-primary">
              {t('booking.postAsJob')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
