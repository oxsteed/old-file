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
 * Base: [booking_slot:YYYY-MM-DD|HH:MM|HH:MM]
 * Extended: …|svc:ID|name:ENCODED|tz:ZONE
 */
export function buildBookingSlotMarker({
  date,
  start,
  end,
  serviceId = null,
  serviceName = '',
  timezone = '',
} = {}) {
  const d = String(date || '').slice(0, 10);
  const s = normalizeClock(start);
  const e = normalizeClock(end);
  if (!d || !s || !e) return '';
  const parts = [`booking_slot:${d}|${s}|${e}`];
  if (serviceId != null && String(serviceId).trim()) {
    parts.push(`svc:${String(serviceId).trim()}`);
  }
  const name = String(serviceName || '').trim();
  if (name) {
    parts.push(`name:${encodeURIComponent(name).slice(0, 120)}`);
  }
  const tz = String(timezone || '').trim();
  if (tz) {
    parts.push(`tz:${encodeURIComponent(tz).slice(0, 80)}`);
  }
  return `[${parts.join('|')}]`;
}

/** @deprecated alias — same as buildBookingSlotMarker */
export function buildBookingSlotMarkerExtended(opts) {
  return buildBookingSlotMarker(opts);
}

export function parseBookingSlotMarker(text) {
  const match = String(text || '').match(
    /\[booking_slot:(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})(?:\|([^\]]+))?\]/,
  );
  if (!match) return null;
  const extra = { serviceId: null, serviceName: '', timezone: '' };
  if (match[4]) {
    for (const part of String(match[4]).split('|')) {
      if (part.startsWith('svc:')) extra.serviceId = part.slice(4);
      else if (part.startsWith('name:')) {
        try {
          extra.serviceName = decodeURIComponent(part.slice(5));
        } catch {
          extra.serviceName = part.slice(5);
        }
      } else if (part.startsWith('tz:')) {
        try {
          extra.timezone = decodeURIComponent(part.slice(3));
        } catch {
          extra.timezone = part.slice(3);
        }
      }
    }
  }
  return { date: match[1], start: match[2], end: match[3], ...extra };
}

/**
 * Human + machine chat payload for a chosen availability slot.
 * @param {object} options
 * @param {string} options.date
 * @param {string} options.start
 * @param {string} options.end
 * @param {string} [options.providerName]
 * @param {string} [options.locale]
 * @param {(key: string, options?: object) => string} [options.t]
 * @param {string|number|null} [options.serviceId]
 * @param {string} [options.serviceName]
 * @param {string} [options.timezone]
 * @returns {string}
 */
export function buildSlotRequestMessage({
  date,
  start,
  end,
  providerName = '',
  locale = 'en',
  t,
  serviceId = null,
  serviceName = '',
  timezone = '',
} = {}) {
  const tz = timezone || resolveClientTimezone();
  const marker = buildBookingSlotMarker({
    date,
    start,
    end,
    serviceId,
    serviceName,
    timezone: tz,
  });
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

  const svc = String(serviceName || '').trim();
  if (typeof t === 'function') {
    return t('helperProfile.messenger.slotRequestMessage', {
      when: whenLabel,
      name: providerName || '',
      service: svc,
      marker,
      defaultValue: svc
        ? `I'd like to request ${svc}: ${whenLabel}\n${marker}`
        : `I'd like to request: ${whenLabel}\n${marker}`,
    });
  }

  const nameBit = providerName ? ` with ${providerName}` : '';
  const svcBit = svc ? ` ${svc}` : '';
  return `I'd like to request${svcBit}${nameBit}: ${whenLabel}\n${marker}`;
}

/**
 * Bookable business/helper service rows (online booking + active).
 */
export function filterBookableServices(list) {
  const rows = Array.isArray(list) ? list : [];
  return rows
    .filter((s) => s && (s.id != null || s.service_id != null))
    .filter((s) => s.allow_online_booking !== false && s.is_active !== false && s.active !== false)
    .map((s) => ({
      id: s.id ?? s.service_id,
      name: String(s.name || s.title || s.service_name || '').trim() || `Service ${s.id ?? s.service_id}`,
      durationMinutes: Number(s.duration_minutes || s.durationMinutes || s.duration) || null,
      price: s.price != null ? Number(s.price) : null,
      raw: s,
    }));
}

export function pickDefaultBookableService(list) {
  const bookable = filterBookableServices(list);
  return bookable[0] || null;
}

/** IANA timezone when available; falls back to offset label. */
export function resolveClientTimezone(date = new Date()) {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `UTC${sign}${hh}:${mm}`;
  }
}

/**
 * API payload for creating a pending booking/appointment from a messenger slot.
 * @param {object} options
 * @param {string|number|null} [options.helperId]
 * @param {string|number|null} [options.businessId]
 * @param {string|number|null} [options.serviceId]
 * @param {string} [options.serviceName]
 * @param {string} options.date
 * @param {string} options.start
 * @param {string} options.end
 * @param {string|null} [options.startIso]
 * @param {string|null} [options.endIso]
 * @param {string} [options.timezone]
 * @param {string|null} [options.guestSessionId]
 * @param {string|null} [options.clientRequestId]
 * @param {string} [options.description]
 * @returns {object|null}
 */
export function buildMessengerBookingPayload({
  helperId = null,
  businessId = null,
  serviceId = null,
  serviceName = '',
  date,
  start,
  end,
  startIso = null,
  endIso = null,
  timezone = '',
  guestSessionId = null,
  clientRequestId = null,
  description = '',
} = {}) {
  const d = String(date || '').slice(0, 10);
  const s = normalizeClock(start);
  const e = normalizeClock(end);
  if (!d || !s || !e) return null;
  const tz = timezone || resolveClientTimezone();
  return {
    helperId: helperId || undefined,
    businessId: businessId || undefined,
    serviceId: serviceId != null && String(serviceId).trim() ? serviceId : undefined,
    serviceName: String(serviceName || 'Service request').trim().slice(0, 200),
    requestedDate: d,
    requestedStartTime: s.length === 5 ? `${s}:00` : s,
    requestedEndTime: e.length === 5 ? `${e}:00` : e,
    startIso: startIso || `${d}T${s}:00`,
    endIso: endIso || `${d}T${e}:00`,
    timezone: tz,
    guestSessionId: guestSessionId || undefined,
    clientRequestId: clientRequestId || undefined,
    description: String(description || '').trim().slice(0, 2000) || undefined,
  };
}

/**
 * Localized confirmation content for a successfully submitted slot request.
 * @param {object} options
 * @param {string} options.whenLabel
 * @param {string} [options.serviceName]
 * @param {string|number|null} [options.bookingId]
 * @param {string|number|null} [options.appointmentId]
 * @param {(key: string, options?: object) => string} [options.t]
 * @returns {string}
 */
export function buildSlotConfirmationContent({
  whenLabel,
  serviceName = '',
  bookingId = null,
  appointmentId = null,
  t,
} = {}) {
  const svc = String(serviceName || '').trim();
  const fallback = svc
    ? `Booking request sent for ${svc} · ${whenLabel}`
    : `Booking request sent · ${whenLabel}`;
  if (typeof t === 'function') {
    if (svc) {
      return t('helperProfile.messenger.slotBookingConfirmed', {
        when: whenLabel,
        service: svc,
        id: bookingId || appointmentId || '',
        defaultValue: fallback,
      });
    }
    return t('helperProfile.messenger.slotBookingConfirmedPlain', {
      when: whenLabel,
      id: bookingId || appointmentId || '',
      defaultValue: fallback,
    });
  }
  return fallback;
}

/**
 * Whether the in-dock availability toggle / MessengerAvailabilityPicker should
 * be offered for this chat session.
 *
 * - OxSteed AI destination never shows provider slots.
 * - `destination === 'business'` or a present `businessId` → business slots API.
 * - `destination === 'helper'` or a present `helperId` → helper availability.
 *
 * @param {{ destination?: string|null, businessId?: string|number|null, helperId?: string|number|null }} [opts]
 * @returns {boolean}
 */
/**
 * Provider side of the profile dock (helper personal or business entity).
 * OxSteed AI is excluded.
 * @param {string|null|undefined} destination
 * @returns {boolean}
 */
export function isProviderChatDestination(destination) {
  const dest = String(destination || '').trim().toLowerCase();
  return dest === 'helper' || dest === 'business';
}

export function canShowAvailabilityPicker({
  destination = null,
  businessId = null,
  helperId = null,
} = {}) {
  const dest = String(destination || '').trim().toLowerCase();
  if (dest === 'oxsteed') return false;

  const hasBusiness = businessId != null && String(businessId).trim() !== '';
  const hasHelper = helperId != null && String(helperId).trim() !== '';

  if (dest === 'business') return true;
  if (hasBusiness) return true;
  if (dest === 'helper') return true;
  if (hasHelper) return true;
  return false;
}
