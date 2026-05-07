import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import axios from '../api/axios';

export default function ConsultantScheduleSelector({ consultantId, sessionId, onScheduleConfirmed, onCancel }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('selectDate'); // selectDate, selectTime, confirm
  const [availableDates, setAvailableDates] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [loading, setLoading] = useState(false);
  const [meetingLink, setMeetingLink] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');

  // Load next available dates on mount
  useEffect(() => {
    const loadAvailableDates = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`/scheduling/consultants/${consultantId}/next-available`, {
          params: { daysAhead: 30, durationMinutes }
        });
        setAvailableDates(response.data);
      } catch (err) {
        toast.error(t('common.errorLoading') || 'Failed to load available dates');
        logger.error('Failed to load available dates', { error: err.message });
      } finally {
        setLoading(false);
      }
    };

    if (consultantId) {
      loadAvailableDates();
    }
  }, [consultantId, durationMinutes]);

  // Load slots when date is selected
  useEffect(() => {
    if (!selectedDate) return;

    const loadSlots = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `/api/scheduling/consultants/${consultantId}/available-slots`,
          {
            params: { date: selectedDate, durationMinutes }
          }
        );
        setAvailableSlots(response.data);
      } catch (err) {
        toast.error(t('common.errorLoading') || 'Failed to load time slots');
        logger.error('Failed to load time slots', { error: err.message });
      } finally {
        setLoading(false);
      }
    };

    loadSlots();
  }, [selectedDate, consultantId, durationMinutes]);

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    setStep('selectTime');
  };

  const handleSlotSelect = (slot) => {
    setSelectedSlot(slot);
    setStep('confirm');
  };

  const handleConfirmSchedule = async () => {
    try {
      setLoading(true);

      const response = await axios.post(`/scheduling/sessions/${sessionId}/book-slot`, {
        consultantId,
        date: selectedDate,
        startTime: selectedSlot,
        durationMinutes,
        meetingLink: meetingLink || null,
        timezone
      });

      toast.success(t('scheduling.sessionConfirmed') || 'Session scheduled successfully!');
      if (onScheduleConfirmed) {
        onScheduleConfirmed(response.data);
      }
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(t('scheduling.slotUnavailable') || 'This time slot is no longer available');
      } else {
        toast.error(t('common.errorUpdating') || 'Failed to book session');
      }
      logger.error('Failed to book session', { error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const containerStyle = {
    maxWidth: '500px',
    margin: '0 auto',
    padding: '2rem',
    background: 'var(--color-surface)',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  };

  const titleStyle = {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: '1.5rem',
    color: 'var(--color-text)',
  };

  const stepStyle = {
    fontSize: '0.875rem',
    color: 'var(--color-text-muted)',
    marginBottom: '1.5rem',
  };

  const dateGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  };

  const dateButtonStyle = (isSelected) => ({
    padding: '1rem',
    borderRadius: '8px',
    border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
    background: isSelected ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'center',
    fontSize: '0.875rem',
  });

  const slotGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  };

  const slotButtonStyle = (isSelected) => ({
    padding: '0.75rem',
    borderRadius: '6px',
    border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
    background: isSelected ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'center',
    fontSize: '0.875rem',
  });

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    marginBottom: '1rem',
    fontSize: '0.875rem',
  };

  const buttonGroupStyle = {
    display: 'flex',
    gap: '1rem',
    marginTop: '2rem',
  };

  const buttonStyle = {
    flex: 1,
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.2s',
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--color-primary)',
    color: 'white',
    opacity: loading ? 0.6 : 1,
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    background: 'transparent',
    color: 'var(--color-primary)',
    border: '1px solid var(--color-primary)',
  };

  return (
    <div style={containerStyle}>
      <h2 style={titleStyle}>{t('scheduling.selectTime') || 'Choose Your Session Time'}</h2>
      <p style={stepStyle}>
        {step === 'selectDate' && (t('scheduling.step1') || 'Step 1 of 3: Select a date')}
        {step === 'selectTime' && (t('scheduling.step2') || 'Step 2 of 3: Select a time')}
        {step === 'confirm' && (t('scheduling.step3') || 'Step 3 of 3: Confirm details')}
      </p>

      {step === 'selectDate' && (
        <>
          <div style={dateGridStyle}>
            {availableDates.map((dateObj) => (
              <button
                key={dateObj.date}
                style={dateButtonStyle(selectedDate === dateObj.date)}
                onClick={() => handleDateSelect(dateObj.date)}
                disabled={loading}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {dateObj.dayOfWeek}
                </div>
                <div style={{ fontWeight: 'bold', marginTop: '0.25rem' }}>
                  {new Date(dateObj.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </button>
            ))}
          </div>
          {availableDates.length === 0 && !loading && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>
              {t('scheduling.noAvailability') || 'No available dates found'}
            </p>
          )}
        </>
      )}

      {step === 'selectTime' && (
        <>
          <div style={slotGridStyle}>
            {availableSlots.map((slot) => (
              <button
                key={slot.slot_start}
                style={slotButtonStyle(selectedSlot === slot.slot_start)}
                onClick={() => handleSlotSelect(slot.slot_start)}
                disabled={loading}
              >
                {slot.slot_start}
              </button>
            ))}
          </div>
          {availableSlots.length === 0 && !loading && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>
              {t('scheduling.noSlots') || 'No available times on this date'}
            </p>
          )}

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {t('scheduling.duration') || 'Session Duration'}
            </label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
              style={inputStyle}
            >
              <option value={60}>{t('scheduling.duration60') || '1 hour'}</option>
              <option value={90}>{t('scheduling.duration90') || '1.5 hours'}</option>
              <option value={120}>{t('scheduling.duration120') || '2 hours'}</option>
            </select>
          </div>
        </>
      )}

      {step === 'confirm' && selectedDate && selectedSlot && (
        <>
          <div style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text)' }}>
              {t('scheduling.reviewBooking') || 'Review Your Booking'}
            </h3>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.date') || 'Date'}:</strong>{' '}
              {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.time') || 'Time'}:</strong> {selectedSlot}
            </p>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.duration') || 'Duration'}:</strong> {durationMinutes} {t('scheduling.minutes') || 'minutes'}
            </p>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {t('scheduling.meetingLink') || 'Meeting Link (Optional)'}
            </label>
            <input
              type="url"
              placeholder="https://zoom.us/..."
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {t('scheduling.timezone') || 'Timezone'}
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={inputStyle}
            >
              <option value="America/New_York">Eastern Time</option>
              <option value="America/Chicago">Central Time</option>
              <option value="America/Denver">Mountain Time</option>
              <option value="America/Los_Angeles">Pacific Time</option>
              <option value="Europe/London">London</option>
              <option value="Europe/Paris">Central European</option>
            </select>
          </div>
        </>
      )}

      <div style={buttonGroupStyle}>
        <button
          style={secondaryButtonStyle}
          onClick={() => {
            if (step === 'selectDate') {
              onCancel?.();
            } else if (step === 'selectTime') {
              setStep('selectDate');
              setSelectedSlot(null);
            } else {
              setStep('selectTime');
            }
          }}
          disabled={loading}
        >
          {step === 'selectDate' ? (t('common.cancel') || 'Cancel') : (t('common.back') || 'Back')}
        </button>
        {step !== 'selectDate' && (
          <button
            style={primaryButtonStyle}
            onClick={step === 'selectTime' ? handleConfirmSchedule : () => setStep('confirm')}
            disabled={!selectedSlot || loading}
          >
            {step === 'selectTime' ? (loading ? t('common.loading') || 'Loading...' : t('common.next') || 'Next') : (t('scheduling.confirmBooking') || 'Confirm Booking')}
          </button>
        )}
      </div>
    </div>
  );
}
