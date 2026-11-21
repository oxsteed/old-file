import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { schedulingApi } from '../api/scheduling';
import './ConsultantSessionDialogs.css';

// Group 10 Slice C, item 518: propose a new time for a confirmed
// appointment. The picker shows slots in the viewer's own time zone and
// posts the canonical date and time (the consultant's zone), so the move
// is unambiguous on both sides. Used by the client portal and by the
// consultant's dashboard sessions section.
//
// Props:
//   consultantId     users.id UUID of the assigned consultant
//   scheduledSession { scheduled_id, scheduled_date, scheduled_time,
//                      duration_minutes, timezone }
//   onClose          called when the dialog is dismissed
//   onDone           called with the created proposal on success
export default function ConsultantRescheduleDialog({ consultantId, scheduledSession, onClose, onDone }) {
  const { t, i18n } = useTranslation();
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotsMeta, setSlotsMeta] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [durationMinutes, setDurationMinutes] = useState(scheduledSession?.duration_minutes || 120);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // The viewer's own zone: slots convert to it, the proposal posts
  // canonical times.
  const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const dateLocale = i18n.language || 'en';

  useEffect(() => {
    if (!consultantId) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await schedulingApi.getNextAvailableDates(consultantId, 30, durationMinutes, clientTimezone);
        const payload = res.data;
        if (!cancelled) setDates(Array.isArray(payload) ? payload : (payload.dates || []));
      } catch {
        toast.error(t('common.errorLoading'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId, durationMinutes]);

  useEffect(() => {
    if (!selectedDate || !consultantId) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await schedulingApi.getAvailableSlots(consultantId, selectedDate, durationMinutes, clientTimezone);
        const payload = res.data;
        if (cancelled) return;
        setSlotsMeta(Array.isArray(payload) ? null : { timezone: payload.timezone, client_timezone: payload.client_timezone });
        setSlots(Array.isArray(payload) ? payload : (payload.slots || []));
      } catch {
        toast.error(t('common.errorLoading'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, consultantId, durationMinutes]);

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    setSlots([]);
  };

  const handleSubmit = async () => {
    if (!selectedDate || !selectedSlot) return;
    setSaving(true);
    try {
      const { data } = await schedulingApi.proposeReschedule(scheduledSession.scheduled_id, {
        date: selectedDate,
        startTime: typeof selectedSlot === 'string' ? selectedSlot : selectedSlot.slot_start,
        durationMinutes,
        reason: reason.trim() || null,
      });
      toast.success(t('scheduling.rescheduleProposed'));
      onDone?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.errorUpdating'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="csd-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="csd-dialog">
        <h2 className="csd-title">{t('scheduling.rescheduleTitle')}</h2>
        <p className="text-sm mb-4 csd-muted">
          {t('scheduling.rescheduleCurrent', {
            date: scheduledSession?.scheduled_date
              ? new Date(`${scheduledSession.scheduled_date}T${scheduledSession.scheduled_time || '09:00'}`).toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric' })
              : '',
            time: String(scheduledSession?.scheduled_time || '').slice(0, 5),
          })}
        </p>

        <label className="csd-label">{t('scheduling.duration')}</label>
        <select
          value={durationMinutes}
          onChange={(e) => { setDurationMinutes(parseInt(e.target.value, 10)); setSelectedDate(null); setSelectedSlot(null); setSlots([]); }}
          className="csd-input csd-field"
        >
          <option value={60}>{t('scheduling.duration60')}</option>
          <option value={90}>{t('scheduling.duration90')}</option>
          <option value={120}>{t('scheduling.duration120')}</option>
        </select>

        <label className="csd-label">{t('scheduling.pickDate')}</label>
        <div className="csd-date-grid">
          {dates.map((dateObj) => (
            <button
              key={dateObj.date}
              type="button"
              className={`csd-pick-btn${selectedDate === dateObj.date ? ' selected' : ''}`}
              onClick={() => handleDateSelect(dateObj.date)}
              disabled={loading} data-track="ui.52dcdb6362.1"
            >
              <div className="csd-pick-day">{dateObj.dayOfWeek}</div>
              <div className="csd-pick-num">
                {new Date(dateObj.date).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
              </div>
            </button>
          ))}
        </div>
        {dates.length === 0 && !loading && (
          <p className="text-sm text-center mb-4 csd-muted">{t('scheduling.noAvailability')}</p>
        )}

        {selectedDate && (
          <>
            <label className="csd-label">
              {t('scheduling.pickTime')} ({clientTimezone})
            </label>
            <div className="csd-slot-grid">
              {slots.map((slot) => {
                const slotStart = typeof slot === 'string' ? slot : slot.slot_start;
                const clientStart = typeof slot === 'string' ? null : slot.client_slot_start;
                const isSelected = selectedSlot === slot || (selectedSlot && selectedSlot.slot_start === slotStart);
                return (
                  <button
                    key={slotStart}
                    type="button"
                    className={`csd-slot-btn${isSelected ? ' selected' : ''}`}
                    onClick={() => setSelectedSlot(slot)}
                    disabled={loading} data-track="ui.52dcdb6362.2"
                  >
                    {String(slotStart).slice(0, 5)}
                    {clientStart && (
                      <div className="csd-slot-sub">
                        {clientStart} {t('scheduling.yourTime')}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {slots.length === 0 && !loading && (
              <p className="text-sm text-center mb-4 csd-muted">{t('scheduling.noSlots')}</p>
            )}
          </>
        )}

        <label className="csd-label">{t('scheduling.rescheduleReason')}</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t('scheduling.rescheduleReasonPlaceholder')}
          className="csd-input csd-textarea csd-field"
        />

        {slotsMeta?.timezone && (
          <p className="text-xs mb-4 csd-muted">
            {t('scheduling.rescheduleCanonicalNote', { zone: slotsMeta.timezone })}
          </p>
        )}

        <div className="csd-actions">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-md font-semibold text-sm csd-btn-secondary" data-track="ui.52dcdb6362.3"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedDate || !selectedSlot || saving}
            className="flex-1 px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60" data-track="ui.52dcdb6362.4"
          >
            {saving ? t('common.loading') : t('scheduling.proposeNewTime')}
          </button>
        </div>
      </div>
    </div>
  );
}
