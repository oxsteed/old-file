import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BookingCalendar from './BookingCalendar';
import BookingConfirmation from './BookingConfirmation';
import BookingRequestCard from './BookingRequestCard';
import { X, ChevronLeft, AlertCircle } from 'lucide-react';
import './BookingFlow.css';

/**
 * BookingFlow Component
 *
 * Manages the complete flow:
 * 1. Calendar selection (date & time)
 * 2. Confirmation of booking request
 * 3. Status display (pending, accepted, declined, expired)
 * 4. Conversion to job post if booking fails
 */
export default function BookingFlow({ helperId, helperName, onClose, onBookingCreated }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState('calendar'); // calendar -> confirmation -> status
  const [bookingData, setBookingData] = useState(null);
  const [bookingRequest, setBookingRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isLoggedIn = !!user;

  // Step 1: Calendar selection
  const handleSelectSlot = (data) => {
    setBookingData(data);
    setStep('confirmation');
    setError(null);
  };

  // Step 2: Confirm and create booking
  const handleConfirmBooking = async (formData) => {
    if (!isLoggedIn) {
      // Redirect to login with return URL
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          helperId,
          serviceName: formData.serviceName,
          requestedDate: formData.requestedDate,
          requestedStartTime: formData.requestedStartTime,
          requestedEndTime: formData.requestedEndTime,
          serviceLocation: formData.serviceLocation,
          description: formData.description
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to create booking request');
      }

      const { data } = await response.json();
      setBookingRequest(data);
      setStep('status');

      if (onBookingCreated) {
        onBookingCreated(data);
      }
    } catch (err) {
      setError(err.message || 'Failed to create booking request');
      setLoading(false);
    }
  };

  const handleGoBack = () => {
    if (step === 'confirmation') {
      setStep('calendar');
      setBookingData(null);
      setError(null);
    } else if (step === 'status') {
      setStep('calendar');
      setBookingRequest(null);
      setBookingData(null);
      setError(null);
    } else {
      onClose?.();
    }
  };

  return (
    <div className="booking-flow">
      <div className="booking-flow-header">
        <button
          onClick={handleGoBack}
          className="booking-flow-back-btn"
          aria-label={t('common.back')}
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="booking-flow-title">
          {step === 'calendar' && t('booking.bookNow')}
          {step === 'confirmation' && t('booking.confirmBooking')}
          {step === 'status' && t('booking.requestStatus')}
        </h2>
        <button
          onClick={onClose}
          className="booking-flow-close-btn"
          aria-label={t('common.close')}
        >
          <X size={20} />
        </button>
      </div>

      <div className="booking-flow-body">
        {error && (
          <div className="booking-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {step === 'calendar' && (
          <BookingCalendar
            helperId={helperId}
            helperName={helperName}
            onSelectSlot={handleSelectSlot}
          />
        )}

        {step === 'confirmation' && bookingData && (
          <BookingConfirmation
            bookingData={bookingData}
            helperName={helperName}
            onConfirm={handleConfirmBooking}
            onBack={() => setStep('calendar')}
            loading={loading}
          />
        )}

        {step === 'status' && bookingRequest && (
          <BookingRequestCard
            booking={bookingRequest}
            helperName={helperName}
            onConvertToJob={() => {
              // Navigate to convert booking to job flow
              navigate(`/post-job`, {
                state: { bookingId: bookingRequest.id }
              });
              onClose?.();
            }}
          />
        )}
      </div>
    </div>
  );
}
