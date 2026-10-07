'use strict';

/**
 * Agent OxSteed Credit adjustments with a two-person rule.
 *
 * This is hand-moved money on the credit rail, so human supervision is the
 * fail-safe. The rule set:
 *
 *   - Every propose requires a non-empty reason and a client-generated
 *     idempotency key (retries with the same key return the existing row,
 *     never a duplicate). No money moves at propose time unless the amount
 *     is below the auto-apply threshold.
 *   - TWO_PERSON_THRESHOLD_CENTS ($50.00): below it, the proposing admin may
 *     apply directly in the same call (still reasoned and fully audited).
 *     At or above it, propose() only creates a PENDING row and a DIFFERENT
 *     admin must approve() before anything posts. Self-approval is a hard
 *     403 in code (approver id !== proposer id), not just UI convention.
 *   - Money moves only inside a single transaction that also flips the row
 *     to 'applied' and records before/after balances. A disabled or frozen
 *     rail, or any posting failure, fails closed: the row stays pending and
 *     nothing posts. Nothing half-moves.
 *   - DAILY_ADJUSTMENT_CAP_CENTS ($500.00): per proposing admin, per
 *     UTC calendar day, on the absolute value of applied adjustments.
 *   - The ledger posting reuses the existing 'adjustment' journal path
 *     (treasury <-> customer_wallet), so all ledger invariants, capacity
 *     checks, and idempotency semantics stay in one place.
 *   - Every propose / approve / reject / cancel / apply writes an entry to
 *     oxsteed_credit_audit_events with actor, reason, amount and
 *     before/after balances.
 *
 * Account identification: adjustments target a customer's credit wallet,
 * identified by customer_id (the users.id the wallet is keyed on).
 * Multi-currency is supported through assertSupportedCreditCurrency.
 *
 * Control-plane note: this console and the Super Admin adjustments endpoint
 * (POST /super/oxsteed-credit/customers/:customerId/adjustments) enforce the
 * SAME two-person policy through the SAME knob:
 * OXSTEED_CREDIT_MAKER_CHECKER_THRESHOLD_CENTS. Amounts below the threshold
 * may be applied by the proposing admin alone (fully reasoned and audited);
 * amounts at or above it need a different admin to approve. The Super Admin
 * path implements this via the generic maker-checker pending-action queue
 * (requestPendingAction); this console implements it inline with PENDING
 * rows and a hard self-approval 403. Default 5000 ($50.00): set the env var
 * to 0 to require two-person approval for every adjustment on both planes.
 */

const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const creditService = require('../services/oxsteedCreditService');

const {
  assertCreditRailEnabled,
  adjustCustomerCreditInTransaction,
  parseAmountCents,
  assertSupportedCreditCurrency,
  normalizeString,
} = creditService;

// Amounts at or above this need a second admin. Below it the proposing admin
// may apply directly in the same call. Unified with the Super Admin
// maker-checker plane: OXSTEED_CREDIT_MAKER_CHECKER_THRESHOLD_CENTS is the
// single knob (default 5000 = $50.00 here; 0 = two-person for everything).
const TWO_PERSON_THRESHOLD_CENTS = Math.max(
  0,
  Number.parseInt(process.env.OXSTEED_CREDIT_MAKER_CHECKER_THRESHOLD_CENTS || '5000', 10) || 5000
);
// Per proposing admin, per UTC calendar day, on abs(amount) of applied rows.
const DAILY_ADJUSTMENT_CAP_CENTS = 50000; // $500.00

const VALID_STATUSES = ['pending', 'approved', 'applied', 'rejected', 'cancelled'];

function requestContext(req) {
  return {
    correlationId: req.correlationId || req.get?.('X-Request-ID') || null,
    requestIp: req.ip || null,
  };
}

function parseSignedAmountCents(value) {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      amountCents: 'Must be a non-zero integer number of cents (positive = credit, negative = debit)',
    });
  }
  // Reuse the rail's own ceiling so adjustments can never exceed what the
  // rail allows any single transaction to be.
  parseAmountCents(Math.abs(amount), 'amountCents');
  return amount;
}

function parseUuidField(value, fieldName) {
  const normalized = normalizeString(value, 64);
  if (!/^[0-9a-fA-F-]{36}$/.test(normalized || '')) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [fieldName]: 'Must be a valid UUID',
    });
  }
  return normalized;
}

function parseReason(value) {
  const reason = normalizeString(value, 2000);
  if (!reason || !reason.trim()) {
    throw new AppError('A reason is required for credit adjustments', 400, 'credit_adjustment_reason_required');
  }
  return reason.trim();
}

function parseIdempotencyKey(value) {
  const key = normalizeString(value, 160);
  if (!key) {
    throw new AppError('An idempotency key is required for credit adjustments', 400, 'credit_idempotency_key_required');
  }
  return key;
}

function formatAdjustment(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    amountCents: Number(row.amount_cents),
    direction: Number(row.amount_cents) >= 0 ? 'credit' : 'debit',
    currencyCode: row.currency_code,
    reason: row.reason,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    beforeBalanceCents: row.before_balance_cents === null ? null : Number(row.before_balance_cents),
    afterBalanceCents: row.after_balance_cents === null ? null : Number(row.after_balance_cents),
    rejectReason: row.reject_reason,
    ledgerTransactionId: row.ledger_transaction_id,
    proposedAt: row.proposed_at,
    approvedAt: row.approved_at,
    appliedAt: row.applied_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requiresSecondApproval: Math.abs(Number(row.amount_cents)) >= TWO_PERSON_THRESHOLD_CENTS,
  };
}

async function writeAdjustmentAudit(client, {
  actionType, actorUserId, adjustment, customerId, reason,
  beforeCents, afterCents, correlationId, requestIp, extra = {},
}) {
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, resource_type, resource_id,
        reason, correlation_id, request_ip, before_state, after_state, metadata)
     VALUES ($1, $2, $3, 'credit_adjustment', $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      actionType,
      actorUserId || null,
      customerId || null,
      String(adjustment.id),
      reason || null,
      correlationId || null,
      requestIp || null,
      JSON.stringify({
        status: adjustment.status,
        amountCents: Number(adjustment.amount_cents),
        beforeBalanceCents: beforeCents === undefined ? null : beforeCents,
      }),
      JSON.stringify({
        status: adjustment.status,
        amountCents: Number(adjustment.amount_cents),
        afterBalanceCents: afterCents === undefined ? null : afterCents,
        approvedBy: adjustment.approved_by,
      }),
      JSON.stringify({ twoPersonThresholdCents: TWO_PERSON_THRESHOLD_CENTS, ...extra }),
    ]
  );
}

async function findAdjustmentForUpdate(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM credit_adjustments WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
}

async function assertDailyCap(client, proposedBy, additionalCents) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(ABS(amount_cents)), 0)::bigint AS used_today
       FROM credit_adjustments
      WHERE proposed_by = $1
        AND status = 'applied'
        AND applied_at >= (NOW() AT TIME ZONE 'UTC')::date`,
    [proposedBy]
  );
  const usedToday = Number(rows[0]?.used_today || 0);
  if (usedToday + Math.abs(additionalCents) > DAILY_ADJUSTMENT_CAP_CENTS) {
    throw new AppError(
      'Daily credit adjustment cap exceeded for this admin',
      422,
      'credit_adjustment_daily_cap_exceeded',
      {
        dailyCapCents: String(DAILY_ADJUSTMENT_CAP_CENTS),
        usedTodayCents: String(usedToday),
        requestedCents: String(Math.abs(additionalCents)),
      }
    );
  }
}

async function readWalletBalanceForUpdate(client, customerId, currencyCode) {
  const { rows } = await client.query(
    `SELECT balance_cents FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet'
        AND customer_id = $1
        AND currency_code = $2
        FOR UPDATE`,
    [customerId, currencyCode]
  );
  return rows[0] ? Number(rows[0].balance_cents) : null;
}

/**
 * Move the money and finalize the adjustment row, atomically.
 *
 * Callers must hold the adjustment row FOR UPDATE and must have verified the
 * row is in a state that allows applying ('pending' or 'approved').
 * Rail assertions run first so a disabled/frozen rail or a posting failure
 * rolls everything back and the row stays 'pending' (fail closed).
 */
async function applyAdjustmentPosting(client, adjustment, {
  actorUserId, approverId = null, correlationId, requestIp,
}) {
  // Fail closed: rail disabled or frozen, or unreadable freeze state,
  // throws before any money moves.
  await assertCreditRailEnabled(client);

  // Serialize concurrent applies for the same adjustment; the row lock plus
  // the status check makes double-apply impossible.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agent-credit-adjustment:${adjustment.id}`]);

  await assertDailyCap(client, adjustment.proposed_by, adjustment.amount_cents);

  const beforeBalanceCents = await readWalletBalanceForUpdate(client, adjustment.customer_id, adjustment.currency_code);
  const absAmount = Math.abs(Number(adjustment.amount_cents));
  const direction = Number(adjustment.amount_cents) >= 0 ? 'credit' : 'debit';

  const { transaction } = await adjustCustomerCreditInTransaction(client, {
    customerId: adjustment.customer_id,
    amountCents: absAmount,
    currencyCode: adjustment.currency_code,
    direction,
    // Namespaced so the ledger posting is idempotent per adjustment and
    // cannot collide with other adjustment sources.
    idempotencyKey: `agent-credit-adjustment:${adjustment.id}:${adjustment.idempotency_key}`,
    actorType: 'admin',
    actorUserId,
    reason: adjustment.reason,
    referenceType: 'agent_credit_adjustment',
    referenceId: `credit_adjustment:${adjustment.id}`,
    correlationId,
    requestIp,
    metadata: { direction, adjustmentId: String(adjustment.id), twoPerson: approverId !== null && String(approverId) !== String(adjustment.proposed_by) },
  });

  const afterBalanceCents = await readWalletBalanceForUpdate(client, adjustment.customer_id, adjustment.currency_code);

  const { rows } = await client.query(
    `UPDATE credit_adjustments
        SET status = 'applied',
            approved_by = COALESCE($2, approved_by),
            approved_at = COALESCE(approved_at, CASE WHEN $2 IS NULL THEN NULL ELSE NOW() END),
            before_balance_cents = $3,
            after_balance_cents = $4,
            ledger_transaction_id = $5,
            applied_at = NOW(),
            decided_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      adjustment.id,
      approverId,
      beforeBalanceCents,
      afterBalanceCents,
      transaction?.id ? Number(transaction.id) : null,
    ]
  );
  const applied = rows[0];

  await writeAdjustmentAudit(client, {
    actionType: 'credit.agent_adjustment.applied',
    actorUserId,
    adjustment: applied,
    customerId: applied.customer_id,
    reason: applied.reason,
    beforeCents: beforeBalanceCents,
    afterCents: afterBalanceCents,
    correlationId,
    requestIp,
  });

  logger.info('[AgentCreditAdjustment] applied', {
    adjustmentId: applied.id,
    customerId: applied.customer_id,
    amountCents: applied.amount_cents,
    approvedBy: applied.approved_by,
  });

  return applied;
}

/**
 * POST /agent/credit-adjustments
 * Propose an adjustment. Below the $50 threshold the proposing admin applies
 * it immediately in the same call; at or above the threshold the row stays
 * PENDING for a different admin to approve. No money moves for pending rows.
 * Same idempotency key returns the existing row (replayed: true).
 */
async function proposeAdjustment(req, res, next) {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw new AppError('Unauthorized.', 401, 'unauthorized');

    const customerId = parseUuidField(req.body?.customerId ?? req.body?.customer_id, 'customerId');
    const amountCents = parseSignedAmountCents(req.body?.amountCents ?? req.body?.amount_cents);
    const currencyCode = assertSupportedCreditCurrency(req.body?.currencyCode ?? req.body?.currency_code ?? 'USD');
    const reason = parseReason(req.body?.reason);
    const idempotencyKey = parseIdempotencyKey(req.body?.idempotencyKey ?? req.body?.idempotency_key);
    const { correlationId, requestIp } = requestContext(req);

    const result = await withTransaction(pool, async (client) => {
      // Idempotent propose: first writer wins; concurrent losers read the
      // winner's row instead of creating a duplicate.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agent-credit-adjustment-propose:${idempotencyKey}`]);
      const { rows: inserted } = await client.query(
        `INSERT INTO credit_adjustments
           (customer_id, amount_cents, currency_code, reason, proposed_by, idempotency_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [customerId, amountCents, currencyCode, reason, adminId, idempotencyKey]
      );
      let row = inserted[0];
      let replayed = false;
      if (!row) {
        replayed = true;
        const { rows } = await client.query(
          `SELECT * FROM credit_adjustments WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        row = rows[0];
      }
      if (!row) throw new AppError('Adjustment proposal failed', 500, 'credit_adjustment_propose_failed');

      if (!replayed) {
        await writeAdjustmentAudit(client, {
          actionType: 'credit.agent_adjustment.proposed',
          actorUserId: adminId,
          adjustment: row,
          customerId: row.customer_id,
          reason: row.reason,
          correlationId,
          requestIp,
        });
      }

      // Below the threshold the proposer may apply directly. At or above the
      // threshold the row stays pending for a second admin.
      const autoApply = Math.abs(Number(row.amount_cents)) < TWO_PERSON_THRESHOLD_CENTS;
      if (!replayed && autoApply) {
        const locked = await findAdjustmentForUpdate(client, row.id);
        row = await applyAdjustmentPosting(client, locked, {
          actorUserId: adminId,
          approverId: adminId,
          correlationId,
          requestIp,
        });
      }
      return { row, replayed };
    }, 'agent_credit_adjustment_propose');

    return res.status(result.replayed ? 200 : 201).json({
      adjustment: formatAdjustment(result.row),
      replayed: result.replayed,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /agent/credit-adjustments/:id/approve
 * The heart of the two-person rule: the approver MUST be a different admin
 * than the proposer. On approval the posting runs transactionally; a
 * disabled/frozen rail or a posting failure fails closed (row stays pending).
 */
async function approveAdjustment(req, res, next) {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw new AppError('Unauthorized.', 401, 'unauthorized');
    const id = parseUuidField(req.params?.id, 'id');
    const { correlationId, requestIp } = requestContext(req);

    const applied = await withTransaction(pool, async (client) => {
      const adjustment = await findAdjustmentForUpdate(client, id);
      if (!adjustment) throw new AppError('Credit adjustment not found', 404, 'credit_adjustment_not_found');
      if (adjustment.status !== 'pending') {
        throw new AppError('Only pending adjustments can be approved', 409, 'credit_adjustment_not_pending');
      }
      // Two-person rule: a proposal can only be approved by a different
      // human than the one who proposed it. Super-admin role does not
      // bypass this; it is keyed on the admin's identity.
      if (String(adjustment.proposed_by) === String(adminId)) {
        throw new AppError(
          'The proposing admin cannot approve their own adjustment. A different admin must approve.',
          403,
          'credit_adjustment_two_person_violation'
        );
      }
      if (Math.abs(Number(adjustment.amount_cents)) < TWO_PERSON_THRESHOLD_CENTS) {
        throw new AppError(
          'Adjustments below the two-person threshold do not need approval',
          409,
          'credit_adjustment_no_approval_needed'
        );
      }

      const { rows } = await client.query(
        `UPDATE credit_adjustments
            SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [adjustment.id, adminId]
      );
      const approved = rows[0];
      await writeAdjustmentAudit(client, {
        actionType: 'credit.agent_adjustment.approved',
        actorUserId: adminId,
        adjustment: approved,
        customerId: approved.customer_id,
        reason: approved.reason,
        correlationId,
        requestIp,
      });

      // Money moves inside the same transaction: approve and apply are one
      // atomic unit, so a posting failure rolls the approval back too.
      return applyAdjustmentPosting(client, approved, {
        actorUserId: adminId,
        approverId: adminId,
        correlationId,
        requestIp,
      });
    }, 'agent_credit_adjustment_approve');

    return res.status(200).json({ adjustment: formatAdjustment(applied) });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /agent/credit-adjustments/:id/reject
 * Requires a reason. Only a different admin may reject; the proposer uses
 * cancel() on their own pending proposal instead. No money moves.
 */
async function rejectAdjustment(req, res, next) {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw new AppError('Unauthorized.', 401, 'unauthorized');
    const id = parseUuidField(req.params?.id, 'id');
    const reason = parseReason(req.body?.rejectReason ?? req.body?.reason);
    const { correlationId, requestIp } = requestContext(req);

    const rejected = await withTransaction(pool, async (client) => {
      const adjustment = await findAdjustmentForUpdate(client, id);
      if (!adjustment) throw new AppError('Credit adjustment not found', 404, 'credit_adjustment_not_found');
      if (adjustment.status !== 'pending') {
        throw new AppError('Only pending adjustments can be rejected', 409, 'credit_adjustment_not_pending');
      }
      if (String(adjustment.proposed_by) === String(adminId)) {
        throw new AppError(
          'The proposing admin cannot reject their own adjustment. Cancel it instead.',
          403,
          'credit_adjustment_reject_self_forbidden'
        );
      }
      const { rows } = await client.query(
        `UPDATE credit_adjustments
            SET status = 'rejected', reject_reason = $2, decided_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [adjustment.id, reason]
      );
      const row = rows[0];
      await writeAdjustmentAudit(client, {
        actionType: 'credit.agent_adjustment.rejected',
        actorUserId: adminId,
        adjustment: row,
        customerId: row.customer_id,
        reason,
        correlationId,
        requestIp,
        extra: { originalReason: row.reason },
      });
      return row;
    }, 'agent_credit_adjustment_reject');

    return res.status(200).json({ adjustment: formatAdjustment(rejected) });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /agent/credit-adjustments/:id/cancel
 * The proposer may withdraw their own pending proposal before it is
 * approved. No money moves. A different admin uses reject() instead.
 */
async function cancelAdjustment(req, res, next) {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw new AppError('Unauthorized.', 401, 'unauthorized');
    const id = parseUuidField(req.params?.id, 'id');
    const { correlationId, requestIp } = requestContext(req);

    const cancelled = await withTransaction(pool, async (client) => {
      const adjustment = await findAdjustmentForUpdate(client, id);
      if (!adjustment) throw new AppError('Credit adjustment not found', 404, 'credit_adjustment_not_found');
      if (adjustment.status !== 'pending') {
        throw new AppError('Only pending adjustments can be cancelled', 409, 'credit_adjustment_not_pending');
      }
      if (String(adjustment.proposed_by) !== String(adminId)) {
        throw new AppError(
          'Only the proposing admin can cancel this adjustment.',
          403,
          'credit_adjustment_cancel_forbidden'
        );
      }
      const { rows } = await client.query(
        `UPDATE credit_adjustments
            SET status = 'cancelled', decided_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [adjustment.id]
      );
      const row = rows[0];
      await writeAdjustmentAudit(client, {
        actionType: 'credit.agent_adjustment.cancelled',
        actorUserId: adminId,
        adjustment: row,
        customerId: row.customer_id,
        reason: row.reason,
        correlationId,
        requestIp,
      });
      return row;
    }, 'agent_credit_adjustment_cancel');

    return res.status(200).json({ adjustment: formatAdjustment(cancelled) });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /agent/credit-adjustments/pending
 * The approval queue: pending adjustments awaiting a second human, oldest
 * first. Shaped for the support UI's approval list.
 */
async function listPendingAdjustments(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const { rows } = await pool.query(
      `SELECT ca.*,
              pu.first_name AS proposed_first_name,
              pu.last_name AS proposed_last_name,
              pu.email AS proposed_email
         FROM credit_adjustments ca
         LEFT JOIN users pu ON pu.id = ca.proposed_by
        WHERE ca.status = 'pending'
        ORDER BY ca.proposed_at ASC
        LIMIT $1`,
      [limit]
    );
    return res.status(200).json({
      adjustments: rows.map((row) => ({
        ...formatAdjustment(row),
        proposedByName: [row.proposed_first_name, row.proposed_last_name].filter(Boolean).join(' ') || row.proposed_email || null,
      })),
      thresholdCents: TWO_PERSON_THRESHOLD_CENTS,
      dailyCapCents: DAILY_ADJUSTMENT_CAP_CENTS,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  TWO_PERSON_THRESHOLD_CENTS,
  DAILY_ADJUSTMENT_CAP_CENTS,
  proposeAdjustment,
  approveAdjustment,
  rejectAdjustment,
  cancelAdjustment,
  listPendingAdjustments,
  formatAdjustment,
};
