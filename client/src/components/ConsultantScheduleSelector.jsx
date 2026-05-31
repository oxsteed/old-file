import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import axios from '../api/axios';
import logger from '../utils/logger';

export default function ConsultantScheduleSelector({ consultantId, sessionId, onScheduleConfirmed, onCancel }) {
  const { t, i18n } = useTranslation();
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
        toast.error(t('common.errorLoading'));
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
          `/scheduling/consultants/${consultantId}/available-slots`,
          {
            params: { date: selectedDate, durationMinutes }
          }
        );
        setAvailableSlots(response.data);
      } catch (err) {
        toast.error(t('common.errorLoading'));
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

      toast.success(t('scheduling.sessionConfirmed'));
      if (onScheduleConfirmed) {
        onScheduleConfirmed(response.data);
      }
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(t('scheduling.slotUnavailable'));
      } else {
        toast.error(t('common.errorUpdating'));
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

  const timezoneOptions = [
    { value: 'America/New_York', label: t('scheduling.timezones.eastern') },
    { value: 'America/Chicago', label: t('scheduling.timezones.central') },
    { value: 'America/Denver', label: t('scheduling.timezones.mountain') },
    { value: 'America/Los_Angeles', label: t('scheduling.timezones.pacific') },
    { value: 'Europe/London', label: t('scheduling.timezones.london') },
    { value: 'Europe/Paris', label: t('scheduling.timezones.paris') },
  ];
  const dateLocale = i18n.language || 'en';

  return (
    <div style={containerStyle}>
      <h2 style={titleStyle}>{t('scheduling.selectTime')}</h2>
      <p style={stepStyle}>
        {step === 'selectDate' && t('scheduling.step1')}
        {step === 'selectTime' && t('scheduling.step2')}
        {step === 'confirm' && t('scheduling.step3')}
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
                  {new Date(dateObj.date).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
                </div>
              </button>
            ))}
          </div>
          {availableDates.length === 0 && !loading && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>
              {t('scheduling.noAvailability')}
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
              {t('scheduling.noSlots')}
            </p>
          )}

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {t('scheduling.duration')}
            </label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
              style={inputStyle}
            >
              <option value={60}>{t('scheduling.duration60')}</option>
              <option value={90}>{t('scheduling.duration90')}</option>
              <option value={120}>{t('scheduling.duration120')}</option>
            </select>
          </div>
        </>
      )}

      {step === 'confirm' && selectedDate && selectedSlot && (
        <>
          <div style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text)' }}>
              {t('scheduling.reviewBooking')}
            </h3>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.date')}:</strong>{' '}
              {new Date(selectedDate).toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.time')}:</strong> {selectedSlot}
            </p>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.duration')}:</strong> {durationMinutes} {t('scheduling.minutes')}
            </p>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {t('scheduling.meetingLink')}
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
              {t('scheduling.timezone')}
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={inputStyle}
            >
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
          {step === 'selectDate' ? t('common.cancel') : t('common.back')}
        </button>
        {step !== 'selectDate' && (
          <button
            style={primaryButtonStyle}
            onClick={step === 'selectTime' ? handleConfirmSchedule : () => setStep('confirm')}
            disabled={!selectedSlot || loading}
          >
            {step === 'selectTime' ? (loading ? t('common.loading') : t('common.next')) : t('scheduling.confirmBooking')}
          </button>
        )}
      </div>
    </div>
  );
}
