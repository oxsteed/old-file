'use strict';

/**
 * In-chat booking request markers + public card helpers.
 * Marker: [booking_req:ID|status|YYYY-MM-DD|HH:MM|HH:MM|name:ENC|svc:ID]
 */

const STATUSES = new Set([
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'accepted_cancelled',
  'counter_proposed',
]);

function encodeName(name) {
  return encodeURIComponent(String(name || 'Service').trim().slice(0, 120));
}

function decodeName(enc) {
  try {
    return decodeURIComponent(String(enc || ''));
  } catch {
    return String(enc || '');
  }
}

function normalizeClock(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function normalizeDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function toChatStatus(status) {
  const s = String(status || '').toLowerCase();
  if (STATUSES.has(s)) return s;
  return 'pending';
}

/**
 * @param {{ id: string, status?: string, date?: string, start?: string, end?: string, serviceName?: string, serviceId?: string|number|null }} opts
 */
function buildBookingRequestMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const status = toChatStatus(opts.status || 'pending');
  const date = normalizeDate(opts.date || opts.requestedDate || opts.requested_date);
  const start = normalizeClock(opts.start || opts.requestedStartTime || opts.requested_start_time);
  const end = normalizeClock(opts.end || opts.requestedEndTime || opts.requested_end_time);
  if (!date || !start || !end) return '';
  const parts = [`booking_req:${id}|${status}|${date}|${start}|${end}`];
  const name = String(opts.serviceName || opts.service_name || '').trim();
  if (name) parts.push(`name:${encodeName(name)}`);
  if (opts.serviceId != null && String(opts.serviceId).trim()) {
    parts.push(`svc:${String(opts.serviceId).trim()}`);
  }
  return `[${parts.join('|')}]`;
}

function parseBookingRequestMarker(text) {
  const match = String(text || '').match(
    /\[booking_req:([^|\]]+)\|([^|\]]+)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})(?:\|([^\]]+))?\]/i,
  );
  if (!match) return null;
  const extra = { serviceName: '', serviceId: null };
  if (match[6]) {
    for (const part of String(match[6]).split('|')) {
      if (part.startsWith('name:')) extra.serviceName = decodeName(part.slice(5));
      else if (part.startsWith('svc:')) extra.serviceId = part.slice(4);
    }
  }
  return {
    id: match[1],
    status: toChatStatus(match[2]),
    date: match[3],
    start: match[4],
    end: match[5],
    ...extra,
    raw: match[0],
  };
}

function stripBookingRequestMarkers(text) {
  return String(text || '')
    .replace(/\[booking_req:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function canProviderRespond(row) {
  if (!row) return { ok: false, reason: 'not_found' };
  const status = toChatStatus(row.status);
  if (status === 'pending' || status === 'counter_proposed' || status === 'expired') {
    return { ok: true };
  }
  if (status === 'accepted') return { ok: false, reason: 'already_accepted' };
  if (status === 'declined') return { ok: false, reason: 'already_declined' };
  if (status === 'cancelled' || status === 'accepted_cancelled') {
    return { ok: false, reason: 'cancelled' };
  }
  return { ok: false, reason: 'invalid_status' };
}

function formatTimePart(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return normalizeClock(
      `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
    );
  }
  return normalizeClock(value);
}

function toPublicBookingRequestCard(row) {
  if (!row) return null;
  const date = normalizeDate(row.requested_date || row.requestedDate);
  const start = formatTimePart(row.requested_start_time || row.requestedStartTime);
  const end = formatTimePart(row.requested_end_time || row.requestedEndTime);
  const status = toChatStatus(row.status);
  return {
    id: String(row.id),
    status,
    service_name: row.service_name || row.serviceName || 'Service request',
    service_id: row.service_id || row.serviceId || null,
    requested_date: date,
    requested_start_time: start,
    requested_end_time: end,
    helper_id: row.helper_id || null,
    business_id: row.business_id || null,
    customer_id: row.customer_id || null,
    conversation_id: row.conversation_id || null,
    guest_session_id: row.guest_session_id || null,
    appointment_id: row.appointment_id != null ? String(row.appointment_id) : null,
    quote_kind: row.quote_kind || null,
    quote_id: row.quote_id != null ? String(row.quote_id) : null,
    source: row.source || 'direct',
    timezone: row.timezone || null,
    helper_response_reason: row.helper_response_reason || null,
    expires_at: row.expires_at || null,
    accepted_at: row.accepted_at || null,
    declined_at: row.declined_at || null,
    created_at: row.created_at || null,
    can_respond: canProviderRespond(row).ok,
    marker: buildBookingRequestMarker({
      id: row.id,
      status,
      date,
      start,
      end,
      serviceName: row.service_name || row.serviceName,
      serviceId: row.service_id || row.serviceId,
    }),
  };
}

function buildStatusMessage({ booking, event, reason = '' }) {
  const card = toPublicBookingRequestCard(booking);
  if (!card) return '';
  const when = `${card.requested_date} ${card.requested_start_time}–${card.requested_end_time}`;
  const title = card.service_name;
  let label = `Booking request: ${title} · ${when}`;
  if (event === 'accepted') label = `Booking accepted: ${title} · ${when}`;
  else if (event === 'declined') {
    label = reason
      ? `Booking declined: ${title} · ${when} — ${String(reason).slice(0, 200)}`
      : `Booking declined: ${title} · ${when}`;
  } else if (event === 'counter_proposed') {
    label = `Different time proposed: ${title} · ${when}`;
  } else if (event === 'requested') {
    label = `Booking requested: ${title} · ${when}`;
  }
  return `${card.marker}\n${label}`;
}

module.exports = {
  STATUSES,
  buildBookingRequestMarker,
  parseBookingRequestMarker,
  stripBookingRequestMarkers,
  toChatStatus,
  canProviderRespond,
  toPublicBookingRequestCard,
  buildStatusMessage,
  normalizeClock,
  normalizeDate,
};
