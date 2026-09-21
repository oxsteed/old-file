'use strict';

/**
 * Pure helpers + DB-facing builders for in-chat quotes.
 * Marker format mirrors booking_slot / attachment conventions:
 *   [quote:kind|id|token|status|total_cents|title_enc|valid_until|version]
 */

const crypto = require('crypto');

const QUOTE_KINDS = new Set(['business', 'helper']);
const RESPOND_ACTIONS = new Set(['accept', 'decline', 'request_changes']);

/** Normalize business "approved" ↔ helper "accepted" for chat UI. */
function toChatStatus(kind, dbStatus) {
  const s = String(dbStatus || '').toLowerCase();
  if (s === 'approved' || s === 'accepted') return 'accepted';
  if (s === 'sent' || s === 'draft') return s === 'draft' ? 'draft' : 'sent';
  if (s === 'declined' || s === 'expired' || s === 'withdrawn' || s === 'converted') return s;
  if (s === 'superseded') return 'superseded';
  return s || 'sent';
}

function toDbAcceptStatus(kind) {
  return kind === 'business' ? 'approved' : 'accepted';
}

function isQuoteExpired(row, now = new Date()) {
  if (!row) return true;
  const status = String(row.status || '').toLowerCase();
  if (status === 'expired' || status === 'withdrawn') return true;
  if (row.superseded_at) return true;
  if (!row.valid_until) return false;
  const until = new Date(row.valid_until);
  if (Number.isNaN(until.getTime())) return false;
  // DATE-only values expire at end of that calendar day UTC-ish; compare date parts.
  const untilDay = until.toISOString().slice(0, 10);
  const nowDay = now.toISOString().slice(0, 10);
  // If stored as date-only midnight, treat valid_until as inclusive through that day.
  if (String(row.valid_until).length <= 10 || /T00:00:00/.test(String(row.valid_until))) {
    return nowDay > untilDay;
  }
  return now.getTime() > until.getTime();
}

function canRespond(row, now = new Date()) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.superseded_at) return { ok: false, reason: 'superseded' };
  const status = String(row.status || '').toLowerCase();
  if (!['sent'].includes(status)) {
    if (['approved', 'accepted'].includes(status)) return { ok: false, reason: 'already_accepted' };
    if (status === 'declined') return { ok: false, reason: 'already_declined' };
    if (status === 'expired' || status === 'withdrawn') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid_status' };
  }
  if (isQuoteExpired(row, now)) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function encodeTitle(title) {
  return encodeURIComponent(String(title || 'Quote').trim().slice(0, 120));
}

function decodeTitle(enc) {
  try {
    return decodeURIComponent(String(enc || ''));
  } catch {
    return String(enc || '');
  }
}

function formatValidUntil(value) {
  if (!value) return '';
  const s = String(value);
  return s.slice(0, 10);
}

/**
 * Build structured chat marker.
 * @param {{ kind: string, id: string|number, token?: string, status?: string, totalCents?: number, title?: string, validUntil?: string|Date|null, version?: number }} opts
 */
function buildQuoteMarker(opts = {}) {
  const kind = String(opts.kind || '').toLowerCase();
  if (!QUOTE_KINDS.has(kind)) return '';
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const token = String(opts.token || '').trim() || 'none';
  const status = toChatStatus(kind, opts.status || 'sent');
  const total = Number.isFinite(Number(opts.totalCents)) ? Math.round(Number(opts.totalCents)) : 0;
  const title = encodeTitle(opts.title);
  const valid = formatValidUntil(opts.validUntil);
  const version = Math.max(1, parseInt(opts.version, 10) || 1);
  return `[quote:${kind}|${id}|${token}|${status}|${total}|${title}|${valid}|v${version}]`;
}

/**
 * Parse first quote marker in text.
 * @returns {null|{ kind, id, token, status, totalCents, title, validUntil, version, raw }}
 */
function parseQuoteMarker(text) {
  const match = String(text || '').match(
    /\[quote:(business|helper)\|([^|\]]+)\|([^|\]]*)\|([^|\]]*)\|(\d+)\|([^|\]]*)\|([^|\]]*)\|v?(\d+)\]/i,
  );
  if (!match) return null;
  return {
    kind: match[1].toLowerCase(),
    id: match[2],
    token: match[3] === 'none' ? '' : match[3],
    status: match[4].toLowerCase() || 'sent',
    totalCents: parseInt(match[5], 10) || 0,
    title: decodeTitle(match[6]),
    validUntil: match[7] || '',
    version: parseInt(match[8], 10) || 1,
    raw: match[0],
  };
}

/** Strip marker(s) from display text. */
function stripQuoteMarkers(text) {
  return String(text || '')
    .replace(/\[quote:(business|helper)\|[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildShareMessageContent({ marker, title, totalCents, tPreface }) {
  if (!marker) return '';
  const dollars = ((Number(totalCents) || 0) / 100).toFixed(2);
  const preface =
    typeof tPreface === 'string' && tPreface.trim()
      ? tPreface.trim()
      : `Quote: ${title || 'Estimate'} — $${dollars}`;
  return `${preface}\n${marker}`;
}

function buildRequestChangesMessage({ title, reason }) {
  const t = String(title || 'quote').trim();
  const r = String(reason || '').trim();
  if (r) {
    return `I'd like some changes on the quote "${t}": ${r}`;
  }
  return `I'd like some changes on the quote "${t}". Could you revise the line items or total?`;
}

function newQuoteToken() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeLineItems(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return { error: 'At least one line item is required' };
  }
  const items = value.map((item) => {
    const quantity = Number(item?.quantity);
    const unitPriceCents =
      item?.unit_price_cents !== undefined
        ? Number(item.unit_price_cents)
        : Math.round(Number(item?.unit_price) * 100);
    const description = String(item?.description || '').trim();
    if (
      !description ||
      description.length > 500 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000 ||
      !Number.isFinite(unitPriceCents) ||
      !Number.isInteger(unitPriceCents) ||
      unitPriceCents < 0 ||
      unitPriceCents > 100000000
    ) {
      return null;
    }
    return {
      description,
      quantity,
      unit_price: unitPriceCents / 100,
      unit_price_cents: unitPriceCents,
    };
  });
  if (items.some((i) => !i)) {
    return { error: 'Each line item needs a description, positive quantity, and valid price' };
  }
  return { items };
}

function calculateTotals(lineItems, taxRatePercent) {
  const subtotal = Math.round(
    lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0),
  );
  const rate = Number(taxRatePercent) || 0;
  const tax = Math.round((subtotal * rate) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Public card DTO (safe for customer/guest). */
function toPublicQuoteCard(kind, row) {
  if (!row) return null;
  const chatStatus = toChatStatus(kind, row.status);
  const expired = isQuoteExpired(row);
  return {
    kind,
    id: String(row.id),
    token: row.token || null,
    title: row.title || 'Quote',
    description: row.description || row.notes || null,
    line_items: Array.isArray(row.line_items)
      ? row.line_items
      : typeof row.line_items === 'string'
        ? JSON.parse(row.line_items)
        : [],
    subtotal_cents: Number(row.subtotal_cents) || 0,
    tax_rate: Number(row.tax_rate) || 0,
    tax_cents: Number(row.tax_cents) || Math.round(((Number(row.subtotal_cents) || 0) * (Number(row.tax_rate) || 0)) / 100),
    total_cents: Number(row.total_cents) || 0,
    status: chatStatus,
    db_status: row.status,
    valid_until: row.valid_until || null,
    expired,
    can_respond: canRespond(row).ok && !expired,
    version: Number(row.version) || 1,
    superseded_at: row.superseded_at || null,
    conversation_id: row.conversation_id || null,
    guest_session_id: row.guest_session_id || null,
    booking_request_id: row.booking_request_id || null,
    appointment_id: row.appointment_id || null,
    decline_reason: row.decline_reason || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  QUOTE_KINDS,
  RESPOND_ACTIONS,
  toChatStatus,
  toDbAcceptStatus,
  isQuoteExpired,
  canRespond,
  buildQuoteMarker,
  parseQuoteMarker,
  stripQuoteMarkers,
  buildShareMessageContent,
  buildRequestChangesMessage,
  newQuoteToken,
  normalizeLineItems,
  calculateTotals,
  toPublicQuoteCard,
  encodeTitle,
  decodeTitle,
  formatValidUntil,
};
