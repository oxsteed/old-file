'use strict';

/**
 * In-chat agreement markers + helpers.
 * Marker: [agreement:id|token|status|version|title_enc]
 */

const crypto = require('crypto');

const AGREEMENT_STATUSES = new Set([
  'draft',
  'shared',
  'acknowledged',
  'accepted',
  'declined',
  'superseded',
]);
const RESPOND_ACTIONS = new Set(['acknowledge', 'accept', 'decline']);
const ALLOWED_AGREEMENT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function newAgreementToken() {
  return crypto.randomBytes(16).toString('hex');
}

function encodeTitle(title) {
  return encodeURIComponent(String(title || 'Agreement').trim().slice(0, 120));
}

function decodeTitle(enc) {
  try {
    return decodeURIComponent(String(enc || ''));
  } catch {
    return String(enc || '');
  }
}

function buildAgreementMarker(opts = {}) {
  const id = opts.id != null ? String(opts.id).trim() : '';
  if (!id) return '';
  const token = String(opts.token || '').trim() || 'none';
  const status = AGREEMENT_STATUSES.has(String(opts.status || '').toLowerCase())
    ? String(opts.status).toLowerCase()
    : 'shared';
  const version = Math.max(1, parseInt(opts.version, 10) || 1);
  const title = encodeTitle(opts.title);
  return `[agreement:${id}|${token}|${status}|v${version}|${title}]`;
}

function parseAgreementMarker(text) {
  const match = String(text || '').match(
    /\[agreement:([^|\]]+)\|([^|\]]*)\|([^|\]]+)\|v?(\d+)\|([^|\]]*)\]/i,
  );
  if (!match) return null;
  return {
    id: match[1],
    token: match[2] === 'none' ? '' : match[2],
    status: String(match[3] || 'shared').toLowerCase(),
    version: parseInt(match[4], 10) || 1,
    title: decodeTitle(match[5]),
    raw: match[0],
  };
}

function stripAgreementMarkers(text) {
  return String(text || '')
    .replace(/\[agreement:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildAgreementShareContent({ marker, title, preface } = {}) {
  if (!marker) return '';
  const head =
    typeof preface === 'string' && preface.trim()
      ? preface.trim()
      : `Agreement: ${title || 'Terms'}`;
  return `${head}\n${marker}`;
}

function canRespondToAgreement(row) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.superseded_at || String(row.status) === 'superseded') {
    return { ok: false, reason: 'superseded' };
  }
  const status = String(row.status || '').toLowerCase();
  if (status === 'accepted') return { ok: false, reason: 'already_accepted' };
  if (status === 'declined') return { ok: false, reason: 'already_declined' };
  if (!['shared', 'acknowledged'].includes(status)) {
    return { ok: false, reason: 'invalid_status' };
  }
  return { ok: true };
}

function normalizeAgreementPayload(body = {}) {
  const title = String(body.title || '').trim().slice(0, 300);
  if (!title) return { error: 'Title is required' };
  const bodyText = String(body.body_text || body.bodyText || body.terms || '').trim();
  if (bodyText.length > 50000) return { error: 'Agreement text is too long' };
  if (!bodyText && !body.attachment_key && !body.hasFile) {
    return { error: 'Provide agreement text or an attachment' };
  }
  return {
    title,
    bodyText: bodyText || null,
    requiredBeforeSchedule: (() => {
      const v = body.required_before_schedule ?? body.requiredBeforeSchedule;
      if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true') return true;
      return false;
    })(),
  };
}

function toPublicAgreementCard(row, { includeBody = true } = {}) {
  if (!row) return null;
  return {
    id: String(row.id),
    title: row.title,
    body_text: includeBody ? row.body_text : undefined,
    version: row.version || 1,
    status: row.status,
    token: row.token,
    required_before_schedule: Boolean(row.required_before_schedule),
    conversation_id: row.conversation_id,
    guest_session_id: row.guest_session_id,
    parent_agreement_id: row.parent_agreement_id,
    superseded_at: row.superseded_at,
    has_attachment: Boolean(row.attachment_key),
    attachment_name: row.attachment_name,
    attachment_mime: row.attachment_mime,
    attachment_size: row.attachment_size,
    can_respond: canRespondToAgreement(row).ok,
    created_at: row.created_at,
    sensitive: row.sensitive !== false,
  };
}

function redactAgreementForLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    conversation_id: row.conversation_id,
    guest_session_id: row.guest_session_id,
    title: row.title ? '[redacted]' : null,
    has_attachment: Boolean(row.attachment_key),
  };
}

/**
 * Returns true when schedule should be blocked because a required agreement
 * on this thread is not yet accepted/acknowledged appropriately.
 */
function scheduleBlockedByAgreements(agreements = []) {
  const blockers = (agreements || []).filter((a) => {
    if (!a || !a.required_before_schedule) return false;
    if (a.superseded_at || a.status === 'superseded') return false;
    // Design: accepted OR acknowledged clears the schedule gate.
    return a.status !== 'accepted' && a.status !== 'acknowledged';
  });
  return blockers.length
    ? { blocked: true, agreements: blockers.map((a) => ({ id: a.id, title: a.title, status: a.status })) }
    : { blocked: false, agreements: [] };
}

async function checkScheduleAgreementGate(pool, { conversationId, guestSessionId }) {
  if (!conversationId && !guestSessionId) return { blocked: false, agreements: [] };
  const params = [];
  let where;
  if (conversationId) {
    params.push(conversationId);
    where = 'conversation_id = $1';
  } else {
    params.push(guestSessionId);
    where = 'guest_session_id = $1';
  }
  const { rows } = await pool
    .query(
      `SELECT id, title, status, required_before_schedule, superseded_at
         FROM chat_agreements
        WHERE ${where}
          AND required_before_schedule = TRUE
          AND superseded_at IS NULL
          AND status <> 'superseded'`,
      params,
    )
    .catch(() => ({ rows: [] }));
  return scheduleBlockedByAgreements(rows);
}

module.exports = {
  AGREEMENT_STATUSES,
  RESPOND_ACTIONS,
  ALLOWED_AGREEMENT_MIMES,
  newAgreementToken,
  buildAgreementMarker,
  parseAgreementMarker,
  stripAgreementMarkers,
  buildAgreementShareContent,
  canRespondToAgreement,
  normalizeAgreementPayload,
  toPublicAgreementCard,
  redactAgreementForLog,
  scheduleBlockedByAgreements,
  checkScheduleAgreementGate,
  encodeTitle,
  decodeTitle,
};
