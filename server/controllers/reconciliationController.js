'use strict';

/**
 * Reconciliation exception workspace controller.
 *
 * Admin-facing list/triage of reconciliation exceptions (refund
 * reconciliation failures, credit reconciliation failures, payout
 * settlement drift), plus aggregate health counts for the workspace header.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');

const DOMAINS = new Set(['credit', 'payment_refund', 'marketplace_refund', 'external_refund', 'payout_settlement']);
const STATUSES = new Set(['open', 'acknowledged', 'resolved']);
const SEVERITIES = new Set(['info', 'warning', 'critical']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const REFUND_ATTEMPT_TABLES = [
  'payment_refund_attempts',
  'marketplace_transaction_refunds',
  'external_refund_attempts',
];

const SEVERITY_ORDER_SQL = `CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * GET / - list exceptions with filters, pagination, and aggregate counts.
 */
async function listExceptions(req, res, next) {
  try {
    const { domain, status, severity } = req.query;

    if (domain && !DOMAINS.has(domain)) {
      return res.status(400).json({ error: 'Invalid domain filter.' });
    }
    if (status && !STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' });
    }
    if (severity && !SEVERITIES.has(severity)) {
      return res.status(400).json({ error: 'Invalid severity filter.' });
    }

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(MAX_LIMIT, parsePositiveInt(req.query.limit, DEFAULT_LIMIT));
    const offset = (page - 1) * limit;

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
      [...params, limit, offset]
    );

    const counts = {
      stuck_refund_attempts: await safeCountStuckRefundAttempts(),
      failed_credit_runs_7d: await safeCountFailedCreditRuns(),
      unsettled_payouts_48h: await safeCountUnsettledPayouts(),
    };

    return res.json({
      data: rows,
      pagination: { page, limit, total },
      counts,
    });
  } catch (error) {
    return next(error);
  }
}

async function safeCountStuckRefundAttempts() {
  let total = 0;
  for (const table of REFUND_ATTEMPT_TABLES) {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS total FROM ${table}
          WHERE status = 'failed' OR (status = 'pending' AND reconciliation_attempts >= 3)`
      );
      total += Number(rows[0]?.total || 0);
    } catch (error) {
      // A missing/unavailable table degrades to 0 instead of failing the request.
      logger.warn('Reconciliation count query degraded', { table, error: error.message });
    }
  }
  return total;
}

async function safeCountFailedCreditRuns() {
  try {
    // oxsteed_credit_reconciliation_runs uses started_at (there is no created_at column);
    // status CHECK allows 'running', 'balanced', 'difference', 'failed'.
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total
         FROM oxsteed_credit_reconciliation_runs
        WHERE started_at > NOW() - INTERVAL '7 days'
          AND status = 'failed'`
    );
    return Number(rows[0]?.total || 0);
  } catch (error) {
    logger.warn('Reconciliation count query degraded', { count: 'failed_credit_runs_7d', error: error.message });
    return 0;
  }
}

async function safeCountUnsettledPayouts() {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total
         FROM payout_transactions
        WHERE transaction_status = 'completed'
          AND updated_at < NOW() - INTERVAL '48 hours'`
    );
    return Number(rows[0]?.total || 0);
  } catch (error) {
    logger.warn('Reconciliation count query degraded', { count: 'unsettled_payouts_48h', error: error.message });
    return 0;
  }
}

/**
 * POST /exceptions/:id/assign - set the owner admin of an exception.
 */
async function assignException(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { admin_id } = req.body || {};
    if (!admin_id) {
      return res.status(400).json({ error: 'admin_id is required.' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM reconciliation_exceptions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reconciliation exception not found.' });
    }
    const before = rows[0];
    const updated = await client.query(
      `UPDATE reconciliation_exceptions
          SET owner_admin_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, admin_id]
    );

    await logAdminAction({
      adminId: req.user.id,
      action: 'reconciliation_exception_assigned',
      targetType: 'reconciliation_exception',
      targetId: id,
      description: `Exception assigned to admin ${admin_id}`,
      before,
      after: updated.rows[0],
      req,
      client,
      throwOnError: true,
    });

    await client.query('COMMIT');
    return res.json({ data: updated.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      logger.warn('assignException rollback failed', { error: rollbackError.message });
    }
    return next(error);
  } finally {
    client.release();
  }
}

const FORWARD_TRANSITIONS = {
  acknowledge: { from: ['open'], to: 'acknowledged', action: 'reconciliation_exception_acknowledged' },
  resolve: { from: ['open', 'acknowledged'], to: 'resolved', action: 'reconciliation_exception_resolved' },
};

async function transitionException(req, res, next, kind) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const transition = FORWARD_TRANSITIONS[kind];

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM reconciliation_exceptions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reconciliation exception not found.' });
    }
    const before = rows[0];
    if (!transition.from.includes(before.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot move a ${before.status} exception to ${transition.to}.`,
        code: 'reconciliation_transition_invalid',
        currentStatus: before.status,
      });
    }

    const updated = await client.query(
      `UPDATE reconciliation_exceptions
          SET status = $2,
              resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, transition.to]
    );

    await logAdminAction({
      adminId: req.user.id,
      action: transition.action,
      targetType: 'reconciliation_exception',
      targetId: id,
      description: `Exception moved from ${before.status} to ${transition.to}`,
      before,
      after: updated.rows[0],
      req,
      client,
      throwOnError: true,
    });

    await client.query('COMMIT');
    return res.json({ data: updated.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      logger.warn(`${kind}Exception rollback failed`, { error: rollbackError.message });
    }
    return next(error);
  } finally {
    client.release();
  }
}

/**
 * POST /exceptions/:id/acknowledge - open -> acknowledged.
 */
async function acknowledgeException(req, res, next) {
  return transitionException(req, res, next, 'acknowledge');
}

/**
 * POST /exceptions/:id/resolve - open -> resolved or acknowledged -> resolved.
 */
async function resolveException(req, res, next) {
  return transitionException(req, res, next, 'resolve');
}

module.exports = {
  listExceptions,
  assignException,
  acknowledgeException,
  resolveException,
};
