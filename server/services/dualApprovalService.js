'use strict';

/**
 * Dual-approval (maker-checker) gate for money movements — ADM-016.
 *
 * Single-admin approval could move money on every rail (job refunds,
 * marketplace refunds, dispute refunds, restaurant payouts, affiliate
 * payouts). Movements at or above the configured threshold are recorded as
 * pending and only execute after a DIFFERENT admin approves them.
 *
 * Threshold (confirmed $500 by Emile, 2026-10-31; audit item 12):
 *   1. platform_settings.money_dual_approval_threshold_cents (runtime tunable;
 *      migration 20261031072649 seeds the confirmed 50000 where unset)
 *   2. env MONEY_DUAL_APPROVAL_THRESHOLD_CENTS
 *   3. default 50000 ($500.00)
 *
 * Fail-closed rules:
 * - Below threshold the executor runs immediately (current single-approval
 *   behavior, now with step-up where the rail already requires it).
 * - At/above threshold the movement is queued 'pending' and nothing moves.
 * - Approval requires a locked row (FOR UPDATE), pending status, and a
 *   checker different from the maker. The executor runs inside the same
 *   transaction that marks the row executed: a crash cannot approve without
 *   executing, nor execute without approving.
 * - Idempotency keys are unique per rail. Replays return the existing row
 *   instead of queuing duplicates.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');

const DEFAULT_THRESHOLD_CENTS = 50000; // $500.00
const SETTING_KEY = 'money_dual_approval_threshold_cents';

function parseThresholdCents(raw) {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

let settingsCacheReader = null;
function setSettingsReader(fn) {
  settingsCacheReader = fn;
}

async function getDualApprovalThresholdCents() {
  // 1. Runtime-tunable platform setting wins when present and valid.
  try {
    const reader = settingsCacheReader
      || require('./platformSettingsCache').readSettingRaw;
    if (typeof reader === 'function') {
      const raw = await reader(SETTING_KEY);
      const parsed = parseThresholdCents(raw);
      if (parsed != null) return parsed;
    }
  } catch (err) {
    logger.warn('[dualApproval] platform setting read failed, falling back', {
      error: err.message,
    });
  }
  // 2. Env var.
  const envParsed = parseThresholdCents(process.env.MONEY_DUAL_APPROVAL_THRESHOLD_CENTS);
  if (envParsed != null) return envParsed;
  // 3. Built-in default (confirmed $500, 2026-10-31; audit item 12).
  return DEFAULT_THRESHOLD_CENTS;
}

async function movementRequiresDualApproval(amountCents) {
  const threshold = await getDualApprovalThresholdCents();
  return Number(amountCents) >= threshold;
}

// ─── Executor registry ──────────────────────────────────────────────
// Executors perform the actual money movement for a rail. They receive the
// stored payload and an object with the checker identity, and must be
// idempotent (the approval row lock prevents concurrent execution, but a
// retried executor after a crash must not double-move money).
const executors = new Map();

function registerMoneyMovementExecutor(movementType, fn) {
  if (typeof fn !== 'function') throw new Error('executor must be a function');
  executors.set(movementType, fn);
}

function getMoneyMovementExecutor(movementType) {
  return executors.get(movementType) || null;
}

function namespacedIdempotencyKey(movementType, supplied) {
  const candidate = String(supplied || '').trim();
  if (!candidate) {
    throw new AppError('Idempotency-Key is required for money movements', 400, 'money_movement_idempotency_required');
  }
  if (!/^[A-Za-z0-9:._-]{8,255}$/.test(candidate)) {
    throw new AppError('A valid idempotency key is required', 400, 'money_movement_idempotency_invalid');
  }
  return `dual-approval:${movementType}:${candidate}`;
}

/**
 * Queue a money movement for dual approval, or report that it is below the
 * threshold. Never moves money itself.
 *
 * Returns { queued: false } when below threshold (caller executes directly),
 * or { queued: true, approval, replay } when queued.
 */
async function requestMoneyMovementApproval({
  movementType,
  referenceKey,
  amountCents,
  currencyCode = 'USD',
  requestedBy,
  idempotencyKey,
  payload = {},
}) {
  // Self-healing registration: the executors are registered at server
  // startup (routes/admin.js), but a rail reached without that wiring must
  // fail closed, never silently skip dual approval.
  if (!executors.has(movementType)) {
    try {
      require('./moneyMovementExecutors').registerMoneyMovementExecutors();
    } catch (err) {
      logger.error('[dualApproval] executor registration failed', { error: err.message });
    }
  }
  if (!movementType || !executors.has(movementType)) {
    throw new AppError(`Unknown money movement type: ${movementType}`, 500, 'money_movement_unknown_type');
  }
  if (!referenceKey) throw new AppError('referenceKey is required', 400, 'money_movement_reference_required');
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('amountCents must be a positive integer', 400, 'money_movement_invalid_amount');
  }
  if (!requestedBy) throw new AppError('requestedBy is required', 400, 'money_movement_actor_required');

  if (!(await movementRequiresDualApproval(amount))) {
    return { queued: false };
  }

  const key = namespacedIdempotencyKey(movementType, idempotencyKey);
  return withTransaction(pool, async (client) => {
    const existing = await client.query(
      'SELECT * FROM money_movement_approvals WHERE idempotency_key = $1 FOR UPDATE',
      [key]
    );
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.movement_type !== movementType
        || Number(row.amount_cents) !== amount
        || String(row.reference_key) !== String(referenceKey)) {
        throw new AppError('Idempotency key was already used for different movement details', 409, 'money_movement_idempotency_conflict');
      }
      return { queued: true, approval: row, replay: true };
    }
    const inserted = await client.query(
      `INSERT INTO money_movement_approvals
         (movement_type, reference_key, amount_cents, currency_code, requested_by, idempotency_key, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [movementType, String(referenceKey), amount, String(currencyCode || 'USD').toUpperCase().slice(0, 3),
        requestedBy, key, JSON.stringify(payload || {})]
    );
    const approval = inserted.rows[0];
    logger.info('[dualApproval] money movement queued for second approval', {
      approvalId: approval.id, movementType, referenceKey, amountCents: amount, requestedBy,
    });
    return { queued: true, approval, replay: false };
  }, 'dual_approval_request');
}

/**
 * Decide a pending approval. The checker must differ from the maker and must
 * have proven a fresh step-up challenge (verified by the caller before
 * invoking). On 'approve', the rail executor runs inside the same
 * transaction that flips the row to executed.
 */
async function decideMoneyMovementApproval({ approvalId, approverId, decision, reason }) {
  if (!['approve', 'reject'].includes(decision)) {
    throw new AppError('Decision must be approve or reject', 400, 'money_movement_invalid_decision');
  }
  if (!approverId) throw new AppError('approverId is required', 400, 'money_movement_actor_required');

  const outcome = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM money_movement_approvals WHERE id = $1 FOR UPDATE',
      [approvalId]
    );
    const approval = rows[0];
    if (!approval) throw new AppError('Approval request not found', 404, 'money_movement_not_found');
    if (approval.status !== 'pending') {
      throw new AppError(
        `Approval request is already ${approval.status}`,
        409,
        'money_movement_not_pending'
      );
    }
    // Maker-checker: the requester can never approve their own movement.
    // (Also enforced by the DB CHECK constraint as a second line of defense.)
    if (String(approval.requested_by) === String(approverId)) {
      throw new AppError('The requesting admin cannot approve their own money movement', 403, 'money_movement_self_approval');
    }

    if (decision === 'reject') {
      const rejected = await client.query(
        `UPDATE money_movement_approvals
            SET status = 'rejected', decided_by = $2, decided_at = NOW(),
                decision_reason = $3, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [approvalId, approverId, reason ? String(reason).slice(0, 1000) : null]
      );
      logger.info('[dualApproval] money movement rejected', {
        approvalId, movementType: approval.movement_type, decidedBy: approverId,
      });
      return { approval: rejected.rows[0], executed: false };
    }

    if (!executors.has(approval.movement_type)) {
      try {
        require('./moneyMovementExecutors').registerMoneyMovementExecutors();
      } catch (err) {
        logger.error('[dualApproval] executor registration failed', { error: err.message });
      }
    }
    const executor = getMoneyMovementExecutor(approval.movement_type);
    if (!executor) {
      throw new AppError(
        `No executor registered for movement type ${approval.movement_type}`,
        500,
        'money_movement_no_executor'
      );
    }
    let payload = approval.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { payload = {}; }
    }
    // The executor moves the money. It runs inside this transaction's
    // scope: if it throws, everything (including the approval flip) rolls
    // back and the request stays pending for a safe retry.
    let result;
    try {
      result = await executor({
        approval,
        payload: payload || {},
        approverId,
        requestedBy: approval.requested_by,
        client,
      });
    } catch (err) {
      logger.error('[dualApproval] executor failed; approval stays pending', {
        approvalId, movementType: approval.movement_type, error: err.message,
      });
      throw err;
    }
    const executed = await client.query(
      `UPDATE money_movement_approvals
          SET status = 'executed', decided_by = $2, decided_at = NOW(),
              executed_at = NOW(), result = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [approvalId, approverId, JSON.stringify(result || { ok: true })]
    );
    logger.info('[dualApproval] money movement approved and executed', {
      approvalId, movementType: approval.movement_type, decidedBy: approverId,
    });
    return { approval: executed.rows[0], executed: true, result };
  }, 'dual_approval_decide');
  try { await outcome.result?.afterCommit?.(); }
  catch (err) { logger.error('Money movement notification failed after commit', { approvalId, error: err.message }); }
  return outcome;
}

async function listPendingMoneyMovementApprovals({ limit = 50, offset = 0 } = {}) {
  const parsed = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { rows } = await pool.query(
    `SELECT a.*,
            r.email AS requested_by_email,
            r.first_name AS requested_by_first_name,
            r.last_name AS requested_by_last_name
       FROM money_movement_approvals a
       LEFT JOIN users r ON r.id = a.requested_by
      WHERE a.status = 'pending'
      ORDER BY a.requested_at ASC, a.id ASC
      LIMIT $1 OFFSET $2`,
    [parsed, safeOffset]
  );
  const count = await pool.query("SELECT COUNT(*)::int AS total FROM money_movement_approvals WHERE status = 'pending'");
  return { approvals: rows, total: Number(count.rows[0]?.total || 0), limit: parsed, offset: safeOffset };
}

async function getMoneyMovementApproval(approvalId) {
  const { rows } = await pool.query(
    'SELECT * FROM money_movement_approvals WHERE id = $1',
    [approvalId]
  );
  return rows[0] || null;
}

module.exports = {
  DEFAULT_THRESHOLD_CENTS,
  getDualApprovalThresholdCents,
  movementRequiresDualApproval,
  requestMoneyMovementApproval,
  decideMoneyMovementApproval,
  listPendingMoneyMovementApprovals,
  getMoneyMovementApproval,
  registerMoneyMovementExecutor,
  getMoneyMovementExecutor,
  setSettingsReader,
};
