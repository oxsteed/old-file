import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Calendar, Clock, MapPin, FileText, AlertCircle } from 'lucide-react';
import { buildBookingIcs, downloadIcs } from '../../utils/calendarExport';
import './BookingConfirmation.css';

function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getDeadlineLimitHours(dateStr, timeStr) {
  if (!dateStr) return 168;
  const target = new Date(`${dateStr}T${timeStr || '23:59'}:00`);
  if (Number.isNaN(target.getTime())) return 168;
  const hours = Math.floor((target.getTime() - Date.now()) / (60 * 60 * 1000));
  return Math.max(1, Math.min(168, hours));
}

/**
 * BookingConfirmation Component
 *
 * Shows a summary of the booking request for the customer to review and confirm
 */
export default function BookingConfirmation({
  bookingData,
  helperName,
  onConfirm,
  onBack,
  loading,
  initialAgreed = false,
  initialRecipientName = '',
  initialRecipientPhone = '',
  onAgreementChange,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [agreed, setAgreed] = useState(initialAgreed);
  const [confirmationHours, setConfirmationHours] = useState(24);
  // G-6: book for another person (recipient name + phone, no account needed).
  // Wave 4, item 64: a household template prefill names the recipient.
  const [forSomeoneElse, setForSomeoneElse] = useState(Boolean(initialRecipientName));
  const [recipientName, setRecipientName] = useState(initialRecipientName);
  const [recipientPhone, setRecipientPhone] = useState(initialRecipientPhone);
  // G-6: an email links an existing OxSteed account as the recipient, so
  // they get the invite in-app instead of only through a shared link.
  const [recipientEmail, setRecipientEmail] = useState('');
  // G-7: site contact who coordinates arrival on site.
  const [siteContactName, setSiteContactName] = useState('');
  const [siteContactPhone, setSiteContactPhone] = useState('');
  const [siteContactEmail, setSiteContactEmail] = useState('');
  const deadlineLimitHours = useMemo(
    () => getDeadlineLimitHours(bookingData.requestedDate, bookingData.requestedStartTime),
    [bookingData.requestedDate, bookingData.requestedStartTime],
  );
  const deadlineOptions = useMemo(
    () => [...new Set([
      ...[6, 12, 24, 48, 72, 96, 120, 168].filter((hours) => hours <= deadlineLimitHours),
      deadlineLimitHours,
    ])].sort((a, b) => a - b),
    [deadlineLimitHours],
  );
  const effectiveConfirmationHours = Math.min(
    deadlineLimitHours,
    Math.max(1, Number(confirmationHours) || 1),
  );

  useEffect(() => {
    setConfirmationHours((current) => Math.min(deadlineLimitHours, Math.max(1, Number(current) || 1)));
  }, [deadlineLimitHours]);

  const handleConfirm = () => {
    if (!agreed) {
      toast.error(t('booking.agreementRequired'));
      return;
    }

    onConfirm({
      ...bookingData,
      confirmationHours: effectiveConfirmationHours,
      recipientName: forSomeoneElse ? recipientName.trim() || undefined : undefined,
      recipientPhone: forSomeoneElse ? recipientPhone.trim() || undefined : undefined,
      recipientEmail: forSomeoneElse ? recipientEmail.trim() || undefined : undefined,
      siteContactName: siteContactName.trim() || undefined,
      siteContactPhone: siteContactPhone.trim() || undefined,
      siteContactEmail: siteContactEmail.trim() || undefined,
    });
  };

  const formatDate = (dateStr) => {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="booking-confirmation">
      <div className="booking-confirmation-content">
        <h3>{t('booking.confirmationTitle')}</h3>

        {/* Booking Summary */}
        <div className="booking-summary">
          <div className="summary-item">
            <Calendar size={20} />
            <div>
              <span className="summary-label">{t('booking.date')}</span>
              <span className="summary-value">
                {formatDate(bookingData.requestedDate)}
              </span>
            </div>
          </div>

          <div className="summary-item">
            <Clock size={20} />
            <div>
              <span className="summary-label">{t('booking.time')}</span>
              <span className="summary-value">
                {bookingData.availabilityMode === 'request_only'
                  ? t('booking.flexibleTime')
                  : `${formatTime(bookingData.requestedStartTime)} – ${formatTime(bookingData.requestedEndTime)}`}
              </span>
            </div>
          </div>

          <div className="summary-item">
            <MapPin size={20} />
            <div>
              <span className="summary-label">{t('booking.location')}</span>
              <span className="summary-value">
                {bookingData.serviceLocation}
              </span>
            </div>
          </div>

          <div className="summary-item">
            <FileText size={20} />
            <div>
              <span className="summary-label">{t('booking.service')}</span>
              <span className="summary-value">
                {bookingData.serviceName}
              </span>
            </div>
          </div>
        </div>

        {/* Group 1, item 13: calendar export at booking time. The booking
            does not exist yet, so the .ics is built on the client from the
            draft; request-only drafts have no concrete time and get no
            button instead of a guessed event. */}
        {buildBookingIcs(bookingData) && (
          <button
            type="button"
            onClick={() => {
              const ics = buildBookingIcs(bookingData);
              if (ics) downloadIcs('oxsteed-booking.ics', ics);
            }}
            className="booking-btn-secondary"
            data-track="ui.98ea5ee9e6.5"
          >
            {t('booking.addToCalendar')}
          </button>
        )}

        {/* Description */}
        {bookingData.description && (
          <div className="booking-description">
            <h4>{t('booking.additionalNotes')}</h4>
            <p>{bookingData.description}</p>
          </div>
        )}

        {bookingData.availabilityMode === 'request_only' && (
          <div className="booking-fallback-summary">
            <strong>{t('booking.noScheduleTitle')}</strong>
            <p>{bookingData.autoPostOnExpiry ? t('booking.autoPostSummary', { hours: effectiveConfirmationHours }) : t('booking.expireSummary', { hours: effectiveConfirmationHours })}</p>
          </div>
        )}

        {/* Important Info */}
        <div className="booking-info-box">
          <AlertCircle size={18} />
          <div>
            <h4>{t('booking.importantToKnow')}</h4>
            <ul>
              <li>{t('booking.infoWaitingForResponse', { hours: effectiveConfirmationHours })}</li>
              <li>{t('booking.infoHelperCanDecline')}</li>
              <li>{t('booking.infoCanConvertToJob')}</li>
            </ul>
          </div>
        </div>

        <div className="booking-form-group" style={{ marginTop: '1rem' }}>
          <label htmlFor="booking-confirm-hours">{t('booking.confirmationWindowLabel')}</label>
          <select
            id="booking-confirm-hours"
            className="booking-input"
            value={confirmationHours}
            onChange={(e) => setConfirmationHours(Number(e.target.value))}
            min="1"
            max={deadlineLimitHours}
          >
            {deadlineOptions.map((h) => (
              <option key={h} value={h}>
                {t('booking.hoursCount', { count: h })}
              </option>
            ))}
          </select>
          <div className="booking-deadline-custom">
            <span>{t('booking.customDeadline')}</span>
            <input
              type="number"
              min="1"
              max={deadlineLimitHours}
              value={confirmationHours}
              onChange={(e) => setConfirmationHours(Number(e.target.value))}
              aria-label={t('booking.customDeadline')}
            />
            <span>{t('booking.hourLabel')}</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted-text)', marginTop: '0.35rem' }}>
            {t('booking.deadlineHint', { hours: deadlineLimitHours })}
          </p>
        </div>

        {/* G-6: book for another person. The booker pays; the recipient is
            who the work is for and can view and cancel the booking. */}
        <div className="booking-form-group" style={{ marginTop: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={forSomeoneElse}
              onChange={(e) => setForSomeoneElse(e.target.checked)} data-track="ui.98ea5ee9e6.4"
            />
            <span>{t('booking.bookForSomeoneElse')}</span>
          </label>
          {forSomeoneElse && (
            <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.5rem' }}>
              <input
                type="text"
                className="booking-input"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder={t('booking.recipientNamePlaceholder')}
                aria-label={t('booking.recipientName')}
                maxLength={200}
              />
              <input
                type="tel"
                className="booking-input"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder={t('booking.recipientPhonePlaceholder')}
                aria-label={t('booking.recipientPhone')}
                maxLength={40}
              />
              <input
                type="email"
                className="booking-input"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder={t('booking.recipientEmailPlaceholder')}
                aria-label={t('booking.recipientEmail')}
                maxLength={200}
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-text)' }}>
                {t('booking.bookForSomeoneElseHint')}
              </p>
            </div>
          )}
        </div>

        {/* G-7: site contact who lets the helper in and coordinates arrival.
            They get a status link with no billing details. */}
        <div className="booking-form-group" style={{ marginTop: '1rem' }}>
          <label>{t('booking.siteContact')}</label>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <input
              type="text"
              className="booking-input"
              value={siteContactName}
              onChange={(e) => setSiteContactName(e.target.value)}
              placeholder={t('booking.siteContactNamePlaceholder')}
              aria-label={t('booking.siteContactName')}
              maxLength={200}
            />
            <input
              type="tel"
              className="booking-input"
              value={siteContactPhone}
              onChange={(e) => setSiteContactPhone(e.target.value)}
              placeholder={t('booking.siteContactPhonePlaceholder')}
              aria-label={t('booking.siteContactPhone')}
              maxLength={40}
            />
            <input
              type="email"
              className="booking-input"
              value={siteContactEmail}
              onChange={(e) => setSiteContactEmail(e.target.value)}
              placeholder={t('booking.siteContactEmailPlaceholder')}
              aria-label={t('booking.siteContactEmail')}
              maxLength={200}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--muted-text)' }}>
              {t('booking.siteContactHint')}
            </p>
          </div>
        </div>

        {/* Agreement Checkbox */}
        <div className="booking-agreement">
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => { setAgreed(e.target.checked); onAgreementChange?.(e.target.checked); }} data-track="ui.98ea5ee9e6.1"
            />
            <span>{t('booking.agreeToTerms')}</span>
          </label>
        </div>

        {/* Actions */}
        <div className="booking-confirmation-actions">
          <button
            onClick={onBack}
            className="booking-btn-secondary"
            disabled={loading} data-track="ui.98ea5ee9e6.2"
          >
            {t('common.back')}
          </button>
          <button
            onClick={handleConfirm}
            className="booking-btn-primary"
            disabled={loading || !agreed} data-track="ui.98ea5ee9e6.3"
          >
            {loading ? t('common.loading') : t('booking.confirmBooking')}
          </button>
        </div>
      </div>
    </div>
  );
}
