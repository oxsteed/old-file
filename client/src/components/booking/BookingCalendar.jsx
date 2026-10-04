import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Info, RefreshCw } from 'lucide-react';
import { getAvailableSlots, getBusinessAvailableSlots } from '../../api/bookings';
import api from '../../api/axios';
import './BookingCalendar.css';

/** YYYY-MM-DD in the viewer's local timezone (toISOString is UTC and shifts the day west of UTC). */
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function BookingCalendar({
  helperId, helperName, businessId, businessName, onSelectSlot, initialServiceName = '',
  draft = {}, onDraftChange = () => {},
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [selectedDate, setSelectedDate] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [services, setServices] = useState([]);
  // Service details live in the parent-owned draft (BookingFlow) so going Back
  // or refreshing doesn't drop them; this component only edits them via onDraftChange.
  const serviceId = draft.serviceId || '';
  const customService = draft.customService === true;
  const serviceData = {
    serviceName: draft.serviceName || '',
    serviceLocation: draft.serviceLocation || '',
    description: draft.description || '',
  };
  const fallbackChoice = draft.fallbackChoice === 'expire' ? 'expire' : 'post';
  const [loading, setLoading] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [error, setError] = useState(null);
  // Whether the draft already carried a service name (restored from
  // sessionStorage): in that case don't let initialServiceName or the
  // first-business-service default clobber it.
  const restoredNameRef = useRef(Boolean(draft.serviceName));

  const days = useMemo(() => {
    const result = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i += 1) {
      const day = new Date(today);
      day.setDate(day.getDate() + i);
      result.push(day);
    }
    return result;
  }, []);

  useEffect(() => {
    if (initialServiceName && !restoredNameRef.current) {
      onDraftChange({ serviceName: initialServiceName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialServiceName]);

  useEffect(() => {
    if (!businessId) return undefined;
    let active = true;
    setServicesLoading(true);
    api.get(`/businesses/${businessId}/services`)
      .then(({ data }) => {
        if (!active) return;
        const rows = data?.data ?? data;
        const next = Array.isArray(rows) ? rows : [];
        setServices(next);
        if (!initialServiceName && !restoredNameRef.current && next[0]) {
          onDraftChange({ serviceId: String(next[0].id), serviceName: next[0].name || '' });
        }
      })
      .catch(() => { if (active) setServices([]); })
      .finally(() => { if (active) setServicesLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, initialServiceName]);

  // Restore the picked date from the draft (e.g. after going Back) and reload
  // its availability so the step looks the way it was left.
  useEffect(() => {
    if (draft.selectedDateStr) {
      const [y, m, d] = draft.selectedDateStr.split('-').map(Number);
      if (y && m && d) loadAvailability(new Date(y, m - 1, d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAvailability = (date, selectedServiceId = serviceId) => {
    if (!date) return;
    setSelectedDate(date);
    onDraftChange({ selectedDateStr: toLocalDateStr(date) });
    setLoading(true);
    setError(null);
    setAvailability(null);
    const dateStr = toLocalDateStr(date);
    const request = businessId
      ? getBusinessAvailableSlots(businessId, dateStr, selectedServiceId)
      : getAvailableSlots(helperId, dateStr);
    request
      .then((data) => {
        if (!data?.success) throw new Error('availability_failed');
        setAvailability(data.data || { slots: [] });
      })
      .catch(() => setError('availability_failed'))
      .finally(() => setLoading(false));
  };

  const updateService = (value) => {
    if (value === '__custom__') {
      onDraftChange({ serviceId: '', customService: true, serviceName: '' });
      return;
    }
    const selected = services.find((service) => String(service.id) === String(value));
    onDraftChange({
      serviceId: value,
      customService: false,
      serviceName: selected?.name || serviceData.serviceName,
    });
    if (selectedDate) loadAvailability(selectedDate, value);
  };

  const validateRequest = () => {
    if (!serviceData.serviceName || !serviceData.serviceLocation) {
      setError('missing_details');
      return false;
    }
    return true;
  };

  const handleSelectTimeSlot = (slot) => {
    if (!validateRequest() || !selectedDate) return;
    onSelectSlot({
      requestedDate: toLocalDateStr(selectedDate),
      requestedStartTime: slot.startTime,
      requestedEndTime: slot.endTime,
      availabilityMode: 'scheduled', autoPostOnExpiry: false, serviceId: serviceId || null,
      serviceName: serviceData.serviceName, serviceLocation: serviceData.serviceLocation,
      description: serviceData.description,
    });
  };

  const handleRequestOnly = () => {
    if (!validateRequest() || !selectedDate) return;
    onSelectSlot({
      requestedDate: toLocalDateStr(selectedDate),
      requestedStartTime: null, requestedEndTime: null,
      availabilityMode: 'request_only', autoPostOnExpiry: fallbackChoice === 'post', serviceId: serviceId || null,
      serviceName: serviceData.serviceName, serviceLocation: serviceData.serviceLocation,
      description: serviceData.description,
    });
  };

  const formatDate = (date) => date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="booking-calendar">
      <section className="booking-calendar-form booking-panel">
        <div className="booking-panel-heading"><div><span className="booking-eyebrow">{t('booking.selectService')}</span><h3>{businessName || helperName || t('booking.serviceRequest')}</h3></div><span className="booking-step-pill">1 / 2</span></div>
        <div className="booking-form-group">
          <label htmlFor="booking-service-name">{t('booking.serviceName')}</label>
          {businessId && services.length > 0 && !customService ? (
            <select id="booking-service-name" className="booking-input" value={serviceId} onChange={(e) => updateService(e.target.value)} disabled={servicesLoading}>
              <option value="">{t('booking.chooseService')}</option>
              {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              <option value="__custom__">{t('booking.otherService')}</option>
            </select>
          ) : (
            <div className="booking-custom-service">
              <input id="booking-service-name" type="text" placeholder={t('booking.serviceName')} value={serviceData.serviceName} onChange={(e) => onDraftChange({ serviceName: e.target.value })} className="booking-input" />
              {businessId && services.length > 0 && <button type="button" className="booking-inline-action" onClick={() => onDraftChange({ customService: false, serviceId: '', serviceName: '' })}>{t('booking.backToServices')}</button>}
            </div>
          )}
        </div>
        <div className="booking-form-group"><label htmlFor="booking-service-location">{t('booking.serviceLocation')}</label><input id="booking-service-location" type="text" placeholder={t('booking.serviceLocation')} value={serviceData.serviceLocation} onChange={(e) => onDraftChange({ serviceLocation: e.target.value })} className="booking-input" /></div>
        <div className="booking-form-group"><label htmlFor="booking-description">{t('booking.description')}</label><textarea id="booking-description" placeholder={t('booking.descriptionPlaceholder')} value={serviceData.description} onChange={(e) => onDraftChange({ description: e.target.value })} className="booking-textarea" rows="5" /></div>
      </section>

      <section className="booking-calendar-container booking-panel">
        <div className="booking-panel-heading"><div><span className="booking-eyebrow">{t('booking.selectDateTime')}</span><h3>{t('booking.chooseDate')}</h3></div><span className="booking-step-pill">2 / 2</span></div>
        <div className="booking-date-grid">
          {days.map((day) => <button type="button" key={day.toISOString()} onClick={() => loadAvailability(day)} className={`booking-date-btn ${selectedDate?.toDateString() === day.toDateString() ? 'selected' : ''}`} aria-pressed={selectedDate?.toDateString() === day.toDateString()}><div className="booking-date-day">{day.toLocaleDateString(locale, { weekday: 'short' })}</div><div className="booking-date-num">{day.getDate()}</div></button>)}
        </div>
        {selectedDate && (
          <div className="booking-time-slots">
            <div className="booking-slots-heading"><h4>{formatDate(selectedDate)}</h4>{availability && <span>{availability.slots?.filter((slot) => slot.available).length || 0} {t('booking.timesAvailable')}</span>}</div>
            {loading && <div className="booking-state-card"><RefreshCw size={17} className="booking-spin" />{t('booking.loadingAvailability')}</div>}
            {!loading && error === 'availability_failed' && <div className="booking-state-card booking-state-error"><Info size={18} /><div><strong>{t('booking.availabilityLoadFailed')}</strong><p>{t('booking.tryAnotherDate')}</p></div><button type="button" className="booking-inline-action" onClick={() => loadAvailability(selectedDate)}>{t('common.retry')}</button></div>}
            {!loading && error === 'missing_details' && <div className="booking-error">{t('booking.detailsRequired')}</div>}
            {!loading && !error && availability?.scheduleConfigured === false && (
              <div className="booking-request-only">
                <div className="booking-state-card"><Info size={18} /><div><strong>{t('booking.noScheduleTitle')}</strong><p>{t('booking.noScheduleDescription')}</p></div></div>
                <div className="booking-choice-list" role="radiogroup" aria-label={t('booking.noScheduleChoiceLabel')}>
                  <label className={`booking-choice ${fallbackChoice === 'post' ? 'selected' : ''}`}><input type="radio" name="fallbackChoice" value="post" checked={fallbackChoice === 'post'} onChange={() => onDraftChange({ fallbackChoice: 'post' })} /><span><strong>{t('booking.autoPostChoice')}</strong><small>{t('booking.autoPostChoiceHint')}</small></span></label>
                  <label className={`booking-choice ${fallbackChoice === 'expire' ? 'selected' : ''}`}><input type="radio" name="fallbackChoice" value="expire" checked={fallbackChoice === 'expire'} onChange={() => onDraftChange({ fallbackChoice: 'expire' })} /><span><strong>{t('booking.expireChoice')}</strong><small>{t('booking.expireChoiceHint')}</small></span></label>
                </div>
                <button type="button" className="booking-btn-primary booking-request-button" onClick={handleRequestOnly}>{t('booking.requestWithoutSchedule')}</button>
              </div>
            )}
            {!loading && !error && availability?.scheduleConfigured !== false && availability?.slots?.length === 0 && <div className="booking-state-card"><Info size={18} /><span>{t('booking.noAvailableSlots')}</span></div>}
            {!loading && !error && availability?.scheduleConfigured !== false && availability?.slots?.length > 0 && <div className="booking-time-grid">{availability.slots.map((slot) => <button type="button" key={`${slot.startTime}-${slot.endTime}`} onClick={() => handleSelectTimeSlot(slot)} className="booking-time-slot" disabled={!slot.available}><Clock size={16} /><span>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span></button>)}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
