/**
 * HelperAvailabilityEditor
 *
 * Lets helpers set their weekly availability template — the schedule that
 * powers the BidAcceptanceModal calendar picker.
 *
 * UX:
 *   • 7 day-rows (Sun–Sat). Each has a toggle to enable/disable the day.
 *   • When enabled: start + end time pickers (HH:MM).
 *   • Save button PUTs to /api/helper-profile/availability/template.
 *   • Optional "Block a date" panel for date-specific overrides.
 *
 * The component is self-contained; no props needed.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { toast } from 'sonner';
import '../styles/HelperAvailabilityEditor.css';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const COMMON_TIMES = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
  '20:00', '21:00', '22:00',
];

function makeDefaultSlots() {
  // Mon–Fri 9am–5pm by default; Sat–Sun off
  return DAY_NAMES.map((_, i) => ({
    day: i,
    active: i >= 1 && i <= 5,
    start: '09:00',
    end:   '17:00',
  }));
}

function to12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function HelperAvailabilityEditor({ onTemplateLoaded } = {}) {
  const onTemplateLoadedRef = useRef(onTemplateLoaded);
  onTemplateLoadedRef.current = onTemplateLoaded;
  const { t } = useTranslation();

  const [slots, setSlots]         = useState(makeDefaultSlots());
  const [overrides, setOverrides] = useState([]);
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);

  // Override form state
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideDate, setOverrideDate]         = useState('');
  const [overrideReason, setOverrideReason]     = useState('');
  const [savingOverride, setSavingOverride]      = useState(false);

  // Load saved template
  const loadTemplate = useCallback(async () => {
    try {
      const [tplRes, ovrRes] = await Promise.all([
        api.get('/helper-profile/availability/template'),
        api.get('/helper-profile/availability/overrides'),
      ]);

      const tplRows = tplRes.data?.template || [];
      if (tplRows.length > 0) {
        // Rebuild the 7-slot array from what's stored
        const newSlots = makeDefaultSlots().map(s => ({ ...s, active: false }));
        tplRows.forEach(row => {
          const s = newSlots[row.day_of_week];
          if (s) {
            s.active = true;
            s.start  = String(row.start_time).substring(0, 5);
            s.end    = String(row.end_time).substring(0, 5);
          }
        });
        setSlots(newSlots);
      }

      setOverrides(ovrRes.data?.overrides || []);
      onTemplateLoadedRef.current?.(tplRows);
    } catch { /* silently fail — user will see empty defaults */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTemplate(); }, [loadTemplate]);

  function toggleDay(i) {
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, active: !s.active } : s));
  }

  function updateSlot(i, field, value) {
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  async function handleSave() {
    const activeSlots = slots.filter(s => s.active);
    const errors = activeSlots.filter(s => !s.start || !s.end || s.end <= s.start);
    if (errors.length) {
      toast.error(t('availability.fixTimes', { defaultValue: 'Please fix the highlighted time errors before saving.' }));
      return;
    }

    setSaving(true);
    try {
      await api.put('/helper-profile/availability/template', {
        slots: activeSlots.map(s => ({
          day_of_week: s.day,
          start_time:  s.start,
          end_time:    s.end,
        })),
      });
      onTemplateLoadedRef.current?.(activeSlots);
      toast.success(t('availability.saved', { defaultValue: 'Availability saved! Customers can now see your open slots when accepting your bids.' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('availability.saveError', { defaultValue: 'Failed to save availability.' }));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddOverride(e) {
    e.preventDefault();
    if (!overrideDate) return;
    setSavingOverride(true);
    try {
      await api.post('/helper-profile/availability/overrides', {
        override_date: overrideDate,
        is_blocked:    true,
        reason:        overrideReason || null,
      });
      toast.success(t('availability.overrideAdded', { defaultValue: 'Day blocked.' }));
      setOverrideDate('');
      setOverrideReason('');
      setShowOverrideForm(false);
      loadTemplate();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('availability.overrideError', { defaultValue: 'Failed to block date.' }));
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleDeleteOverride(id) {
    try {
      await api.delete(`/helper-profile/availability/overrides/${id}`);
      setOverrides(prev => prev.filter(o => o.id !== id));
    } catch {
      toast.error(t('availability.deleteOverrideError', { defaultValue: 'Failed to remove.' }));
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];

  if (loading) {
    return (
      <div className="hae-loading">
        <div className="hae-spinner" />
        <span>{t('availability.loading', { defaultValue: 'Loading your availability…' })}</span>
      </div>
    );
  }

  return (
    <div className="hae-root">
      {/* Header */}
      <div className="hae-header">
        <div>
          <h2 className="hae-title">{t('availability.title', { defaultValue: 'Your Weekly Availability' })}</h2>
          <p className="hae-subtitle">
            {t('availability.subtitle', { defaultValue: 'Set your typical working hours. Customers see these slots when they accept your bids, giving you the perfect job at the right time.' })}
          </p>
        </div>
        <button className="hae-save-btn" onClick={handleSave} disabled={saving}>
          {saving
            ? t('availability.saving', { defaultValue: 'Saving…' })
            : t('availability.save', { defaultValue: 'Save Schedule' })}
        </button>
      </div>

      {/* Weekly template */}
      <div className="hae-week-grid">
        {slots.map((slot, i) => {
          const hasError = slot.active && (!slot.start || !slot.end || slot.end <= slot.start);
          return (
            <div key={i} className={`hae-day-row ${slot.active ? 'hae-day-active' : 'hae-day-off'} ${hasError ? 'hae-day-error' : ''}`}>
              {/* Day toggle */}
              <label className="hae-day-toggle">
                <input
                  type="checkbox"
                  checked={slot.active}
                  onChange={() => toggleDay(i)}
                  aria-label={DAY_NAMES[i]}
                />
                <span className="hae-day-label">{DAY_NAMES[i]}</span>
              </label>

              {/* Time pickers */}
              {slot.active ? (
                <div className="hae-time-pickers">
                  <select
                    value={slot.start}
                    onChange={e => updateSlot(i, 'start', e.target.value)}
                    aria-label={`${DAY_NAMES[i]} start time`}
                    className="hae-time-select"
                  >
                    {COMMON_TIMES.map(t => (
                      <option key={t} value={t}>{to12(t)}</option>
                    ))}
                  </select>
                  <span className="hae-time-dash">–</span>
                  <select
                    value={slot.end}
                    onChange={e => updateSlot(i, 'end', e.target.value)}
                    aria-label={`${DAY_NAMES[i]} end time`}
                    className="hae-time-select"
                  >
                    {COMMON_TIMES.filter(t => t > slot.start).map(t => (
                      <option key={t} value={t}>{to12(t)}</option>
                    ))}
                  </select>
                  {hasError && (
                    <span className="hae-error-badge" aria-live="polite">
                      {t('availability.endAfterStart', { defaultValue: 'End must be after start' })}
                    </span>
                  )}
                </div>
              ) : (
                <span className="hae-unavailable-label">
                  {t('availability.unavailable', { defaultValue: 'Unavailable' })}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Date overrides */}
      <div className="hae-overrides-section">
        <div className="hae-overrides-header">
          <h3>{t('availability.blockDates', { defaultValue: 'Block Specific Dates' })}</h3>
          <button className="hae-add-override-btn" onClick={() => setShowOverrideForm(v => !v)}>
            {showOverrideForm
              ? t('availability.cancel', { defaultValue: 'Cancel' })
              : t('availability.blockADate', { defaultValue: '+ Block a date' })}
          </button>
        </div>
        <p className="hae-overrides-hint">
          {t('availability.blockHint', { defaultValue: 'Block out holidays, vacations, or any day you\'re unavailable, even if your weekly schedule would normally show you as open.' })}
        </p>

        {showOverrideForm && (
          <form className="hae-override-form" onSubmit={handleAddOverride}>
            <div className="hae-override-fields">
              <div className="hae-field">
                <label>{t('availability.date', { defaultValue: 'Date' })}</label>
                <input
                  type="date"
                  value={overrideDate}
                  onChange={e => setOverrideDate(e.target.value)}
                  min={todayStr}
                  required
                />
              </div>
              <div className="hae-field">
                <label>{t('availability.reason', { defaultValue: 'Reason (optional)' })}</label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  placeholder={t('availability.reasonPlaceholder', { defaultValue: 'e.g. Holiday, Personal day' })}
                  maxLength={120}
                />
              </div>
            </div>
            <button type="submit" className="hae-save-btn" disabled={savingOverride}>
              {savingOverride
                ? t('availability.blocking', { defaultValue: 'Blocking…' })
                : t('availability.blockDay', { defaultValue: 'Block this day' })}
            </button>
          </form>
        )}

        {overrides.length > 0 && (
          <ul className="hae-overrides-list">
            {overrides.map(o => (
              <li key={o.id} className="hae-override-item">
                <span className="hae-override-date">
                  {new Date(o.override_date + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </span>
                {o.reason && <span className="hae-override-reason">{o.reason}</span>}
                <button
                  className="hae-remove-override"
                  onClick={() => handleDeleteOverride(o.id)}
                  aria-label={`Remove block for ${o.override_date}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {overrides.length === 0 && !showOverrideForm && (
          <p className="hae-no-overrides">
            {t('availability.noOverrides', { defaultValue: 'No dates blocked yet.' })}
          </p>
        )}
      </div>
    </div>
  );
}
