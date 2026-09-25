import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Calendar, Clock, MapPin, FileText, AlertCircle } from 'lucide-react';
import './BookingConfirmation.css';

function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  loading
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [agreed, setAgreed] = useState(false);
  const [confirmationHours, setConfirmationHours] = useState(24);
  const effectiveConfirmationHours = bookingData.availabilityMode === 'request_only' ? 72 : confirmationHours;

  const handleConfirm = () => {
    if (!agreed) {
      toast.error(t('booking.agreementRequired'));
      return;
    }

    onConfirm({
      ...bookingData,
      confirmationHours: bookingData.availabilityMode === 'request_only'
        ? 72
        : Math.min(168, Math.max(1, Number(confirmationHours) || 24)),
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
            <p>{bookingData.autoPostOnExpiry ? t('booking.autoPostSummary') : t('booking.expireSummary')}</p>
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
            value={bookingData.availabilityMode === 'request_only' ? 72 : confirmationHours}
            onChange={(e) => setConfirmationHours(Number(e.target.value))}
            disabled={bookingData.availabilityMode === 'request_only'}
          >
            {[6, 12, 24, 48, 72, 96, 120, 168].map((h) => (
              <option key={h} value={h}>
                {t('booking.hoursCount', { count: h })}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted-text)', marginTop: '0.35rem' }}>
            {bookingData.availabilityMode === 'request_only' ? t('booking.requestOnlyWindowHint') : t('booking.confirmationWindowHint')}
          </p>
        </div>

        {/* Agreement Checkbox */}
        <div className="booking-agreement">
          <label>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
            />
            <span>{t('booking.agreeToTerms')}</span>
          </label>
        </div>

        {/* Actions */}
        <div className="booking-confirmation-actions">
          <button
            onClick={onBack}
            className="booking-btn-secondary"
            disabled={loading}
          >
            {t('common.back')}
          </button>
          <button
            onClick={handleConfirm}
            className="booking-btn-primary"
            disabled={loading || !agreed}
          >
            {loading ? t('common.loading') : t('booking.confirmBooking')}
          </button>
        </div>
      </div>
    </div>
  );
}
