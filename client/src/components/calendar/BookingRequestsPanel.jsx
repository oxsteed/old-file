import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { toast } from 'sonner';
import { useSocket } from '../../hooks/useSocket';

/**
 * BookingRequestsPanel
 * Displays pending booking requests in a clean, card-based layout.
 * Can be used as an embedded panel in the calendar or as a full-page view.
 *
 * Props:
 *   - compact: boolean (default: true) — shows max 3 requests with scrollable list
 *   - onBookingConfirmed: callback to refresh calendar after confirming
 */
export default function BookingRequestsPanel({ compact = true, onBookingConfirmed }) {
  const { t } = useTranslation();
  const { socket } = useSocket();
  const [bookingRequests, setBookingRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadBookingRequests = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/bookings/incoming');
      setBookingRequests(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (err) {
      console.error('Error loading booking requests:', err);
      toast.error(t('calendar.errorLoadingBookings', { defaultValue: 'Failed to load booking requests' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBookingRequests();
  }, [loadBookingRequests]);

  // Listen for real-time booking updates
  useEffect(() => {
    if (!socket?.connected) return;

    const handleNewBooking = () => {
      loadBookingRequests();
    };

    socket.on('booking:new', handleNewBooking);
    socket.on('booking:updated', handleNewBooking);

    return () => {
      socket.off('booking:new', handleNewBooking);
      socket.off('booking:updated', handleNewBooking);
    };
  }, [socket, loadBookingRequests]);

  const handleConfirmBooking = async (bookingId) => {
    try {
      await api.post(`/bookings/${bookingId}/accept`);
      toast.success(t('calendar.bookingConfirmed', { defaultValue: 'Booking confirmed!' }));
      loadBookingRequests();
      onBookingConfirmed?.();
    } catch (err) {
      console.error('Error confirming booking:', err);
      toast.error(t('calendar.errorConfirmingBooking', { defaultValue: 'Failed to confirm booking' }));
    }
  };

  const handleDeclineBooking = async (bookingId) => {
    try {
      await api.post(`/bookings/${bookingId}/decline`);
      toast.success(t('calendar.bookingDeclined', { defaultValue: 'Booking request declined.' }));
      loadBookingRequests();
    } catch (err) {
      console.error('Error declining booking:', err);
      toast.error(t('calendar.errorDecliningBooking', { defaultValue: 'Failed to decline booking' }));
    }
  };

  if (loading) {
    return (
      <div className="booking-requests-loading">
        <div className="spinner">⟳</div>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (bookingRequests.length === 0) {
    return (
      <div className="booking-requests-empty">
        <div className="empty-icon">📅</div>
        <h3>{t('calendar.noBookingRequests', { defaultValue: 'No booking requests' })}</h3>
        <p>{t('calendar.noBookingRequestsSub', { defaultValue: 'Direct booking requests from customers will appear here.' })}</p>
      </div>
    );
  }

  const displayRequests = compact ? bookingRequests : bookingRequests;

  return (
    <div className="booking-requests-section">
      <div className="booking-requests-header">
        <div>
          <h2>{t('calendar.pendingBookingRequests', { defaultValue: 'Pending Booking Requests' })}</h2>
          <p className="booking-requests-subtitle">
            {t('calendar.requestsWaiting', { count: bookingRequests.length, defaultValue: '{{count}} request(s) waiting' })}
          </p>
        </div>
        <div className="booking-count">{bookingRequests.length}</div>
      </div>

      <div className="booking-requests-list">
        {displayRequests.map((booking) => (
          <BookingRequestCard
            key={booking.id}
            booking={booking}
            onConfirm={() => handleConfirmBooking(booking.id)}
            onDecline={() => handleDeclineBooking(booking.id)}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * BookingRequestCard
 * Individual booking request card with customer info and actions
 */
function BookingRequestCard({ booking, onConfirm, onDecline, t }) {
  const _rawDate = booking.requestedDate || booking.requested_date;
  const requestedDate = _rawDate ? _rawDate.split('T')[0] : null;
  const startTime = booking.requestedStartTime || booking.requested_start_time || booking.start_time;
  const endTime = booking.requestedEndTime || booking.requested_end_time || booking.end_time;

  const startDate = requestedDate
    ? new Date(`${requestedDate}T${startTime || '00:00'}`)
    : null;
  const endDate = requestedDate && endTime
    ? new Date(`${requestedDate}T${endTime}`)
    : null;

  const customerInitial = (booking.customerName || booking.customer_name || '?').charAt(0).toUpperCase();
  const customerDisplayName = booking.customerName || booking.customer_name || t('calendar.unknownCustomer', { defaultValue: 'Unknown Customer' });
  const createdAt = booking.createdAt || booking.created_at;
  const serviceName = booking.serviceName || booking.service_name || booking.serviceType;
  const description = booking.description || booking.notes;

  const formatDateDisplay = (date) => {
    if (!date) return '—';
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTimeDisplay = (time) => {
    if (!time) return '';
    return time;
  };

  return (
    <div className="booking-request-card">
      {/* Header: Customer + Status */}
      <div className="booking-request-header">
        <div className="customer-info">
          {booking.customerAvatar ? (
            <img src={booking.customerAvatar} alt={customerDisplayName} className="avatar avatar-img" />
          ) : (
            <div className="avatar" title={customerDisplayName}>
              {customerInitial}
            </div>
          )}
          <div className="customer-details">
            <h4>{customerDisplayName}</h4>
            <p className="request-time">
              {t('calendar.requestedOn', { defaultValue: 'Requested' })}{' '}
              {createdAt ? new Date(createdAt).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
        <div className="booking-status pending">
          {t('calendar.statusPending', { defaultValue: 'Pending' })}
        </div>
      </div>

      {/* Details: Date, time, service, location, notes */}
      <div className="booking-details">
        {/* Date & Time */}
        <div className="detail-row">
          <span className="detail-label">📅</span>
          <div className="detail-content">
            <div className="detail-value">
              {formatDateDisplay(startDate)}
            </div>
            {startTime && (
              <div className="detail-value detail-time">
                {formatTimeDisplay(startTime)}
                {endTime ? ` – ${formatTimeDisplay(endTime)}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Service */}
        {serviceName && (
          <div className="detail-row">
            <span className="detail-label">🔧</span>
            <div className="detail-value">{serviceName}</div>
          </div>
        )}

        {/* Location */}
        {booking.serviceLocation && (
          <div className="detail-row">
            <span className="detail-label">📍</span>
            <div className="detail-value">{booking.serviceLocation}</div>
          </div>
        )}

        {/* Notes */}
        {description && (
          <div className="detail-row">
            <span className="detail-label">💬</span>
            <div className="detail-value detail-notes">{description}</div>
          </div>
        )}
      </div>

      {/* Actions: Confirm / Decline */}
      <div className="booking-actions">
        <button
          className="btn-confirm"
          onClick={onConfirm}
          title={t('calendar.confirmBooking', { defaultValue: 'Confirm and add to calendar' })}
        >
          ✓ {t('calendar.confirm', { defaultValue: 'Confirm' })}
        </button>
        <button
          className="btn-decline"
          onClick={onDecline}
          title={t('calendar.declineBooking', { defaultValue: 'Decline booking request' })}
        >
          ✕ {t('calendar.decline', { defaultValue: 'Decline' })}
        </button>
      </div>
    </div>
  );
}
