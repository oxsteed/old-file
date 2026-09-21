/**
 * Pure helpers for in-messenger quote cards / markers.
 * Marker: [quote:kind|id|token|status|total_cents|title_enc|valid_until|version]
 */

export const QUOTE_KINDS = ['business', 'helper'];

export function encodeQuoteTitle(title) {
  return encodeURIComponent(String(title || 'Quote').trim().slice(0, 120));
}

export function decodeQuoteTitle(enc) {
  try {
    return decodeURIComponent(String(enc || ''));
  } catch {
    return String(enc || '');
  }
}

export function formatQuoteValidUntil(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function toChatQuoteStatus(kind, dbStatus) {
  const s = String(dbStatus || '').toLowerCase();
  if (s === 'approved' || s === 'accepted') return 'accepted';
  if (s === 'sent' || s === 'draft') return s === 'draft' ? 'draft' : 'sent';
  if (['declined', 'expired', 'withdrawn', 'converted', 'superseded', 'scheduled'].includes(s)) {
    return s;
  }
  return s || 'sent';
}

export function isQuoteExpired(row, now = new Date()) {
  if (!row) return true;
  const status = String(row.status || row.db_status || '').toLowerCase();
  if (status === 'expired' || status === 'withdrawn') return true;
  if (row.superseded_at) return true;
  if (row.expired === true) return true;
  const validUntil = row.valid_until || row.validUntil;
  if (!validUntil) return false;
  const until = new Date(validUntil);
  if (Number.isNaN(until.getTime())) return false;
  const untilDay = until.toISOString().slice(0, 10);
  const nowDay = now.toISOString().slice(0, 10);
  if (String(validUntil).length <= 10 || /T00:00:00/.test(String(validUntil))) {
    return nowDay > untilDay;
  }
  return now.getTime() > until.getTime();
}

/**
 * @param {{ kind: string, id: string|number, token?: string, status?: string, totalCents?: number, title?: string, validUntil?: string|Date|null, version?: number }} opts
 */
export function buildQuoteMarker(opts = {}) {
  const kind = String(opts.kind || '').toLowerCase();
  if (!QUOTE_KINDS.includes(kind)) return '';
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const token = String(opts.token || '').trim() || 'none';
  const status = toChatQuoteStatus(kind, opts.status || 'sent');
  const total = Number.isFinite(Number(opts.totalCents)) ? Math.round(Number(opts.totalCents)) : 0;
  const title = encodeQuoteTitle(opts.title);
  const valid = formatQuoteValidUntil(opts.validUntil);
  const version = Math.max(1, parseInt(opts.version, 10) || 1);
  return `[quote:${kind}|${id}|${token}|${status}|${total}|${title}|${valid}|v${version}]`;
}

export function parseQuoteMarker(text) {
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
    title: decodeQuoteTitle(match[6]),
    validUntil: match[7] || '',
    version: parseInt(match[8], 10) || 1,
    raw: match[0],
  };
}

export function parseQuoteStatusMarker(text) {
  const match = String(text || '').match(
    /\[quote_status:(business|helper)\|([^|\]]+)\|([a-z_]+)\]/i,
  );
  if (!match) return null;
  return {
    kind: match[1].toLowerCase(),
    id: match[2],
    status: match[3].toLowerCase(),
    raw: match[0],
  };
}

export function stripQuoteMarkers(text) {
  return String(text || '')
    .replace(/\[quote:(business|helper)\|[^\]]+\]/gi, '')
    .replace(/\[quote_status:(business|helper)\|[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildShareMessageContent({ marker, title, totalCents, preface } = {}) {
  if (!marker) return '';
  const dollars = ((Number(totalCents) || 0) / 100).toFixed(2);
  const head =
    typeof preface === 'string' && preface.trim()
      ? preface.trim()
      : `Quote: ${title || 'Estimate'} — $${dollars}`;
  return `${head}\n${marker}`;
}

export function buildRequestChangesMessage({ title, reason } = {}) {
  const t = String(title || 'quote').trim();
  const r = String(reason || '').trim();
  if (r) return `I'd like some changes on the quote "${t}": ${r}`;
  return `I'd like some changes on the quote "${t}". Could you revise the line items or total?`;
}

export function formatCents(cents, locale = 'en') {
  const n = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function canCustomerRespond(quote, { isAuthenticated = false, guestVerified = false } = {}) {
  if (!quote) return { ok: false, reason: 'missing' };
  if (isQuoteExpired(quote)) return { ok: false, reason: 'expired' };
  const status = toChatQuoteStatus(quote.kind, quote.status);
  if (status !== 'sent') return { ok: false, reason: status };
  if (!isAuthenticated && !guestVerified) return { ok: false, reason: 'verify_required' };
  if (quote.can_respond === false) return { ok: false, reason: 'blocked' };
  return { ok: true };
}

export function quoteEventContent(status, title, t) {
  const keyMap = {
    sent: 'helperProfile.messenger.quoteEventSent',
    accepted: 'helperProfile.messenger.quoteEventAccepted',
    declined: 'helperProfile.messenger.quoteEventDeclined',
    scheduled: 'helperProfile.messenger.quoteEventScheduled',
    superseded: 'helperProfile.messenger.quoteEventSuperseded',
    expired: 'helperProfile.messenger.quoteEventExpired',
  };
  const fallbacks = {
    sent: `Quote sent: ${title}`,
    accepted: `Quote accepted: ${title}`,
    declined: `Quote declined: ${title}`,
    scheduled: `Scheduled from quote: ${title}`,
    superseded: `Quote superseded: ${title}`,
    expired: `Quote expired: ${title}`,
  };
  const key = keyMap[status] || keyMap.sent;
  if (typeof t === 'function') {
    return t(key, { title: title || '', defaultValue: fallbacks[status] || fallbacks.sent });
  }
  return fallbacks[status] || fallbacks.sent;
}
