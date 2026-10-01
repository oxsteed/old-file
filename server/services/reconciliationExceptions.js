'use strict';

/**
 * reconciliationExceptions service
 *
 * Durable record of reconciliation failures (refund reconciliation runs,
 * credit reconciliation, payout settlement). recordException never throws:
 * recon jobs run on a schedule and must not crash because an exception
 * insert failed.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('./auditService');

const DOMAINS = new Set(['credit', 'payment_refund', 'marketplace_refund', 'external_refund', 'payout_settlement', 'credit_external']);
const SEVERITIES = new Set(['info', 'warning', 'critical']);
const STATUSES = new Set(['open', 'acknowledged', 'resolved']);

const FORWARD_TRANSITIONS = {
  acknowledge: { from: ['open'], to: 'acknowledged', action: 'reconciliation_exception_acknowledged' },
  resolve: { from: ['open', 'acknowledged'], to: 'resolved', action: 'reconciliation_exception_resolved' },
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const SEVERITY_ORDER_SQL = `CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`;

/**
 * Coded error for service-level failures; callers map statusCode/code to HTTP.
 */
function serviceError(statusCode, code, message, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function auditDescription(description, auditSource) {
  return auditSource === 'connector' ? `[connector] ${description}` : description;
}

function auditAfter(after, auditSource) {
  if (auditSource === 'connector') {
    return { ...(after || {}), source: 'connector' };
  }
  return after;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Record a reconciliation exception, deduping on open/acknowledged rows with
 * the same (domain, reference_id). Returns the row id, or null on error.
 */
async function recordException({ domain, referenceId, severity = 'warning', summary, details = {}, sourceRunId = null }) {
  try {
    if (!DOMAINS.has(domain)) {
      throw new Error(`Invalid reconciliation exception domain: ${domain}`);
    }
    if (!SEVERITIES.has(severity)) {
      throw new Error(`Invalid reconciliation exception severity: ${severity}`);
    }
    if (!referenceId || !summary) {
      throw new Error('recordException requires referenceId and summary');
    }

    const existing = await pool.query(
      `SELECT id FROM reconciliation_exceptions
        WHERE domain = $1 AND reference_id = $2 AND status IN ('open', 'acknowledged')
        LIMIT 1`,
      [domain, String(referenceId)]
    );
    if (existing.rows.length) {
      return existing.rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO reconciliation_exceptions
         (domain, reference_id, severity, summary, details, source_run_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [domain, String(referenceId), severity, summary, JSON.stringify(details || {}), sourceRunId || null]
    );
    return rows[0].id;
  } catch (error) {
    // Never let exception bookkeeping crash a reconciliation job.
    logger.warn('recordException failed; swallowing', {
      domain,
      referenceId: referenceId != null ? String(referenceId) : null,
      error: error.message,
    });
    return null;
  }
}

module.exports = {
  DOMAINS: [...DOMAINS],
  SEVERITIES: [...SEVERITIES],
  STATUSES: [...STATUSES],
  FORWARD_TRANSITIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  recordException,
  listExceptions,
  assignException,
  transitionException,
};

/**
 * List reconciliation exceptions with optional filters and pagination.
 * Pure query layer shared by the admin workspace and the connector API.
 *
 * @param {object} args
 * @param {string} [args.domain]
 * @param {string} [args.status]
 * @param {string} [args.severity]
 * @param {number|string} [args.page]
 * @param {number|string} [args.limit]
 * @returns {Promise<{rows: object[], total: number, page: number, limit: number}>}
 * @throws coded error (400) on an invalid filter value
 */
async function listExceptions({ domain, status, severity, page = 1, limit = DEFAULT_LIMIT } = {}) {
  if (domain && !DOMAINS.has(domain)) {
    throw serviceError(400, 'invalid_domain', 'Invalid domain filter.');
  }
  if (status && !STATUSES.has(status)) {
    throw serviceError(400, 'invalid_status', 'Invalid status filter.');
  }
  if (severity && !SEVERITIES.has(severity)) {
    throw serviceError(400, 'invalid_severity', 'Invalid severity filter.');
  }

  const safePage = parsePositiveInt(page, 1);
  const safeLimit = Math.min(MAX_LIMIT, parsePositiveInt(limit, DEFAULT_LIMIT));
  const offset = (safePage - 1) * safeLimit;

  const filters = [];
  const params = [];
  if (domain) { params.push(domain); filters.push(`domain = $${params.length}`); }
  if (status) { params.push(status); filters.push(`status = $${params.length}`); }
  if (severity) { params.push(severity); filters.push(`severity = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const totalRes = await pool.query(
    `SELECT COUNT(*) AS total FROM reconciliation_exceptions ${where}`,
    params
  );
  const total = Number(totalRes.rows[0]?.total || 0);

  const { rows } = await pool.query(
    `SELECT id, domain, reference_id, severity, status, owner_admin_id,
            summary, details, source_run_id,
            created_at, updated_at, resolved_at
       FROM reconciliation_exceptions
      ${where}
      ORDER BY ${SEVERITY_ORDER_SQL}, created_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, offset]
  );

  return { rows, total, page: safePage, limit: safeLimit };
}

/**
 * Assign an exception owner. Transactional; audits the change.
 *
 * @param {object} args
 * @param {string} args.id exception id
 * @param {string} args.ownerAdminId admin to assign
 * @param {string} args.actorId acting admin id (audit actor)
 * @param {string} [args.auditSource] 'admin' (default) or 'connector'
 * @param {object} [args.req] express request (IP / user-agent for audit)
 * @returns {Promise<object>} the updated exception row
 * @throws coded error (404) when the exception does not exist
 */
async function assignException({ id, ownerAdminId, actorId, auditSource = 'admin', req = null }) {
  if (!ownerAdminId) {
    throw serviceError(400, 'owner_required', 'admin_id is required.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM reconciliation_exceptions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      throw serviceError(404, 'exception_not_found', 'Reconciliation exception not found.');
    }
    const before = rows[0];
    const updated = await client.query(
      `UPDATE reconciliation_exceptions
          SET owner_admin_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, ownerAdminId]
    );

    await logAdminAction({
      adminId: actorId,
      action: 'reconciliation_exception_assigned',
      targetType: 'reconciliation_exception',
      targetId: id,
      description: auditDescription(`Exception assigned to admin ${ownerAdminId}`, auditSource),
      before,
      after: auditAfter(updated.rows[0], auditSource),
      req,
      client,
      throwOnError: true,
    });

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      logger.warn('assignException rollback failed', { error: rollbackError.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Move an exception forward along open -> acknowledged -> resolved.
 * Transactional; audits the transition.
 *
 * @param {object} args
 * @param {string} args.id exception id
 * @param {'acknowledge'|'resolve'} args.kind transition kind
 * @param {string} args.actorId acting admin id (audit actor)
 * @param {string} [args.resolutionNotes] stored in details on resolve
 * @param {string} [args.auditSource] 'admin' (default) or 'connector'
 * @param {object} [args.req] express request (IP / user-agent for audit)
 * @returns {Promise<object>} the updated exception row
 * @throws coded error (404/409) on unknown id or illegal transition
 */
async function transitionException({ id, kind, actorId, resolutionNotes = null, auditSource = 'admin', req = null }) {
  const transition = FORWARD_TRANSITIONS[kind];
  if (!transition) {
    throw serviceError(400, 'invalid_transition', `Unknown transition "${kind}".`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM reconciliation_exceptions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      throw serviceError(404, 'exception_not_found', 'Reconciliation exception not found.');
    }
    const before = rows[0];
    if (!transition.from.includes(before.status)) {
      await client.query('ROLLBACK');
      throw serviceError(409, 'reconciliation_transition_invalid',
        `Cannot move a ${before.status} exception to ${transition.to}.`,
        { currentStatus: before.status });
    }

    const withNotes = resolutionNotes != null && String(resolutionNotes).trim() !== '';
    const detailMerge = withNotes
      ? `, details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('resolution_notes', $3)`
      : '';
    const params = withNotes ? [id, transition.to, String(resolutionNotes)] : [id, transition.to];
    const updated = await client.query(
      `UPDATE reconciliation_exceptions
          SET status = $2,
              resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
              updated_at = NOW()${detailMerge}
        WHERE id = $1
        RETURNING *`,
      params
    );

    await logAdminAction({
      adminId: actorId,
      action: transition.action,
      targetType: 'reconciliation_exception',
      targetId: id,
      description: auditDescription(`Exception moved from ${before.status} to ${transition.to}`, auditSource),
      before,
      after: auditAfter(updated.rows[0], auditSource),
      req,
      client,
      throwOnError: true,
    });

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      logger.warn(`${kind}Exception rollback failed`, { error: rollbackError.message });
    }
    throw error;
  } finally {
    client.release();
  }
}
