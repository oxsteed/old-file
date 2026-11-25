import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import { toast } from 'sonner';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../hooks/useAuth';
import BookingRescheduleBox from './BookingRescheduleBox';
import MessengerAvailabilityPicker from '../helperProfile/chat/MessengerAvailabilityPicker';
import { buildProposeBookingPayload } from '../helperProfile/chat/messengerBookingRequests.js';
import '../helperProfile/chat/MessengerDock.css';

/**
 * BookingRequestsPanel — thin client over shared /bookings/incoming +
 * accept / decline / counter-propose (provider).
 * Shows pending + counter_proposed (messenger + calendar origins).
 */
export default function BookingRequestsPanel({ compact = true, onBookingConfirmed }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const { socket } = useSocket();
  const { user } = useAuth();
  const [bookingRequests, setBookingRequests] = useState([]);
  const [acceptedBookings, setAcceptedBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proposingBooking, setProposingBooking] = useState(null);
  // G-37: transfer drafts for accepted bookings (new provider id + reason).
  const [transferDrafts, setTransferDrafts] = useState({});
  const [transferringId, setTransferringId] = useState(null);
  // Per-row acting state: while a confirm/decline POST is in flight the row's
  // buttons are disabled (double-click cannot double-fire a money-adjacent accept).
  const [acting, setActing] = useState(null); // { id, kind: 'confirm' | 'decline' } | null
  const actingRef = useRef(null); // synchronous guard closing the re-render race window

  const loadBookingRequests = useCallback(async () => {
    setLoading(true);
    try {
      // Default server inbox = pending + counter_proposed
      const [incoming, accepted] = await Promise.all([
        api.get('/bookings/incoming'),
        // G-37: accepted bookings live here too, so the provider can hand
        // one to another eligible provider instead of cancelling it.
        api.get('/bookings/incoming', { params: { statuses: 'accepted' } }),
      ]);
      setBookingRequests(Array.isArray(incoming.data?.data) ? incoming.data.data : []);
      setAcceptedBookings(Array.isArray(accepted.data?.data) ? accepted.data.data : []);
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

  useEffect(() => {
    if (!socket) return undefined;

    const handleRefresh = () => {
      loadBookingRequests();
    };

    socket.on('booking:new', handleRefresh);
    socket.on('booking:updated', handleRefresh);
    socket.on('booking:chat_updated', handleRefresh);

    return () => {
      socket.off('booking:new', handleRefresh);
      socket.off('booking:updated', handleRefresh);
      socket.off('booking:chat_updated', handleRefresh);
    };
  }, [socket, loadBookingRequests]);

  const handleConfirmBooking = async (bookingId) => {
    if (actingRef.current) return;
    actingRef.current = bookingId;
    setActing({ id: bookingId, kind: 'confirm' });
    try {
      await api.post(`/bookings/${bookingId}/accept`);
      toast.success(t('calendar.bookingConfirmed', { defaultValue: 'Booking confirmed!' }));
      loadBookingRequests();
      onBookingConfirmed?.();
    } catch (err) {
      console.error('Error confirming booking:', err);
      toast.error(t('calendar.errorConfirmingBooking', { defaultValue: 'Failed to confirm booking' }));
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };

  const handleDeclineBooking = async (bookingId) => {
    if (actingRef.current) return;
    actingRef.current = bookingId;
    setActing({ id: bookingId, kind: 'decline' });
    try {
      await api.post(`/bookings/${bookingId}/decline`);
      toast.success(t('calendar.bookingDeclined', { defaultValue: 'Booking request declined.' }));
      loadBookingRequests();
      onBookingConfirmed?.();
    } catch (err) {
      console.error('Error declining booking:', err);
      toast.error(t('calendar.errorDecliningBooking', { defaultValue: 'Failed to decline booking' }));
    } finally {
      actingRef.current = null;
      setActing(null);
    }
  };

  // G-37: hand an accepted booking to another eligible provider. The
  // booking, its deposit, and its appointment are preserved; only the
  // provider moves. The server validates the target and fails closed.
  const handleTransferBooking = async (bookingId) => {
    const draft = transferDrafts[bookingId] || {};
    const newHelperId = String(draft.newHelperId || '').trim();
    if (!newHelperId) {
      toast.error(t('calendar.transferProviderRequired'));
      return;
    }
    if (transferringId) return;
    setTransferringId(bookingId);
    try {
      await api.post(`/bookings/${bookingId}/transfer`, {
        newHelperId,
        reason: String(draft.reason || '').trim() || undefined,
      });
      toast.success(t('calendar.bookingTransferred'));
      setTransferDrafts((current) => {
        const next = { ...current };
        delete next[bookingId];
        return next;
      });
      loadBookingRequests();
      onBookingConfirmed?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('calendar.errorTransferringBooking'));
    } finally {
      setTransferringId(null);
    }
  };

  const handleProposeSlot = async (slot) => {
    if (!proposingBooking?.id) return;
    const bookingId = proposingBooking.id;
    try {
      const payload = buildProposeBookingPayload(slot) || {
        requestedDate: slot.date,
        requestedStartTime: String(slot.start).length === 5 ? `${slot.start}:00` : slot.start,
        requestedEndTime: String(slot.end).length === 5 ? `${slot.end}:00` : slot.end,
        startIso: slot.startIso,
        endIso: slot.endIso,
        timezone: slot.timezone,
      };
      await api.post(`/bookings/${bookingId}/counter-propose`, payload);
      toast.success(
        t('calendar.bookingCounterProposed', {
          defaultValue: 'Different time proposed to the customer.',
        }),
      );
      setProposingBooking(null);
      loadBookingRequests();
      onBookingConfirmed?.();
    } catch (err) {
      console.error('Error counter-proposing booking:', err);
      toast.error(
        t('calendar.errorCounterProposing', {
          defaultValue: 'Failed to propose a different time',
        }),
      );
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

  if (bookingRequests.length === 0 && acceptedBookings.length === 0) {
    return (
      <div className="booking-requests-empty">
        <div className="empty-icon">📅</div>
        <h3>{t('calendar.noBookingRequests', { defaultValue: 'No booking requests' })}</h3>
        <p>
          {t('calendar.noBookingRequestsSub', {
            defaultValue: 'Direct booking requests from customers will appear here.',
          })}
        </p>
      </div>
    );
  }

  const displayRequests = compact ? bookingRequests.slice(0, 8) : bookingRequests;
  const displayAccepted = compact ? acceptedBookings.slice(0, 8) : acceptedBookings;

  return (
    <div className={`booking-requests-section${compact ? ' compact' : ''}`}>
      <div className="booking-requests-header">
        <div>
          <h2>{t('calendar.pendingBookingRequests', { defaultValue: 'Pending Booking Requests' })}</h2>
          <p className="booking-requests-subtitle">
            {t('calendar.requestsWaiting', {
              count: bookingRequests.length,
              defaultValue: '{{count}} request(s) waiting',
            })}
          </p>
        </div>
        <div className="booking-count">{bookingRequests.length}</div>
      </div>

      <div className="booking-requests-list">
        {displayRequests.map((booking) => (
          <CalendarBookingRequestCard
            key={booking.id}
            booking={booking}
            acting={acting && acting.id === booking.id ? acting.kind : null}
            onConfirm={() => handleConfirmBooking(booking.id)}
            onDecline={() => handleDeclineBooking(booking.id)}
            onPropose={() => setProposingBooking(booking)}
            t={t}
            locale={locale}
          />
        ))}
      </div>

      {displayAccepted.length > 0 ? (
        <>
          <div className="booking-requests-header">
            <div>
              <h2>{t('calendar.acceptedBookings')}</h2>
              <p className="booking-requests-subtitle">
                {t('calendar.acceptedBookingsSub')}
              </p>
            </div>
            <div className="booking-count">{acceptedBookings.length}</div>
          </div>
          <div className="booking-requests-list">
            {displayAccepted.map((booking) => (
              <CalendarBookingRequestCard
                key={booking.id}
                booking={booking}
                acting={null}
                // G5-2: transfer follows the manager gate, not the read gate.
                // The server 403s a non-manager member; hide the action too,
                // like Confirm/Decline are hidden when canRespond is false.
                onTransfer={booking.canRespond === false ? undefined : () => handleTransferBooking(booking.id)}
                rescheduleProposal={booking.pendingRescheduleProposal || null}
                currentUserId={user?.id}
                onRescheduleDone={loadBookingRequests}
                transferDraft={transferDrafts[booking.id] || {}}
                onTransferDraftChange={(patch) =>
                  setTransferDrafts((current) => ({
                    ...current,
                    [booking.id]: { ...(current[booking.id] || {}), ...patch },
                  }))
                }
                transferring={transferringId === booking.id}
                t={t}
                locale={locale}
              />
            ))}
          </div>
        </>
      ) : null}

      {proposingBooking ? (
        <div className="booking-propose-picker-wrap">
          <MessengerAvailabilityPicker
            helperId={proposingBooking.helperId || proposingBooking.helper_id || null}
            businessId={proposingBooking.businessId || proposingBooking.business_id || null}
            open
            onClose={() => setProposingBooking(null)}
            onSelectSlot={handleProposeSlot}
          />
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status, t) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'counter_proposed') {
    return t('calendar.statusCounterProposed', { defaultValue: 'Counter proposed' });
  }
  if (s === 'expired') {
    return t('calendar.statusExpired', { defaultValue: 'Expired' });
  }
  return t('calendar.statusPending', { defaultValue: 'Pending' });
}

function statusClass(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'counter_proposed') return 'counter_proposed';
  if (s === 'expired') return 'expired';
  return 'pending';
}

function CalendarBookingRequestCard({ booking, acting, onConfirm, onDecline, onPropose, onTransfer, transferDraft, onTransferDraftChange, transferring, rescheduleProposal, currentUserId, onRescheduleDone, t, locale }) {
  const _rawDate = booking.requestedDate || booking.requested_date;
  const requestedDate = _rawDate ? String(_rawDate).split('T')[0] : null;
  const startTime = booking.requestedStartTime || booking.requested_start_time || booking.start_time;
  const endTime = booking.requestedEndTime || booking.requested_end_time || booking.end_time;

  const startDate = requestedDate ? new Date(`${requestedDate}T${startTime || '00:00'}`) : null;

  const customerInitial = (booking.customerName || booking.customer_name || '?').charAt(0).toUpperCase();
  const customerDisplayName =
    booking.customerName ||
    booking.customer_name ||
    (booking.guestSessionId || booking.guest_session_id
      ? t('calendar.guestCustomer', { defaultValue: 'Guest' })
      : t('calendar.unknownCustomer', { defaultValue: 'Unknown Customer' }));
  const createdAt = booking.createdAt || booking.created_at;
  const serviceName = booking.serviceName || booking.service_name || booking.serviceType;
  const description = booking.description || booking.notes;
  const status = booking.status || 'pending';
  const conversationId = booking.conversationId || booking.conversation_id;
  const source = booking.source || 'direct';
  const canRespond = booking.canRespond !== false;
  const canPropose = canRespond && (booking.helperId || booking.helper_id || booking.businessId || booking.business_id);

  const formatDateDisplay = (date) => {
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTimeDisplay = (time) => {
    if (!time) return '';
    return String(time).slice(0, 5);
  };

  return (
    <div className={`booking-request-card status-${statusClass(status)}`}>
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
              {createdAt ? new Date(createdAt).toLocaleDateString(locale) : '—'}
              {source && source !== 'direct' && source !== 'calendar' ? (
                <span className="booking-source"> · {source}</span>
              ) : null}
            </p>
          </div>
        </div>
        <div className={`booking-status ${statusClass(status)}`}>{statusLabel(status, t)}</div>
      </div>

      <div className="booking-details">
        <div className="detail-row">
          <span className="detail-label">📅</span>
          <div className="detail-content">
            <div className="detail-value">{formatDateDisplay(startDate)}</div>
            {startTime && (
              <div className="detail-value detail-time">
                {formatTimeDisplay(startTime)}
                {endTime ? ` – ${formatTimeDisplay(endTime)}` : ''}
              </div>
            )}
          </div>
        </div>

        {serviceName && (
          <div className="detail-row">
            <span className="detail-label">🔧</span>
            <div className="detail-value">{serviceName}</div>
          </div>
        )}

        {(booking.serviceLocation || booking.service_location) && (
          <div className="detail-row">
            <span className="detail-label">📍</span>
            <div className="detail-value">
              {booking.serviceLocation || booking.service_location}
            </div>
          </div>
        )}

        {description && (
          <div className="detail-row">
            <span className="detail-label">💬</span>
            <div className="detail-value detail-notes">{description}</div>
          </div>
        )}

        {conversationId && (
          <div className="detail-row booking-conversation-link">
            <span className="detail-label">✉️</span>
            <div className="detail-value">
              <Link to={`/messages/${conversationId}`}>
                {t('calendar.openConversation', { defaultValue: 'Open conversation' })}
              </Link>
            </div>
          </div>
        )}
      </div>

      {onTransfer ? (
        <>
          <div className="booking-actions booking-transfer-actions">
            <input
              type="text"
              value={transferDraft?.newHelperId || ''}
              onChange={(e) => onTransferDraftChange?.({ newHelperId: e.target.value })}
              placeholder={t('calendar.transferProviderPlaceholder')}
              aria-label={t('calendar.transferProviderPlaceholder')}
              disabled={!!transferring}
            />
          <input
            type="text"
            value={transferDraft?.reason || ''}
            onChange={(e) => onTransferDraftChange?.({ reason: e.target.value })}
            placeholder={t('calendar.transferReasonPlaceholder')}
            aria-label={t('calendar.transferReasonPlaceholder')}
            disabled={!!transferring}
          />
          <button
            type="button"
            className="btn-confirm"
            onClick={onTransfer}
            disabled={!!transferring || !(transferDraft?.newHelperId || '').trim()}
            title={t('calendar.transferBooking')} data-track="ui.79e8a0a062.4"
          >
            {transferring
              ? t('calendar.transferringBooking')
              : t('calendar.transfer')}
          </button>
          <p className="booking-transfer-hint">
            {t('calendar.transferHint')}
          </p>
          </div>
          <BookingRescheduleBox
            bookingId={booking.id}
            proposal={rescheduleProposal || null}
            currentUserId={currentUserId}
            onDone={onRescheduleDone}
          />
        </>
      ) : canRespond ? (
        <div className="booking-actions">
          <button
            type="button"
            className="btn-confirm"
            onClick={onConfirm}
            disabled={!!acting}
            title={t('calendar.confirmBooking', { defaultValue: 'Confirm and add to calendar' })} data-track="ui.79e8a0a062.1"
          >
            ✓{' '}
            {acting === 'confirm'
              ? t('calendar.confirmingBooking', { defaultValue: 'Confirming...' })
              : t('calendar.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button
            type="button"
            className="btn-decline"
            onClick={onDecline}
            disabled={!!acting}
            title={t('calendar.declineBooking', { defaultValue: 'Decline booking request' })} data-track="ui.79e8a0a062.2"
          >
            ✕{' '}
            {acting === 'decline'
              ? t('calendar.decliningBooking', { defaultValue: 'Declining...' })
              : t('calendar.decline', { defaultValue: 'Decline' })}
          </button>
          {canPropose ? (
            <button
              type="button"
              className="btn-propose"
              onClick={onPropose}
              title={t('calendar.proposeDifferentTime', {
                defaultValue: 'Propose a different time',
              })} data-track="ui.79e8a0a062.3"
            >
              ↻ {t('calendar.proposeTime', { defaultValue: 'Propose different time' })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
