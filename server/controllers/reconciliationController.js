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
const reconService = require('../services/reconciliationExceptions');

const REFUND_ATTEMPT_TABLES = [
  'payment_refund_attempts',
  'marketplace_transaction_refunds',
  'external_refund_attempts',
];

/**
 * Map a coded service error to the admin HTTP contract.
 * Returns true when the error was handled.
 */
function sendServiceError(res, error) {
  if (!error || !Number.isInteger(error.statusCode)) return false;
  const body = { error: error.message };
  if (error.code) body.code = error.code;
  if (error.currentStatus) body.currentStatus = error.currentStatus;
  res.status(error.statusCode).json(body);
  return true;
}

/**
 * GET / - list exceptions with filters, pagination, and aggregate counts.
 */
async function listExceptions(req, res, next) {
  try {
    const { domain, status, severity, page, limit } = req.query || {};
    const { rows, total, page: safePage, limit: safeLimit } =
      await reconService.listExceptions({ domain, status, severity, page, limit });

    const counts = {
      stuck_refund_attempts: await safeCountStuckRefundAttempts(),
      failed_credit_runs_7d: await safeCountFailedCreditRuns(),
      unsettled_payouts_48h: await safeCountUnsettledPayouts(),
    };

    return res.json({
      data: rows,
      pagination: { page: safePage, limit: safeLimit, total },
      counts,
    });
  } catch (error) {
    if (sendServiceError(res, error)) return;
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
  try {
    const { admin_id } = req.body || {};
    if (!admin_id) {
      return res.status(400).json({ error: 'admin_id is required.' });
    }
    const data = await reconService.assignException({
      id: req.params.id,
      ownerAdminId: admin_id,
      actorId: req.user.id,
      req,
    });
    return res.json({ data });
  } catch (error) {
    if (sendServiceError(res, error)) return;
    return next(error);
  }
}

async function transitionRequest(req, res, next, kind) {
  try {
    const data = await reconService.transitionException({
      id: req.params.id,
      kind,
      actorId: req.user.id,
      req,
    });
    return res.json({ data });
  } catch (error) {
    if (sendServiceError(res, error)) return;
    return next(error);
  }
}

/**
 * POST /exceptions/:id/acknowledge - open -> acknowledged.
 */
async function acknowledgeException(req, res, next) {
  return transitionRequest(req, res, next, 'acknowledge');
}

/**
 * POST /exceptions/:id/resolve - open -> resolved or acknowledged -> resolved.
 */
async function resolveException(req, res, next) {
  return transitionRequest(req, res, next, 'resolve');
}

module.exports = {
  listExceptions,
  assignException,
  acknowledgeException,
  resolveException,
};
