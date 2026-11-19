'use strict';

/**
 * Signup provisioning requests (PR #804 G-4 / G-23 / G-35).
 *
 * Staff, device/service-account, and partner signup intents map to no
 * capability, so no access request can carry them — and until this table
 * existed the ask was recorded nowhere any human reads. A provisioning
 * request is the visible record: created from signup (staff/device) or
 * from the partner invite-only card, listed in the access review queue,
 * and decided by an admin. A decision records who decided and when; it
 * grants nothing by itself. Staff provisioning itself stays out-of-band
 * (a super-admin creates the admin account); a service-account credential
 * is minted only by an explicit admin step, never by this row alone.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const KINDS = Object.freeze([
  'staff_reviewer', 'staff_support', 'staff_operations',
  'device', 'service_account', 'partner_application',
]);

const STATUSES = Object.freeze(['pending', 'approved', 'declined']);

function isKind(value) {
  return KINDS.includes(value);
}

function formatRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind,
    intent: row.intent,
    status: row.status,
    note: row.note || null,
    decisionNote: row.decision_note || null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    applicantName: row.applicant_name || null,
    applicantEmail: row.applicant_email || null,
  };
}

function err(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

/**
 * Create a pending request. Idempotent per (user, kind): a second create
 * while one is pending returns the open row instead of a duplicate.
 */
async function createRequest(userId, { kind, intent, note = null } = {}) {
  if (!isKind(kind)) throw err(400, 'validation_failed', 'Unknown provisioning kind.');
  const normalizedIntent = typeof intent === 'string' && intent ? intent.slice(0, 80) : kind;
  const { rows } = await pool.query(
    `INSERT INTO signup_provisioning_requests (user_id, kind, intent, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, kind) WHERE status = 'pending' DO NOTHING
     RETURNING *`,
    [userId, kind, normalizedIntent, note ? String(note).slice(0, 2000) : null],
  );
  if (rows.length) return { request: formatRow(rows[0]), created: true };
  const existing = await pool.query(
    `SELECT * FROM signup_provisioning_requests
      WHERE user_id = $1 AND kind = $2 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [userId, kind],
  );
  return { request: formatRow(existing.rows[0]), created: false };
}

async function listMine(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM signup_provisioning_requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(formatRow);
}

async function listQueue({ status = 'pending', kind = null, limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 50));
  const params = [];
  const where = ['r.status = $1'];
  params.push(STATUSES.includes(status) ? status : 'pending');
  if (kind && isKind(kind)) {
    params.push(kind);
    where.push(`r.kind = $${params.length}`);
  }
  params.push(lim);
  const { rows } = await pool.query(
    `SELECT r.*, u.first_name || ' ' || u.last_name AS applicant_name, u.email AS applicant_email
       FROM signup_provisioning_requests r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at ASC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(formatRow);
}

/**
 * Decide a pending request. Approving records the decision; it does not
 * provision anything by itself (see the module header). The signup intent
 * that opened the request is consumed on decision, decided or not: the
 * ask has been answered and the resume card stops offering it.
 */
async function decide({ reviewerId, id, decision, note = null }) {
  if (!['approved', 'declined'].includes(decision)) {
    throw err(400, 'validation_failed', 'Decision must be approved or declined.');
  }
  const { rows } = await pool.query(
    `UPDATE signup_provisioning_requests
        SET status = $2, decision_note = $3, decided_by = $4, decided_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, decision, note ? String(note).slice(0, 2000) : null, reviewerId],
  );
  if (!rows.length) {
    const existing = await pool.query('SELECT id FROM signup_provisioning_requests WHERE id = $1', [id]);
    if (!existing.rows.length) throw err(404, 'not_found', 'Provisioning request not found.');
    throw err(409, 'invalid_transition', 'This request has already been decided.');
  }
  const request = formatRow(rows[0]);
  try {
    const signupIntent = require('./access/signupIntent');
    await signupIntent.consumeIntent(request.userId, request.intent);
  } catch (e) {
    logger.warn('provisioning decide: intent consume failed', { id, error: e.message });
  }
  return { request };
}

module.exports = { KINDS, STATUSES, isKind, createRequest, listMine, listQueue, decide };
