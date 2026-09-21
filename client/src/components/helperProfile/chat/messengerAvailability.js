/**
 * Pure helpers for in-messenger availability / slot picking.
 * Kept free of React so messengerDock tests can cover them.
 */

/** YYYY-MM-DD in local time */
export function toLocalDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {number} [daysAhead=14]
 * @param {Date} [now]
 * @returns {{ from: string, to: string }}
 */
export function buildAvailabilityRange(daysAhead = 14, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, Number(daysAhead) || 14));
  return { from: toLocalDateKey(start), to: toLocalDateKey(end) };
}

/** "HH:MM" or "HH:MM:SS" → "HH:MM" */
export function normalizeClock(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

/**
 * Normalize helper available-slots API rows into a common shape.
 * @param {object} payload
 * @returns {{ slots: Array, hasTemplate: boolean }}
 */
export function normalizeHelperAvailabilityPayload(payload) {
  const rows = Array.isArray(payload?.slots) ? payload.slots : [];
  const slots = rows
    .map((row) => {
      const date = String(row?.date || '').slice(0, 10);
      const start = normalizeClock(row?.start || row?.startTime);
      const end = normalizeClock(row?.end || row?.endTime);
      if (!date || !start || !end) return null;
      return {
        date,
        start,
        end,
        startIso: row?.startIso || `${date}T${start}:00`,
        endIso: row?.endIso || `${date}T${end}:00`,
        source: 'helper',
      };
    })
    .filter(Boolean);
  return {
    slots,
    hasTemplate: payload?.hasTemplate !== false || slots.length > 0,
  };
}

/**
 * Normalize business service slots ({ start, end } ISO) into the same shape.
 */
export function normalizeBusinessAvailabilityPayload(payload) {
  const rows = Array.isArray(payload?.slots)
    ? payload.slots
    : Array.isArray(payload?.available_slots)
      ? payload.available_slots
      : [];
  const slots = rows
    .map((row) => {
      const startRaw = row?.start || row?.start_time || row?.startTime || row?.startIso;
      const endRaw = row?.end || row?.end_time || row?.endTime || row?.endIso;
      const startDate = startRaw ? new Date(startRaw) : null;
      const endDate = endRaw ? new Date(endRaw) : null;
      if (!startDate || Number.isNaN(startDate.getTime())) return null;
      const date = toLocalDateKey(startDate);
      const start = normalizeClock(
        `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
      );
      const end = endDate && !Number.isNaN(endDate.getTime())
        ? normalizeClock(
            `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`,
          )
        : '';
      if (!date || !start) return null;
      return {
        date,
        start,
        end: end || start,
        startIso: startDate.toISOString(),
        endIso: endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString() : startDate.toISOString(),
        source: 'business',
        serviceId: payload?.service_id || row?.service_id || null,
        staffId: row?.staff_id || null,
      };
    })
    .filter(Boolean);
  return { slots, hasTemplate: slots.length > 0 };
}

/** Unique sorted date keys that have at least one slot */
export function listAvailabilityDates(slots) {
  const set = new Set();
  for (const slot of Array.isArray(slots) ? slots : []) {
    if (slot?.date) set.add(String(slot.date).slice(0, 10));
  }
  return [...set].sort();
}

export function slotsForDate(slots, dateKey) {
  const key = String(dateKey || '').slice(0, 10);
  return (Array.isArray(slots) ? slots : []).filter((s) => s.date === key);
}

/**
 * Structured marker providers (and future parsers) can recognize in chat text.
 * Example: [booking_slot:2026-09-22|09:00|10:00]
 */
export function buildBookingSlotMarker({ date, start, end }) {
  const d = String(date || '').slice(0, 10);
  const s = normalizeClock(start);
  const e = normalizeClock(end);
  if (!d || !s || !e) return '';
  return `[booking_slot:${d}|${s}|${e}]`;
}

/**
 * Human + machine chat payload for a chosen availability slot.
 * @param {object} opts
 * @param {string} opts.date
 * @param {string} opts.start
 * @param {string} opts.end
 * @param {string} [opts.providerName]
 * @param {string} [opts.locale]
 * @param {(key: string, vars?: object) => string} [opts.t] i18n function
 */
export function buildSlotRequestMessage({
  date,
  start,
  end,
  providerName = '',
  locale = 'en',
  t,
} = {}) {
  const marker = buildBookingSlotMarker({ date, start, end });
  if (!marker) return '';

  let whenLabel = `${date} ${normalizeClock(start)}–${normalizeClock(end)}`;
  try {
    const [y, m, d] = String(date).split('-').map(Number);
    const startDate = new Date(y, (m || 1) - 1, d || 1, ...normalizeClock(start).split(':').map(Number));
    const endDate = new Date(y, (m || 1) - 1, d || 1, ...normalizeClock(end).split(':').map(Number));
    const dayPart = startDate.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startPart = startDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const endPart = endDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    whenLabel = `${dayPart} · ${startPart} – ${endPart}`;
  } catch {
    /* keep fallback */
  }

  if (typeof t === 'function') {
    return t('helperProfile.messenger.slotRequestMessage', {
      when: whenLabel,
      name: providerName || '',
      marker,
      defaultValue: `I'd like to request: ${whenLabel}\n${marker}`,
    });
  }

  const nameBit = providerName ? ` with ${providerName}` : '';
  return `I'd like to request${nameBit}: ${whenLabel}\n${marker}`;
}

export function parseBookingSlotMarker(text) {
  const match = String(text || '').match(/\[booking_slot:(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})\]/);
  if (!match) return null;
  return { date: match[1], start: match[2], end: match[3] };
}
