/**
 * Pure helpers for in-messenger booking request cards.
 * Runtime marker fields: booking request id, status, date, start/end times,
 * encoded name, and service id.
 */

export function encodeBookingName(name) {
  return encodeURIComponent(String(name || 'Service').trim().slice(0, 120));
}

export function decodeBookingName(enc) {
  try {
    return decodeURIComponent(String(enc || ''));
  } catch {
    return String(enc || '');
  }
}

export function normalizeBookingClock(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

export function toBookingChatStatus(status) {
  const s = String(status || '').toLowerCase();
  const allowed = new Set([
    'pending',
    'accepted',
    'declined',
    'expired',
    'cancelled',
    'accepted_cancelled',
    'counter_proposed',
  ]);
  return allowed.has(s) ? s : 'pending';
}

export function buildBookingRequestMarker({
  id,
  status = 'pending',
  date,
  start,
  end,
  serviceName = '',
  serviceId = null,
} = {}) {
  const bid = id != null ? String(id).trim() : '';
  const d = String(date || '').slice(0, 10);
  const s = normalizeBookingClock(start);
  const e = normalizeBookingClock(end);
  if (!bid || !d || !s || !e) return '';
  const parts = [`booking_req:${bid}|${toBookingChatStatus(status)}|${d}|${s}|${e}`];
  const name = String(serviceName || '').trim();
  if (name) parts.push(`name:${encodeBookingName(name)}`);
  if (serviceId != null && String(serviceId).trim()) {
    parts.push(`svc:${String(serviceId).trim()}`);
  }
  return `[${parts.join('|')}]`;
}

export function parseBookingRequestMarker(text) {
  const match = String(text || '').match(
    /\[booking_req:([^|\]]+)\|([^|\]]+)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})(?:\|([^\]]+))?\]/i,
  );
  if (!match) return null;
  const extra = { serviceName: '', serviceId: null };
  if (match[6]) {
    for (const part of String(match[6]).split('|')) {
      if (part.startsWith('name:')) extra.serviceName = decodeBookingName(part.slice(5));
      else if (part.startsWith('svc:')) extra.serviceId = part.slice(4);
    }
  }
  return {
    id: match[1],
    status: toBookingChatStatus(match[2]),
    date: match[3],
    start: match[4],
    end: match[5],
    ...extra,
    raw: match[0],
  };
}

export function stripBookingRequestMarkers(text) {
  return String(text || '')
    .replace(/\[booking_req:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function canProviderRespondBooking(status) {
  const s = toBookingChatStatus(status);
  return s === 'pending' || s === 'counter_proposed' || s === 'expired';
}

/** Customer / verified guest can Accept or Decline a provider-proposed time. */
export function canCustomerRespondBooking(status) {
  return toBookingChatStatus(status) === 'counter_proposed';
}

export function appendBookingRequestMarker(messageText, markerOpts) {
  const marker = buildBookingRequestMarker(markerOpts);
  if (!marker) return String(messageText || '');
  const base = String(messageText || '').trim();
  if (base.includes('[booking_req:')) return base;
  return base ? `${base}\n${marker}` : marker;
}

export function buildProposeBookingPayload(slot) {
  if (!slot?.date || !slot?.start || !slot?.end) return null;
  const start = String(slot.start);
  const end = String(slot.end);
  return {
    requestedDate: String(slot.date).slice(0, 10),
    requestedStartTime: start.length === 5 ? `${start}:00` : start,
    requestedEndTime: end.length === 5 ? `${end}:00` : end,
    startIso: slot.startIso || undefined,
    endIso: slot.endIso || undefined,
    timezone: slot.timezone || undefined,
  };
}

/**
 * Body for POST /chat/booking-requests when inbox/ChatPanel Schedule has no quote.
 */
export function buildInboxScheduleBookingBody({
  conversationId,
  helperId = null,
  businessId = null,
  serviceId = null,
  serviceName = '',
  date,
  start,
  end,
  startIso = null,
  endIso = null,
  timezone = null,
  description = null,
  source = 'messenger_inbox_schedule',
} = {}) {
  if (!conversationId || !date || !start || !end) return null;
  const s = String(start);
  const e = String(end);
  return {
    conversationId,
    helperId: helperId || undefined,
    businessId: businessId || undefined,
    serviceId: serviceId != null && String(serviceId).trim() ? serviceId : undefined,
    serviceName: String(serviceName || 'Service request').trim().slice(0, 200),
    requestedDate: String(date).slice(0, 10),
    requestedStartTime: s.length === 5 ? `${s}:00` : s,
    requestedEndTime: e.length === 5 ? `${e}:00` : e,
    startIso: startIso || undefined,
    endIso: endIso || undefined,
    timezone: timezone || undefined,
    description: description || undefined,
    source,
  };
}
