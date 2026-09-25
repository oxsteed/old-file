/**
 * BidAcceptanceModal
 *
 * Replaces the simple "Accept Bid" one-click confirm with a real scheduling
 * step: the customer sees the helper's available time slots for the next 28
 * days and picks an exact time before the bid is accepted.
 *
 * Flow:
 *   1. Customer clicks "Accept Bid" on JobDetailPage.
 *   2. This modal opens with the helper's available slots loaded via
 *      GET /api/helpers/:helperId/available-slots.
 *   3. Customer picks a date (left pane) then a time slot (right pane).
 *   4. On confirm, onAccept(bidId, scheduledStart, scheduledEnd) is called.
 *   5. Parent (JobDetailPage) calls assignHelper with the chosen time.
 *
 * If the helper has no availability template set, the modal falls back to
 * the original single-confirm UX (no time forcing) with a polite notice.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import '../../styles/BidAcceptanceModal.css';

// ── helpers ────────────────────────────────────────────────────────────────────

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDateLong(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── component ──────────────────────────────────────────────────────────────────

export default function BidAcceptanceModal({ bid, helperName, jobTitle, onClose, onAccept }) {
  const { t, i18n } = useTranslation();

  const [slots,       setSlots]       = useState([]);   // raw slot array from API
  const [hasTemplate, setHasTemplate] = useState(null); // null = loading
  const [loadError,   setLoadError]   = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [confirming,  setConfirming]  = useState(false);

  // Calendar display state
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const dayLabels = useMemo(() => Array.from({ length: 7 }, (_, index) => (
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(new Date(2021, 7, 1 + index))
  )), [i18n.language]);
  const monthLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(calYear, calMonth, 1)), [calMonth, calYear, i18n.language]);

  // ── load available slots ─────────────────────────────────────
  const loadSlots = useCallback(async () => {
    if (!bid?.helper_id) return;
    try {
      const fromDate = today.toISOString().split('T')[0];
      const toDate = new Date(today);
      toDate.setDate(toDate.getDate() + 27);
      const toStr = toDate.toISOString().split('T')[0];

      const res = await api.get(
        `/helpers/${bid.helper_id}/available-slots?from=${fromDate}&to=${toStr}`
      );
      setSlots(res.data.slots || []);
      setHasTemplate(res.data.hasTemplate);

      // Auto-select the first available date
      if (res.data.slots?.length > 0) {
        const firstDate = new Date(res.data.slots[0].date + 'T00:00:00');
        setSelectedDate(firstDate);
        setCalMonth(firstDate.getMonth());
        setCalYear(firstDate.getFullYear());
      }
    } catch (err) {
      setLoadError(t('bidAccept.loadError', { defaultValue: 'Could not load availability.' }));
      setHasTemplate(false);
    }
  }, [bid?.helper_id, today, t]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  // ── derived: available dates ──────────────────────────────────
  const availableDates = useMemo(() => {
    const set = new Set(slots.map(s => s.date));
    return set;
  }, [slots]);

  // ── derived: slots for selected date ─────────────────────────
  const slotsForDate = useMemo(() => {
    if (!selectedDate) return [];
    const key = selectedDate.toISOString().split('T')[0];
    return slots.filter(s => s.date === key);
  }, [slots, selectedDate]);

  // ── calendar grid for current month ──────────────────────────
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(new Date(calYear, calMonth, d));
    }
    return days;
  }, [calMonth, calYear]);

  // ── handlers ─────────────────────────────────────────────────
  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      await onAccept(bid.id, selectedSlot?.startIso || null, selectedSlot?.endIso || null);
    } finally {
      setConfirming(false);
    }
  }

  // ── render ────────────────────────────────────────────────────
  const loading = hasTemplate === null;

  return (
    <div className="bam-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={t('bidAccept.title', { defaultValue: 'Accept bid and schedule' })}>
      <div className="bam-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bam-header">
          <div className="bam-header-text">
            <h2>{t('bidAccept.title', { defaultValue: 'Pick a time with {{name}}', name: helperName })}</h2>
            <p className="bam-subtitle">{jobTitle}</p>
          </div>
          <button className="bam-close" onClick={onClose} aria-label={t('common.aria.closeButton')}>✕</button>
        </div>

        {/* Body */}
        {loading && (
          <div className="bam-loading">
            <div className="bam-spinner" />
            <span>{t('bidAccept.loading', { defaultValue: 'Loading availability…' })}</span>
          </div>
        )}

        {!loading && !hasTemplate && (
          /* No template set — fallback to simple confirm */
          <div className="bam-no-template">
            <div className="bam-no-template-icon">📅</div>
            <h3>{t('bidAccept.noTemplateTitle', { defaultValue: "{{name}} hasn't set weekly availability yet", name: helperName })}</h3>
            <p>{t('bidAccept.noTemplateBody', { defaultValue: "You can still accept this bid. You'll coordinate the exact time directly with the helper after accepting." })}</p>
            {loadError && <p className="bam-error">{loadError}</p>}
          </div>
        )}

        {!loading && hasTemplate && slots.length === 0 && (
          <div className="bam-no-template">
            <div className="bam-no-template-icon">🗓</div>
            <h3>{t('bidAccept.noSlotsTitle', { defaultValue: 'No availability in the next 28 days' })}</h3>
            <p>{t('bidAccept.noSlotsBody', { defaultValue: 'Accept anyway and coordinate the time directly with the helper.' })}</p>
          </div>
        )}

        {!loading && hasTemplate && slots.length > 0 && (
          <div className="bam-body">
            {/* Left: mini calendar */}
            <div className="bam-calendar-pane">
              <div className="bam-cal-nav">
                <button className="bam-cal-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
                <span className="bam-cal-month-label">{monthLabel} {calYear}</span>
                <button className="bam-cal-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
              </div>

              <div className="bam-cal-grid">
                {dayLabels.map(d => (
                  <div key={d} className="bam-cal-dow">{d}</div>
                ))}
                {calendarDays.map((day, i) => {
                  if (!day) return <div key={`e-${i}`} />;
                  const key = day.toISOString().split('T')[0];
                  const isPast = day < today;
                  const isAvail = availableDates.has(key);
                  const isSelected = selectedDate && isSameDate(day, selectedDate);
                  const isToday = isSameDate(day, today);
                  return (
                    <button
                      key={key}
                      className={[
                        'bam-cal-day',
                        isToday    ? 'bam-cal-today'    : '',
                        isAvail    ? 'bam-cal-avail'    : '',
                        isSelected ? 'bam-cal-selected' : '',
                        isPast || !isAvail ? 'bam-cal-disabled' : '',
                      ].join(' ').trim()}
                      disabled={isPast || !isAvail}
                      onClick={() => {
                        setSelectedDate(day);
                        setSelectedSlot(null);
                      }}
                      aria-label={`${key}${isAvail ? ` - ${t('bidAccept.available')}` : ''}`}
                      aria-pressed={isSelected}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="bam-legend">
                <span className="bam-legend-dot bam-legend-avail" />
                <span>{t('bidAccept.legendAvailable', { defaultValue: 'Available' })}</span>
                <span className="bam-legend-dot bam-legend-selected" />
                <span>{t('bidAccept.legendSelected', { defaultValue: 'Selected' })}</span>
              </div>
            </div>

            {/* Right: time slots */}
            <div className="bam-slots-pane">
              {selectedDate ? (
                <>
                  <h3 className="bam-slots-date-heading">{formatDateLong(selectedDate)}</h3>
                  {slotsForDate.length === 0 ? (
                    <p className="bam-slots-none">
                      {t('bidAccept.noSlotsThisDay', { defaultValue: 'No slots available — pick another day.' })}
                    </p>
                  ) : (
                    <div className="bam-slots-list">
                      {slotsForDate.map(slot => {
                        const isActive = selectedSlot?.startIso === slot.startIso;
                        return (
                          <button
                            key={slot.startIso}
                            className={`bam-slot-btn ${isActive ? 'bam-slot-active' : ''}`}
                            onClick={() => setSelectedSlot(slot)}
                            aria-pressed={isActive}
                          >
                            <span className="bam-slot-time">
                              {formatTime(slot.start)} – {formatTime(slot.end)}
                            </span>
                            {isActive && (
                              <svg className="bam-slot-check" width="16" height="16" viewBox="0 0 24 24"
                                   fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="bam-slots-prompt">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8"  y1="2" x2="8"  y2="6"/>
                    <line x1="3"  y1="10" x2="21" y2="10"/>
                  </svg>
                  <p>{t('bidAccept.selectDatePrompt', { defaultValue: 'Select a highlighted date to see available times' })}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bam-footer">
          <div className="bam-footer-summary">
            {selectedSlot ? (
              <span className="bam-selected-summary">
                ✓ {formatDateLong(selectedDate)} · {formatTime(selectedSlot.start)} – {formatTime(selectedSlot.end)}
              </span>
            ) : hasTemplate && slots.length > 0 ? (
              <span className="bam-selected-summary bam-muted">
                {t('bidAccept.pickTimeToContinue', { defaultValue: 'Pick a time slot to continue' })}
              </span>
            ) : null}
          </div>
          <div className="bam-footer-actions">
            <button className="bam-btn-secondary" onClick={onClose} disabled={confirming}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              className="bam-btn-primary"
              onClick={handleConfirm}
              disabled={confirming || (hasTemplate && slots.length > 0 && !selectedSlot)}
            >
              {confirming
                ? t('bidAccept.accepting', { defaultValue: 'Accepting…' })
                : selectedSlot
                  ? t('bidAccept.confirmWithTime', { defaultValue: 'Confirm & Schedule' })
                  : t('bidAccept.confirmAnyway', { defaultValue: 'Accept Bid' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
