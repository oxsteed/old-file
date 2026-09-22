/**
 * Agreement markers for messenger.
 * Runtime marker fields: agreement id, token, status, version, and encoded title.
 */

export const AGREEMENT_STATUSES = [
  'draft',
  'shared',
  'acknowledged',
  'accepted',
  'declined',
  'superseded',
];

export function encodeAgreementTitle(title) {
  return encodeURIComponent(String(title || 'Agreement').trim().slice(0, 120));
}

export function decodeAgreementTitle(enc) {
  try {
    return decodeURIComponent(String(enc || ''));
  } catch {
    return String(enc || '');
  }
}

export function buildAgreementMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const token = String(opts.token || '').trim() || 'none';
  const status = AGREEMENT_STATUSES.includes(String(opts.status || '').toLowerCase())
    ? String(opts.status).toLowerCase()
    : 'shared';
  const version = Math.max(1, parseInt(opts.version, 10) || 1);
  const title = encodeAgreementTitle(opts.title);
  return `[agreement:${id}|${token}|${status}|v${version}|${title}]`;
}

export function parseAgreementMarker(text) {
  const match = String(text || '').match(
    /\[agreement:([^|\]]+)\|([^|\]]*)\|([^|\]]+)\|v?(\d+)\|([^|\]]*)\]/i,
  );
  if (!match) return null;
  return {
    id: match[1],
    token: match[2] === 'none' ? '' : match[2],
    status: String(match[3] || 'shared').toLowerCase(),
    version: parseInt(match[4], 10) || 1,
    title: decodeAgreementTitle(match[5]),
    raw: match[0],
  };
}

export function stripAgreementMarkers(text) {
  return String(text || '')
    .replace(/\[agreement:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function canCustomerRespondToAgreement(agreement, { isAuthenticated = false, guestVerified = false } = {}) {
  if (!agreement) return { ok: false, reason: 'missing' };
  const status = String(agreement.status || '').toLowerCase();
  if (status === 'superseded' || agreement.superseded_at) return { ok: false, reason: 'superseded' };
  if (status === 'accepted') return { ok: false, reason: 'already_accepted' };
  if (status === 'declined') return { ok: false, reason: 'already_declined' };
  if (!['shared', 'acknowledged'].includes(status)) return { ok: false, reason: status };
  if (!isAuthenticated && !guestVerified) return { ok: false, reason: 'verify_required' };
  if (agreement.can_respond === false) return { ok: false, reason: 'blocked' };
  return { ok: true };
}
