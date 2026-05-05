import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, MapPin, FileText, AlertCircle } from 'lucide-react';
import './BookingConfirmation.css';

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
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);

  const handleConfirm = () => {
    if (!agreed) {
      alert(t('booking.agreementRequired'));
      return;
    }

    onConfirm(bookingData);
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
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
                {bookingData.requestedStartTime} - {bookingData.requestedEndTime}
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

        {/* Important Info */}
        <div className="booking-info-box">
          <AlertCircle size={18} />
          <div>
            <h4>{t('booking.importantToKnow')}</h4>
            <ul>
              <li>{t('booking.infoWaitingForResponse', { days: 1 })}</li>
              <li>{t('booking.infoHelperCanDecline')}</li>
              <li>{t('booking.infoCanConvertToJob')}</li>
            </ul>
          </div>
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
