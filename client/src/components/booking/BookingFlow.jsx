import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BookingCalendar from './BookingCalendar';
import BookingConfirmation from './BookingConfirmation';
import BookingRequestCard from './BookingRequestCard';
import api from '../../api/axios';
import { createBookingRequest, fetchBookingPrefillForJob } from '../../api/bookings';
import { X, ChevronLeft, AlertCircle } from 'lucide-react';
import './BookingFlow.css';

/**
 * Direct booking: calendar → confirm → track status.
 * Fallback: Post Job wizard with pre-filled fields from a finished booking.
 */
export default function BookingFlow({ helperId, helperName, onClose, onBookingCreated }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const serviceHint = searchParams.get('serviceHint') || '';

  const [step, setStep] = useState('calendar');
  const [bookingData, setBookingData] = useState(null);
  const [bookingRequest, setBookingRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isLoggedIn = !!user;

  const handleSelectSlot = (data) => {
    setBookingData(data);
    setStep('confirmation');
    setError(null);
  };

  const handleConfirmBooking = async (formData) => {
    if (!isLoggedIn) {
      navigate('/login', { state: { from: `/book/${helperId}${helperName ? `?helperName=${encodeURIComponent(helperName)}` : ''}` } });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const bookingRow = await createBookingRequest({
        helperId,
        serviceName: formData.serviceName,
        requestedDate: formData.requestedDate,
        requestedStartTime: formData.requestedStartTime,
        requestedEndTime: formData.requestedEndTime,
        serviceLocation: formData.serviceLocation,
        description: formData.description || null,
        confirmationHours: formData.confirmationHours ?? 24,
      });

      setBookingRequest(bookingRow);
      setStep('status');
      onBookingCreated?.(bookingRow);
    } catch (err) {
      const msg =
        err?.response?.data?.fields &&
        typeof err.response.data.fields === 'object'
          ? Object.values(err.response.data.fields).join(' ')
          : err?.response?.data?.error ||
            err?.message ||
            'Failed to create booking request';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step !== 'status' || !bookingRequest?.id) return;
    if (bookingRequest.status !== 'pending') return;

    const id = bookingRequest.id;
    const tick = async () => {
      try {
        const { data } = await api.get(`/bookings/${id}`);
        if (data?.success && data.data) {
          setBookingRequest(data.data);
        }
      } catch {
        /* ignore */
      }
    };

    const iv = setInterval(tick, 8000);
    return () => clearInterval(iv);
  }, [step, bookingRequest?.id, bookingRequest?.status]);

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

  const handleConvertToJob = useCallback(async () => {
    if (!bookingRequest?.id) return;
    try {
      const prefillPayload = await fetchBookingPrefillForJob(bookingRequest.id);
      const raw = prefillPayload?.prefill ?? prefillPayload;
      if (raw) {
        // Build the description client-side so i18n labels are in the user's language
        const parts = [];
        if (raw.serviceName) parts.push(raw.serviceName);
        if (raw.requestedDate && raw.requestedStartTime && raw.requestedEndTime) {
          parts.push(
            `${t('booking.prefillPreferredTime')}: ${raw.requestedDate} ${raw.requestedStartTime}–${raw.requestedEndTime}`
          );
        }
        if (raw.locationInput) {
          parts.push(`${t('booking.prefillLocation')}: ${raw.locationInput}`);
        }
        if (raw.description) {
          parts.push('');
          parts.push(raw.description);
        }
        const prefill = {
          ...raw,
          description: parts.join('\n'),
        };
        navigate('/post-job', { state: { bookingPrefill: prefill } });
      } else {
        navigate(`/post-job?fromBooking=${encodeURIComponent(bookingRequest.id)}`);
      }
    } catch {
      navigate(`/post-job?fromBooking=${encodeURIComponent(bookingRequest.id)}`);
    }
    onClose?.();
  }, [bookingRequest?.id, navigate, onClose, t]);

  return (
    <div className="booking-flow">
      <div className="booking-flow-header">
        <button
          type="button"
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
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="booking-flow-close-btn"
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        )}
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
            initialServiceName={serviceHint}
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
            onConvertToJob={handleConvertToJob}
          />
        )}
      </div>
    </div>
  );
}
