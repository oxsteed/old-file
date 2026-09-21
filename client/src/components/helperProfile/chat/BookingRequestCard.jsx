import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, X, Loader2, MessageSquare, Clock } from 'lucide-react';
import api from '../../../api/axios';
import {
  canCustomerRespondBooking,
  canProviderRespondBooking,
  parseBookingRequestMarker,
  toBookingChatStatus,
} from './messengerBookingRequests.js';
import './MessengerDock.css';

/**
 * In-thread booking request card —
 * Provider: Accept / Decline / Propose on pending|counter_proposed|expired.
 * Customer/guest: Accept / Decline on counter_proposed (provider-proposed time).
 */
export default function BookingRequestCard({
  markerText,
  initialBooking = null,
  bookingId: idProp,
  isProvider = false,
  isAuthenticated = false,
  guestVerified = false,
  guestAuthHeaders = null,
  onRequestVerify,
  conversationId = null,
  onStatusChange,
  onAccepted,
  onDeclined,
  onProposeTime,
  compact = false,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';

  const parsed = useMemo(
    () => (markerText ? parseBookingRequestMarker(markerText) : null),
    [markerText],
  );

  const bookingId = idProp || parsed?.id || initialBooking?.id;

  const [booking, setBooking] = useState(initialBooking);
  const [loading, setLoading] = useState(!initialBooking && Boolean(bookingId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/chat/booking-requests/${bookingId}`, {
        headers: guestAuthHeaders || undefined,
      });
      setBooking(data);
    } catch (err) {
      if (parsed) {
        setBooking({
          id: parsed.id,
          status: parsed.status,
          service_name: parsed.serviceName,
          service_id: parsed.serviceId,
          requested_date: parsed.date,
          requested_start_time: parsed.start,
          requested_end_time: parsed.end,
        });
      } else {
        setError(t('helperProfile.messenger.bookingLoadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [bookingId, parsed, t, guestAuthHeaders]);

  useEffect(() => {
    if (!initialBooking) load();
  }, [initialBooking, load]);

  useEffect(() => {
    if (!bookingId || typeof window === 'undefined') return undefined;
    const handler = (evt) => {
      const detail = evt?.detail;
      if (!detail) return;
      const id = detail.bookingId || detail.booking?.id;
      if (String(id) !== String(bookingId)) return;
      if (detail.booking) setBooking(detail.booking);
      else load();
    };
    window.addEventListener('oxs:booking-chat-updated', handler);
    return () => window.removeEventListener('oxs:booking-chat-updated', handler);
  }, [bookingId, load]);

  const status = toBookingChatStatus(booking?.status || parsed?.status);
  const canProviderAct = isProvider && canProviderRespondBooking(status);
  const canCustomerAct =
    !isProvider
    && canCustomerRespondBooking(status)
    && (isAuthenticated || guestVerified || Boolean(guestAuthHeaders));
  const canCustomerActNeedsVerify =
    !isProvider
    && canCustomerRespondBooking(status)
    && !isAuthenticated
    && !guestVerified
    && !guestAuthHeaders;
  const canRespond = canProviderAct || canCustomerAct;

  const respond = async (action) => {
    if (!bookingId) return;
    if (!isProvider && !isAuthenticated && !guestVerified && !guestAuthHeaders) {
      onRequestVerify?.();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let endpoint;
      if (isProvider) {
        endpoint = action === 'accept' ? 'accept' : 'decline';
      } else {
        endpoint = action === 'accept' ? 'customer-accept' : 'customer-decline';
      }
      const { data } = await api.post(
        `/chat/booking-requests/${bookingId}/${endpoint}`,
        {
          reason: action === 'decline' ? reason || undefined : undefined,
          decline_reason: action === 'decline' ? reason || undefined : undefined,
        },
        { headers: guestAuthHeaders || undefined },
      );
      const next = data.booking || {
        ...booking,
        status: action === 'accept' ? 'accepted' : 'declined',
      };
      setBooking(next);
      onStatusChange?.(next.status, data);
      if (action === 'accept') onAccepted?.(data);
      else onDeclined?.(data);
      setShowReason(false);
    } catch (err) {
      const code = err?.response?.data?.code;
      setError(
        err?.response?.data?.error
          || (code === 'already_accepted'
            ? t('helperProfile.messenger.bookingAlreadyAccepted')
            : t('helperProfile.messenger.bookingRespondError')),
      );
      if (code === 'already_accepted' || code === 'already_declined' || code === 'invalid_status') {
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="messenger-booking-card messenger-booking-card--loading" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        <span>{t('helperProfile.messenger.bookingLoading')}</span>
      </div>
    );
  }

  if (!booking && !parsed) return null;

  const title =
    booking?.service_name
    || parsed?.serviceName
    || t('helperProfile.messenger.bookingFallbackTitle');
  const date = booking?.requested_date || parsed?.date || '';
  const start = booking?.requested_start_time || parsed?.start || '';
  const end = booking?.requested_end_time || parsed?.end || '';

  let whenLabel = `${date} ${start}–${end}`;
  try {
    const [y, m, d] = String(date).split('-').map(Number);
    const startDate = new Date(y, (m || 1) - 1, d || 1, ...String(start).split(':').map(Number));
    const endDate = new Date(y, (m || 1) - 1, d || 1, ...String(end).split(':').map(Number));
    const dayPart = startDate.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startPart = startDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const endPart = endDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    whenLabel = `${dayPart} · ${startPart} – ${endPart}`;
  } catch {
    /* keep fallback */
  }

  const statusLabel = t(`helperProfile.messenger.bookingStatus.${status}`, {
    defaultValue: status,
  });

  return (
    <div
      className={`messenger-booking-card${compact ? ' messenger-booking-card--compact' : ''}`}
      data-status={status}
      role="article"
      aria-label={t('helperProfile.messenger.bookingCardAria', { title })}
    >
      <header className="messenger-booking-card__head">
        <div>
          <p className="messenger-booking-card__eyebrow">
            {t('helperProfile.messenger.bookingEyebrow')}
          </p>
          <h4 className="messenger-booking-card__title">{title}</h4>
        </div>
        <span className={`messenger-booking-card__badge messenger-booking-card__badge--${status}`}>
          {statusLabel}
        </span>
      </header>

      <div className="messenger-booking-card__when">
        <Clock className="w-3.5 h-3.5" aria-hidden />
        <span>{whenLabel}</span>
      </div>

      {booking?.helper_response_reason && (status === 'declined' || status === 'counter_proposed') ? (
        <p className="messenger-booking-card__note">
          {booking.helper_response_reason}
        </p>
      ) : null}

      {error ? <p className="messenger-booking-card__error">{error}</p> : null}

      {canRespond ? (
        <div className="messenger-booking-card__actions">
          <button
            type="button"
            className="messenger-booking-card__btn messenger-booking-card__btn--primary"
            disabled={busy}
            onClick={() => respond('accept')}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Check className="w-3.5 h-3.5" aria-hidden />}
            {t('helperProfile.messenger.bookingAccept')}
          </button>
          <button
            type="button"
            className="messenger-booking-card__btn messenger-booking-card__btn--secondary"
            disabled={busy}
            onClick={() => setShowReason((v) => !v)}
          >
            <X className="w-3.5 h-3.5" aria-hidden />
            {t('helperProfile.messenger.bookingDecline')}
          </button>
          {canProviderAct && typeof onProposeTime === 'function' ? (
            <button
              type="button"
              className="messenger-booking-card__btn messenger-booking-card__btn--ghost"
              disabled={busy}
              onClick={() => onProposeTime({ booking, conversationId })}
            >
              <Calendar className="w-3.5 h-3.5" aria-hidden />
              {t('helperProfile.messenger.bookingProposeTime')}
            </button>
          ) : null}
        </div>
      ) : null}

      {canCustomerActNeedsVerify ? (
        <div className="messenger-booking-card__actions">
          <button
            type="button"
            className="messenger-booking-card__btn messenger-booking-card__btn--primary"
            onClick={() => onRequestVerify?.()}
          >
            {t('helperProfile.messenger.bookingVerifyToRespond')}
          </button>
        </div>
      ) : null}

      {showReason && canRespond ? (
        <div className="messenger-booking-card__reason">
          <label htmlFor={`booking-decline-${bookingId}`}>
            <MessageSquare className="w-3.5 h-3.5 inline" aria-hidden />{' '}
            {t('helperProfile.messenger.bookingDeclineReason')}
          </label>
          <textarea
            id={`booking-decline-${bookingId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('helperProfile.messenger.bookingDeclinePlaceholder')}
          />
          <button
            type="button"
            className="messenger-booking-card__btn messenger-booking-card__btn--secondary"
            disabled={busy}
            onClick={() => respond('decline')}
          >
            {t('helperProfile.messenger.bookingConfirmDecline')}
          </button>
        </div>
      ) : null}

      {!isProvider && status === 'pending' ? (
        <p className="messenger-booking-card__hint">
          {t('helperProfile.messenger.bookingCustomerPending')}
        </p>
      ) : null}
      {!isProvider && status === 'accepted' ? (
        <p className="messenger-booking-card__hint messenger-booking-card__hint--ok">
          {t('helperProfile.messenger.bookingCustomerAccepted')}
        </p>
      ) : null}
      {!isProvider && status === 'declined' ? (
        <p className="messenger-booking-card__hint messenger-booking-card__hint--bad">
          {t('helperProfile.messenger.bookingCustomerDeclined')}
        </p>
      ) : null}
      {!isProvider && status === 'counter_proposed' && !canRespond && !canCustomerActNeedsVerify ? (
        <p className="messenger-booking-card__hint">
          {t('helperProfile.messenger.bookingCustomerCounter')}
        </p>
      ) : null}
      {!isProvider && status === 'counter_proposed' && (canRespond || canCustomerActNeedsVerify) ? (
        <p className="messenger-booking-card__hint">
          {t('helperProfile.messenger.bookingCustomerCounterAction')}
        </p>
      ) : null}
    </div>
  );
}
