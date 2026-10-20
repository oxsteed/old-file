'use strict';

/**
 * AI support chat in-chat actions (item 4).
 *
 * Flow: the model PROPOSES one action by ending its reply with
 *   [[action:{"type":"reopen_ticket","ticket_id":"..."}]]
 * The server strips the marker, validates the type and params against the
 * allowlist below, checks the caller owns the record and that it is in an
 * allowed state, and stores a one-shot proposal row (migration 914). The
 * widget shows a confirm card. On confirm the server re-checks everything
 * and returns the EXISTING endpoint the client must call with the user's own
 * session (so the endpoint's own auth/ownership checks run again). The
 * client reports the outcome, which is logged on the same row.
 *
 * Nothing here can move money, refund, or approve/adjust OxSteed Credit:
 * those types do not exist, and booking requests that carry a deposit
 * (paid / processing / requires_payment) are never cancellable from chat.
 */

const db = require('../db');
const logger = require('../utils/logger');

const ACTION_MARKER_RE = /\[\[action:(\{[^\]\n]{0,800}\})\]\]/g;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REPLY_CHARS = 2000;
// Deposit states where cancelling would trigger a refund/settlement.
const MONEY_PAYMENT_STATES = new Set(['paid', 'processing', 'requires_payment', 'refunded', 'partially_refunded', 'succeeded']);
const NAV_TARGETS = ['order', 'booking', 'job', 'dispute', 'ticket'];

function validId(v) {
  return (typeof v === 'string' || typeof v === 'number') && ID_RE.test(String(v));
}

/** Normalise model-proposed params; returns null when invalid. */
const PARAM_RULES = {
  // Opening a ticket is the existing chat handoff (/support/chat-escalation).
  open_ticket: () => ({}),
  reopen_ticket: (p) => (validId(p.ticket_id) ? { ticket_id: String(p.ticket_id) } : null),
  reply_ticket: (p) => {
    const message = typeof p.message === 'string' ? p.message.trim().slice(0, MAX_REPLY_CHARS) : '';
    return validId(p.ticket_id) && message ? { ticket_id: String(p.ticket_id), message } : null;
  },
  resend_verification_email: () => ({}),
  open_cookie_preferences: () => ({}),
  navigate: (p) => (NAV_TARGETS.includes(p.target) && validId(p.id) ? { target: p.target, id: String(p.id) } : null),
  cancel_booking_request: (p) => (validId(p.booking_id) ? { booking_id: String(p.booking_id) } : null),
};

const ACTION_TYPES = Object.freeze(Object.keys(PARAM_RULES));

/**
 * Strip every action marker from the reply and return the first valid
 * proposal (type + normalised params). Invalid JSON or unknown types are
 * dropped silently: the reply text still reaches the user.
 */
function extractActionProposal(reply) {
  if (typeof reply !== 'string' || !reply.includes('[[action:')) return { reply, proposal: null };
  let proposal = null;
  const cleaned = reply.replace(ACTION_MARKER_RE, (_m, json) => {
    if (proposal) return '';
    try {
      const raw = JSON.parse(json);
      const rule = raw && typeof raw === 'object' ? PARAM_RULES[raw.type] : null;
      const params = rule ? rule(raw) : null;
      if (params) proposal = { type: raw.type, params };
    } catch { /* malformed marker: ignore */ }
    return '';
  }).replace(/\[\[action:[^\]]*\]?\]?/g, '').trim();
  return { reply: cleaned, proposal };
}

const deny = (reason) => ({ ok: false, reason });

/** Ownership + state check for one action. Runs at proposal AND at confirm. */
async function checkAction(userId, type, params, query = db.query.bind(db)) {
  switch (type) {
    case 'reopen_ticket':
    case 'reply_ticket': {
      const { rows } = await query(
        'SELECT id, ticket_number, status FROM support_tickets WHERE id = $1 AND user_id = $2',
        [params.ticket_id, userId]
      );
      const t = rows[0];
      if (!t) return deny('not_found');
      const closed = ['resolved', 'closed'].includes(t.status);
      if (type === 'reopen_ticket' && !closed) return deny('not_closed');
      if (type === 'reply_ticket' && closed) return deny('ticket_closed');
      return { ok: true, display: { ticketNumber: t.ticket_number ?? null } };
    }
    case 'resend_verification_email': {
      const { rows } = await query('SELECT email_verified FROM users WHERE id = $1', [userId]);
      if (!rows[0]) return deny('not_found');
      if (rows[0].email_verified === true) return deny('already_verified');
      return { ok: true, display: {} };
    }
    case 'open_cookie_preferences':
    case 'open_ticket':
      return { ok: true, display: {} };
    case 'navigate': {
      const { target, id } = params;
      const sql = {
        order: 'SELECT id FROM food_orders WHERE id::text = $1 AND customer_id = $2',
        booking: 'SELECT id FROM booking_requests WHERE id::text = $1 AND (customer_id = $2 OR helper_id = $2)',
        job: 'SELECT id FROM jobs WHERE id::text = $1 AND (client_id = $2 OR assigned_helper_id = $2) AND deleted_at IS NULL',
        dispute: 'SELECT id FROM disputes WHERE id::text = $1 AND opened_by = $2',
        ticket: 'SELECT id FROM support_tickets WHERE id::text = $1 AND user_id = $2',
      }[target];
      const { rows } = await query(sql, [id, userId]);
      if (!rows[0]) return deny('not_found');
      const path = {
        order: `/orders/${id}`,
        booking: '/my-bookings',
        job: `/jobs/${id}`,
        dispute: `/disputes/${id}`,
        ticket: `/support/my-tickets/${id}`,
      }[target];
      return { ok: true, display: { path } };
    }
    case 'cancel_booking_request': {
      const { rows } = await query(
        'SELECT id, status, payment_status FROM booking_requests WHERE id::text = $1 AND customer_id = $2',
        [params.booking_id, userId]
      );
      const b = rows[0];
      if (!b) return deny('not_found');
      if (b.status !== 'pending') return deny('not_pending');
      // A deposit means cancelling would settle/refund money: staff only.
      if (b.payment_status && MONEY_PAYMENT_STATES.has(String(b.payment_status))) return deny('has_deposit');
      return { ok: true, display: {} };
    }
    default:
      return deny('unknown_type');
  }
}

/** The existing endpoint (or client-only step) for a confirmed action. */
function executionPlan(row, display = {}) {
  const p = row.params || {};
  switch (row.action_type) {
    case 'reopen_ticket':
      return { kind: 'api', method: 'post', url: `/support/my-tickets/${encodeURIComponent(p.ticket_id)}/reopen`, body: {} };
    case 'reply_ticket':
      return { kind: 'api', method: 'post', url: `/support/my-tickets/${encodeURIComponent(p.ticket_id)}/reply`, body: { content: p.message, clientMessageId: row.id } };
    case 'resend_verification_email':
      return { kind: 'api', method: 'post', url: '/auth/resend-verification', body: {} };
    case 'cancel_booking_request':
      return { kind: 'api', method: 'post', url: `/bookings/${encodeURIComponent(p.booking_id)}/cancel`, body: {} };
    case 'navigate':
      return { kind: 'navigate', path: display.path };
    case 'open_cookie_preferences':
      return { kind: 'client', name: 'open_cookie_preferences' };
    case 'open_ticket':
      // The widget's existing handoff call (POST /support/chat-escalation)
      // carries the transcript, page, snapshot and image.
      return { kind: 'handoff' };
    default:
      return null;
  }
}

function publicAction(row, display = {}) {
  return {
    id: row.id,
    type: row.action_type,
    params: row.params || {},
    display,
    status: row.status,
  };
}

/** Validate + store a proposal. Returns the card payload or null. */
async function proposeAction(userId, proposal, { page } = {}) {
  if (!userId || !proposal || !PARAM_RULES[proposal.type]) return null;
  try {
    const check = await checkAction(userId, proposal.type, proposal.params);
    if (!check.ok) {
      logger.info('support chat action proposal dropped', { userId, type: proposal.type, reason: check.reason });
      return null;
    }
    const { rows } = await db.query(
      `INSERT INTO support_chat_actions (user_id, action_type, params, page)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, action_type, params, status`,
      [userId, proposal.type, JSON.stringify(proposal.params), typeof page === 'string' ? page.slice(0, 200) : null]
    );
    logger.info('support chat action proposed', { userId, actionId: rows[0]?.id, type: proposal.type });
    return rows[0] ? publicAction(rows[0], check.display) : null;
  } catch (err) {
    logger.warn('support chat action proposal failed', { err: err.message });
    return null;
  }
}

async function loadOwnAction(userId, actionId) {
  if (!validId(actionId)) return null;
  const { rows } = await db.query(
    `SELECT id, user_id, action_type, params, status, expires_at
       FROM support_chat_actions WHERE id::text = $1 AND user_id = $2`,
    [actionId, userId]
  );
  return rows[0] || null;
}

/**
 * Confirm: re-check ownership/state now, mark confirmed, return the plan.
 * Throws-free; returns { status, body } for the controller.
 */
async function confirmAction(userId, actionId) {
  const row = await loadOwnAction(userId, actionId);
  if (!row) return { status: 404, body: { error: 'Action not found', code: 'action_not_found' } };
  if (row.status !== 'proposed') return { status: 409, body: { error: 'Action already handled', code: 'action_already_handled' } };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await db.query(`UPDATE support_chat_actions SET status = 'rejected', reject_reason = 'expired', completed_at = NOW() WHERE id = $1`, [row.id]);
    return { status: 410, body: { error: 'Action expired', code: 'action_expired' } };
  }
  const check = await checkAction(userId, row.action_type, row.params || {});
  if (!check.ok) {
    await db.query(
      `UPDATE support_chat_actions SET status = 'rejected', reject_reason = $2, completed_at = NOW() WHERE id = $1`,
      [row.id, check.reason]
    );
    logger.info('support chat action rejected on confirm', { userId, actionId: row.id, type: row.action_type, reason: check.reason });
    return { status: 409, body: { error: 'This action is no longer available', code: 'action_not_allowed', reason: check.reason } };
  }
  const { rows } = await db.query(
    `UPDATE support_chat_actions SET status = 'confirmed', confirmed_at = NOW()
      WHERE id = $1 AND status = 'proposed' RETURNING id, action_type, params, status`,
    [row.id]
  );
  if (!rows[0]) return { status: 409, body: { error: 'Action already handled', code: 'action_already_handled' } };
  logger.info('support chat action confirmed', { userId, actionId: row.id, type: row.action_type });
  return { status: 200, body: { action: publicAction(rows[0], check.display), plan: executionPlan(rows[0], check.display) } };
}

/** Record the outcome the client observed from the existing endpoint. */
async function recordActionResult(userId, actionId, { ok, statusCode } = {}) {
  const row = await loadOwnAction(userId, actionId);
  if (!row) return { status: 404, body: { error: 'Action not found', code: 'action_not_found' } };
  if (row.status !== 'confirmed') return { status: 409, body: { error: 'Action is not awaiting a result', code: 'action_not_confirmed' } };
  const code = Number.isInteger(statusCode) && statusCode >= 100 && statusCode < 600 ? statusCode : null;
  await db.query(
    `UPDATE support_chat_actions SET status = $2, result_code = $3, completed_at = NOW() WHERE id = $1`,
    [row.id, ok ? 'succeeded' : 'failed', code]
  );
  logger.info('support chat action completed', { userId, actionId: row.id, type: row.action_type, ok: Boolean(ok), statusCode: code });
  return { status: 200, body: { ok: true } };
}

async function dismissAction(userId, actionId) {
  const row = await loadOwnAction(userId, actionId);
  if (!row) return { status: 404, body: { error: 'Action not found', code: 'action_not_found' } };
  if (row.status !== 'proposed') return { status: 200, body: { ok: true } };
  await db.query(`UPDATE support_chat_actions SET status = 'dismissed', completed_at = NOW() WHERE id = $1 AND status = 'proposed'`, [row.id]);
  logger.info('support chat action dismissed', { userId, actionId: row.id, type: row.action_type });
  return { status: 200, body: { ok: true } };
}

module.exports = {
  ACTION_TYPES,
  NAV_TARGETS,
  MONEY_PAYMENT_STATES,
  extractActionProposal,
  checkAction,
  executionPlan,
  proposeAction,
  confirmAction,
  recordActionResult,
  dismissAction,
};
