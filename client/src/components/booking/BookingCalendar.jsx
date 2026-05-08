import React, { useState, useEffect } from 'react';
import { useTranslation, i18n as i18next } from 'react-i18next';
import { Clock } from 'lucide-react';
import { getAvailableSlots } from '../../api/bookings';
import './BookingCalendar.css';

/**
 * Format "HH:MM" → "9:00 AM" using the active i18n locale.
 */
function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * BookingCalendar Component
 *
 * Shows a calendar for the next 30 days with available time slots
 * Fetches available slots from the helper's business hours and existing appointments
 */
export default function BookingCalendar({ helperId, helperName, onSelectSlot, initialServiceName = '' }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';

  const [selectedDate, setSelectedDate] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [serviceData, setServiceData] = useState({
    serviceName: initialServiceName || '',
    serviceLocation: '',
    description: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initialServiceName) {
      setServiceData((d) => ({ ...d, serviceName: initialServiceName }));
    }
  }, [initialServiceName]);

  // Get next 30 days for calendar
  const days = React.useMemo(() => {
    const result = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      const day = new Date(today);
      day.setDate(day.getDate() + i);
      result.push(day);
    }
    return result;
  }, []);

  // Fetch available slots when date is selected
  useEffect(() => {
    if (!selectedDate) return;

    setLoading(true);
    setError(null);

    const dateStr = selectedDate.toISOString().split('T')[0];

    getAvailableSlots(helperId, dateStr)
      .then((data) => {
        if (data.success) {
          setAvailableSlots(data.data.slots || []);
        } else {
          setError('Failed to fetch available slots');
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch available slots');
      })
      .finally(() => setLoading(false));
  }, [selectedDate, helperId]);

  const handleSelectTimeSlot = (slot) => {
    if (!serviceData.serviceName || !serviceData.serviceLocation) {
      setError('Please enter service name and location');
      return;
    }

    onSelectSlot({
      requestedDate: selectedDate.toISOString().split('T')[0],
      requestedStartTime: slot.startTime,
      requestedEndTime: slot.endTime,
      ...serviceData
    });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const isDateDisabled = (date) => {
    return date < new Date();
  };

  return (
    <div className="booking-calendar">
      {/* Service Details Form */}
      <div className="booking-calendar-form">
        <h3>{t('booking.selectService')}</h3>

        <div className="booking-form-group">
          <label>{t('booking.serviceName')}</label>
          <input
            type="text"
            placeholder={t('booking.serviceName')}
            value={serviceData.serviceName}
            onChange={e => setServiceData({ ...serviceData, serviceName: e.target.value })}
            className="booking-input"
          />
        </div>

        <div className="booking-form-group">
          <label>{t('booking.serviceLocation')}</label>
          <input
            type="text"
            placeholder={t('booking.serviceLocation')}
            value={serviceData.serviceLocation}
            onChange={e => setServiceData({ ...serviceData, serviceLocation: e.target.value })}
            className="booking-input"
          />
        </div>

        <div className="booking-form-group">
          <label>{t('booking.description')}</label>
          <textarea
            placeholder={t('booking.descriptionPlaceholder')}
            value={serviceData.description}
            onChange={e => setServiceData({ ...serviceData, description: e.target.value })}
            className="booking-textarea"
            rows="3"
          />
        </div>
      </div>

      {/* Calendar View */}
      <div className="booking-calendar-container">
        <h3>{t('booking.selectDateTime')}</h3>

        {/* Date Grid */}
        <div className="booking-date-grid">
          {days.map((day, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedDate(day)}
              disabled={isDateDisabled(day)}
              className={`booking-date-btn ${selectedDate?.toDateString() === day.toDateString() ? 'selected' : ''}`}
              aria-pressed={selectedDate?.toDateString() === day.toDateString()}
            >
              <div className="booking-date-day">
                {day.toLocaleDateString(locale, { weekday: 'short' })}
              </div>
              <div className="booking-date-num">
                {day.getDate()}
              </div>
            </button>
          ))}
        </div>

        {/* Time Slots */}
        {selectedDate && (
          <div className="booking-time-slots">
            <h4>
              {t('booking.availableSlots')} - {formatDate(selectedDate)}
            </h4>

            {loading && <div className="booking-loading">{t('common.loading')}</div>}

            {error && <div className="booking-error">{error}</div>}

            {!loading && availableSlots.length === 0 && (
              <div className="booking-no-slots">
                {t('booking.noAvailableSlots')}
              </div>
            )}

            <div className="booking-time-grid">
              {availableSlots.map((slot, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectTimeSlot(slot)}
                  className="booking-time-slot"
                  disabled={!slot.available}
                >
                  <Clock size={16} />
                  <span>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
