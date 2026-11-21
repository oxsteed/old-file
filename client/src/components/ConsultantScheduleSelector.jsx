import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { schedulingApi } from '../api/scheduling';
import logger from '../utils/logger';
import './ConsultantScheduleSelector.css';

// Restored replacement for the deleted ConsultantScheduleSelector (3 steps:
// selectDate -> selectTime -> confirm), wired to the schedulingApi wrapper
// instead of raw axios.
//
// Step-button contract, fixed against the deleted version: selecting a time
// only selects it; "Next" on the time step advances to the confirm step, and
// only "Confirm booking" on the confirm step posts the booking. The deleted
// widget inverted this (its time-step primary booked immediately, and its
// confirm-step primary merely re-set the step and never booked).
//
// Props:
//   consultantId         users.id UUID of the assigned consultant
//   sessionId            id of the consulting_sessions_scheduled row
//   onScheduleConfirmed  called with the booked row on success
//   onCancel             called when the user backs out from step 1
//   onPaymentRequired    called on a 402 instead of a toast, so the caller
//                        can route the user to payment and then retry
export default function ConsultantScheduleSelector({
  consultantId,
  sessionId,
  onScheduleConfirmed,
  onCancel,
  onPaymentRequired,
}) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState('selectDate'); // selectDate, selectTime, confirm
  const [availableDates, setAvailableDates] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  // The full slot object for the chosen slot (carries the converted
  // client-zone times when a timezone is selected, item 517).
  const [selectedSlotObj, setSelectedSlotObj] = useState(null);
  // Zone metadata from the last slot response: the consultant's canonical
  // zone and the client's selected zone. Booking posts canonical times.
  const [slotsMeta, setSlotsMeta] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [loading, setLoading] = useState(false);
  const [meetingLink, setMeetingLink] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  // Group 10 item 507: engagement format picker. Defaults to zoom; the
  // chosen format is plumbed through book-slot and stored on the row.
  const [meetingType, setMeetingType] = useState('zoom');

  // Load next available dates on mount (and when the duration or the
  // client's zone changes; slot times convert to the chosen zone, 517).
  useEffect(() => {
    if (!consultantId) return;
    let cancelled = false;
    const loadAvailableDates = async () => {
      try {
        setLoading(true);
        const response = await schedulingApi.getNextAvailableDates(consultantId, 30, durationMinutes, timezone);
        // Enriched shape (517) wraps the dates with the zones; the legacy
        // shape is a bare array.
        const payload = response.data;
        if (!cancelled) setAvailableDates(Array.isArray(payload) ? payload : (payload.dates || []));
      } catch (err) {
        toast.error(t('common.errorLoading'));
        logger.error('Failed to load available dates', { error: err.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadAvailableDates();
    return () => { cancelled = true; };
  }, [consultantId, durationMinutes, timezone, t]);

  // Load slots when a date is selected (and when the duration or the
  // client's zone changes).
  useEffect(() => {
    if (!selectedDate || !consultantId) return;
    let cancelled = false;
    const loadSlots = async () => {
      try {
        setLoading(true);
        const response = await schedulingApi.getAvailableSlots(consultantId, selectedDate, durationMinutes, timezone);
        if (cancelled) return;
        // Enriched shape (517): { timezone, client_timezone, slots } where
        // each slot carries client_slot_start/client_slot_end alongside the
        // canonical slot_start/slot_end. Legacy shape: a bare array.
        const payload = response.data;
        const slots = Array.isArray(payload) ? payload : (payload.slots || []);
        setSlotsMeta(Array.isArray(payload) ? null : { timezone: payload.timezone, client_timezone: payload.client_timezone });
        setAvailableSlots(slots);
      } catch (err) {
        toast.error(t('common.errorLoading'));
        logger.error('Failed to load time slots', { error: err.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadSlots();
    return () => { cancelled = true; };
  }, [selectedDate, consultantId, durationMinutes, timezone, t]);

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    setSelectedSlotObj(null);
    setStep('selectTime');
  };

  const handleSlotSelect = (slot) => {
    // Select only. Advancing is the Next button's job (see header comment).
    setSelectedSlot(typeof slot === 'string' ? slot : slot.slot_start);
    setSelectedSlotObj(typeof slot === 'string' ? null : slot);
  };

  // Changing the zone clears any selection made in the old one; the date
  // and slot effects re-load in the new zone (item 517).
  const handleTimezoneChange = (zone) => {
    setTimezone(zone);
    setSelectedDate(null);
    setSelectedSlot(null);
    setSelectedSlotObj(null);
    setAvailableSlots([]);
    setSlotsMeta(null);
    setStep('selectDate');
  };

  const handleConfirmSchedule = async () => {
    try {
      setLoading(true);
      // The booking posts the canonical date and time (the consultant's
      // zone); the client-zone times are display only (item 517).
      const canonicalZone = slotsMeta?.timezone || 'America/New_York';
      const response = await schedulingApi.bookTimeSlot(
        sessionId,
        consultantId,
        selectedDate,
        selectedSlot,
        durationMinutes,
        meetingLink || null,
        canonicalZone,
        meetingType,
      );
      toast.success(t('scheduling.sessionConfirmed'));
      if (onScheduleConfirmed) onScheduleConfirmed(response.data);
    } catch (err) {
      if (err.response?.status === 402) {
        if (onPaymentRequired) onPaymentRequired();
        else toast.error(t('scheduling.paymentRequired'));
      } else if (err.response?.status === 409) {
        toast.error(t('scheduling.slotUnavailable'));
      } else {
        toast.error(t('common.errorUpdating'));
      }
      logger.error('Failed to book session', { error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'selectDate') onCancel?.();
    else if (step === 'selectTime') { setStep('selectDate'); setSelectedSlot(null); }
    else setStep('selectTime');
  };

  // Primary button: Next advances selectTime -> confirm; Confirm books.
  // There is no primary on selectDate: picking a date advances the step.
  const handlePrimary = () => {
    if (step === 'selectTime') setStep('confirm');
    else if (step === 'confirm') handleConfirmSchedule();
  };

  const timezoneOptions = [
    { value: 'America/New_York', label: t('scheduling.timezones.eastern') },
    { value: 'America/Chicago', label: t('scheduling.timezones.central') },
    { value: 'America/Denver', label: t('scheduling.timezones.mountain') },
    { value: 'America/Los_Angeles', label: t('scheduling.timezones.pacific') },
    { value: 'Europe/London', label: t('scheduling.timezones.london') },
    { value: 'Europe/Paris', label: t('scheduling.timezones.paris') },
  ];
  const meetingTypeOptions = [
    { value: 'zoom', label: t('scheduling.meetingTypes.zoom') },
    { value: 'google_meet', label: t('scheduling.meetingTypes.googleMeet') },
    { value: 'phone', label: t('scheduling.meetingTypes.phone') },
    { value: 'in_person', label: t('scheduling.meetingTypes.inPerson') },
  ];
  const dateLocale = i18n.language || 'en';

  const containerStyle = {
    maxWidth: '500px',
    margin: '0 auto',
    padding: '2rem',
    background: 'var(--color-surface)',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  };
  const titleStyle = { fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: 'var(--color-text)' };
  const stepStyle = { fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' };
  const dateGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' };
  const dateButtonStyle = (isSelected) => ({
    padding: '1rem', borderRadius: '8px',
    border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
    background: isSelected ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg)',
    color: 'var(--color-text)', cursor: 'pointer', textAlign: 'center', fontSize: '0.875rem',
  });
  const slotGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' };
  const slotButtonStyle = (isSelected) => ({
    padding: '0.75rem', borderRadius: '6px',
    border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
    background: isSelected ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg)',
    color: 'var(--color-text)', cursor: 'pointer', textAlign: 'center', fontSize: '0.875rem',
  });
  const inputStyle = {
    width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)',
    background: 'var(--color-bg)', color: 'var(--color-text)', marginBottom: '1rem', fontSize: '0.875rem',
  };
  const buttonGroupStyle = { display: 'flex', gap: '1rem', marginTop: '2rem' };
  const buttonStyle = { flex: 1, padding: '0.75rem 1rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: '600' };
  const primaryButtonStyle = { ...buttonStyle, background: 'var(--color-primary)', color: 'white', opacity: loading ? 0.6 : 1 };
  const secondaryButtonStyle = { ...buttonStyle, background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' };

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
          {/* The zone picker comes before date and slot selection (517):
              every time shown after it is converted to the chosen zone. */}
          <div className="css-field">
            <label className="css-label">
              {t('scheduling.timezone')}
            </label>
            <select value={timezone} onChange={(e) => handleTimezoneChange(e.target.value)} className="css-input">
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div style={dateGridStyle}>
            {availableDates.map((dateObj) => (
              <button
                key={dateObj.date}
                type="button"
                style={dateButtonStyle(selectedDate === dateObj.date)}
                onClick={() => handleDateSelect(dateObj.date)}
                disabled={loading} data-track="ui.1e38907353.1"
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{dateObj.dayOfWeek}</div>
                <div style={{ fontWeight: 'bold', marginTop: '0.25rem' }}>
                  {new Date(dateObj.date).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
                </div>
              </button>
            ))}
          </div>
          {availableDates.length === 0 && !loading && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>{t('scheduling.noAvailability')}</p>
          )}
        </>
      )}

      {step === 'selectTime' && (
        <>
          <div style={slotGridStyle}>
            {availableSlots.map((slot) => {
              const slotStart = typeof slot === 'string' ? slot : slot.slot_start;
              const clientStart = typeof slot === 'string' ? null : slot.client_slot_start;
              const clientDate = typeof slot === 'string' ? null : slot.client_date;
              const isSelected = selectedSlot === slotStart;
              return (
                <button
                  key={slotStart}
                  type="button"
                  style={slotButtonStyle(isSelected)}
                  onClick={() => handleSlotSelect(slot)}
                  disabled={loading} data-track="ui.1e38907353.2"
                >
                  {String(slotStart).slice(0, 5)}
                  {clientStart && (
                    <div className="css-slot-sub">
                      {clientStart}
                      {clientDate && clientDate !== selectedDate ? ` (${new Date(clientDate).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })})` : ''}
                      {' '}{t('scheduling.yourTime')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {availableSlots.length === 0 && !loading && (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>{t('scheduling.noSlots')}</p>
          )}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {t('scheduling.duration')}
            </label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
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
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text)' }}>{t('scheduling.reviewBooking')}</h3>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.date')}:</strong>{' '}
              {new Date(selectedDate).toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.time')}:</strong> {String(selectedSlot).slice(0, 5)}
              {slotsMeta?.timezone ? ` (${slotsMeta.timezone})` : ''}
            </p>
            {selectedSlotObj?.client_slot_start && (
              <p className="css-review-line">
                <strong>{t('scheduling.yourTime')}:</strong> {selectedSlotObj.client_slot_start}
                {selectedSlotObj.client_date && selectedSlotObj.client_date !== selectedDate
                  ? ` (${new Date(selectedSlotObj.client_date).toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric' })})`
                  : ''}
                {slotsMeta?.client_timezone ? ` (${slotsMeta.client_timezone})` : ''}
              </p>
            )}
            <p style={{ margin: '0.5rem 0', color: 'var(--color-text-muted)' }}>
              <strong>{t('scheduling.duration')}:</strong> {durationMinutes} {t('scheduling.minutes')}
            </p>
            <p className="css-review-line">
              <strong>{t('scheduling.meetingFormat')}:</strong>{' '}
              {(meetingTypeOptions.find((option) => option.value === meetingType) || {}).label || meetingType}
            </p>
          </div>
          <div className="css-field">
            <label className="css-label">
              {t('scheduling.meetingFormat')}
            </label>
            <select value={meetingType} onChange={(e) => setMeetingType(e.target.value)} className="css-input">
              {meetingTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {meetingType === 'in_person' && (
              <p className="mt-1 text-xs text-gray-500">
                {t('scheduling.inPersonHint')}
              </p>
            )}
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
        </>
      )}

      <div style={buttonGroupStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={handleBack} disabled={loading} data-track="ui.1e38907353.3">
          {step === 'selectDate' ? t('common.cancel') : t('common.back')}
        </button>
        {step !== 'selectDate' && (
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handlePrimary}
            disabled={(step === 'selectTime' && !selectedSlot) || loading} data-track="ui.1e38907353.4"
          >
            {step === 'selectTime' ? (loading ? t('common.loading') : t('common.next')) : t('scheduling.confirmBooking')}
          </button>
        )}
      </div>
    </div>
  );
}
