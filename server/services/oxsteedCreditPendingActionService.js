'use strict';

/**
 * OxSteed Credit maker-checker (dual approval) service (Phase 7, gap 9).
 *
 * Every admin money movement is wrapped in a pending action: the maker
 * (requesting super-admin) records intent + payload, and a DIFFERENT
 * super-admin (the checker) approves or rejects it. Execution happens
 * inside the decision transaction while the pending row is locked, so a
 * second approval after a successful execution replays the stored
 * execution refs instead of moving money twice.
 *
 * Rules enforced here (fail closed):
 * - assertCreditRailEnabled() runs first on every path (503 when frozen).
 * - The checker must prove a fresh step-up challenge
 *   (actionType 'pending_action_approve') before execution.
 * - Self-approval is 403 credit_self_approval_forbidden.
 * - Rejection requires a reason (400 credit_decision_reason_required).
 * - Lazy expiry: deciding an expired pending action marks it expired and
 *   returns 409 credit_pending_action_expired; it can never execute.
 * - OXSTEED_CREDIT_MAKER_CHECKER_THRESHOLD_CENTS (default 0): when set
 *   above 0, money movements below the threshold execute immediately
 *   under the single requesting admin (the bypass is deliberate and is
 *   named in a comment at the call site). Amount-less actions
 *   (fee schedule updates) always require dual approval.
 * - Idempotency: the caller's Idempotency-Key is the pending action's
 *   idempotency key, so a retried request replays the existing receipt
 *   instead of queueing a duplicate.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { assertCreditRailEnabled } = require('./oxsteedCreditService');
const {
  insertAudit,
  transitionSettlement,
  reverseSettlement,
  initiateSettlementPayout,
} = require('./oxsteedCreditAdminService');
const {
  loadCustomerCredit,
  adjustCustomerCredit,
  refundCredit,
  captureCreditHold,
} = require('./oxsteedCreditService');
const { approveWithdrawal } = require('./oxsteedCreditWithdrawalService');
const { updateFeeScheduleRow } = require('./oxsteedCreditFeeScheduleService');
const { upsertReservePolicy } = require('./oxsteedCreditReserveService');
const { recordPartnerFundingInTransaction } = require('./oxsteedCreditPartnerLedgerService');
const { createCurrencyQuote } = require('./oxsteedCreditCurrencyConversionService');
const { verifyStepupChallenge } = require('./stepupChallengeService');

const PENDING_ACTION_TTL_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_PENDING_ACTION_TTL_HOURS || '24', 10) || 24
);
const MAKER_CHECKER_THRESHOLD_CENTS = Math.max(
  0,
  Number.parseInt(process.env.OXSTEED_CREDIT_MAKER_CHECKER_THRESHOLD_CENTS || '0', 10) || 0
);

const PENDING_ACTION_STATUSES = ['pending', 'approved', 'rejected', 'expired'];

function normalizeText(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function parseAmount(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function formatPendingAction(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    actionType: row.action_type,
    payload: row.payload || {},
    requestedBy: row.requested_by || null,
    requestedAt: row.requested_at || null,
    status: row.status,
    decidedBy: row.decided_by || null,
    decidedAt: row.decided_at || null,
    decisionReason: row.decision_reason || null,
    expiresAt: row.expires_at || null,
    idempotencyKey: row.idempotency_key || null,
    executionRefs: row.execution_refs || {},
  };
}

/**
 * Amount in cents for threshold routing. Settlement-family actions resolve
 * their amount from the settlement's net_cents; fee schedule updates have
 * no amount and always require dual approval.
 */
async function resolveActionAmountCents(actionType, payload) {
  switch (actionType) {
    case 'credit_load':
    case 'credit_adjustment':
    case 'credit_refund':
    case 'credit_hold_capture':
    case 'credit_withdrawal_approval':
    case 'credit_partner_funding':
      return parseAmount(payload.amountCents ?? payload.amount_cents);
    case 'credit_currency_quote':
      return parseAmount(payload.sourceAmountMinorUnits ?? payload.source_amount_minor_units);
    case 'credit_settlement_approval':
    case 'credit_settlement_payout':
    case 'credit_settlement_reversal': {
      const settlementId = payload.settlementId || payload.settlement_id;
      if (!settlementId) return null;
      const { rows } = await pool.query(
        'SELECT net_cents FROM oxsteed_credit_settlements WHERE id = $1',
        [settlementId]
      );
      return rows[0] ? parseAmount(rows[0].net_cents) : null;
    }
    case 'credit_fee_schedule_update':
    case 'credit_reserve_policy_update':
    default:
      return null;
  }
}

/**
 * Registered executors. Each receives the stored payload plus the acting
 * (checker) admin and runs the real service function, carrying the
 * original Idempotency-Key from the payload so a crash between execution
 * and the decision commit replays safely on retry.
 */
const ACTION_EXECUTORS = {
  credit_load: async ({ payload, actorUserId, requestIp, correlationId }) =>
    loadCustomerCredit({
      customerId: payload.customerId,
      amountCents: payload.amountCents,
      currencyCode: payload.currencyCode,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      reason: payload.reason,
      referenceType: 'admin_load',
      referenceId: payload.referenceId,
      correlationId,
      requestIp,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
  credit_adjustment: async ({ payload, actorUserId, requestIp, correlationId }) =>
    adjustCustomerCredit({
      customerId: payload.customerId,
      amountCents: payload.amountCents,
      currencyCode: payload.currencyCode,
      direction: payload.direction,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      reason: payload.reason,
      referenceType: 'admin_adjustment',
      referenceId: payload.referenceId,
      correlationId,
      requestIp,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
  credit_refund: async ({ payload, actorUserId, requestIp, correlationId }) =>
    refundCredit({
      purchaseTransactionId: payload.purchaseTransactionId,
      amountCents: payload.amountCents,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      actorType: 'admin',
      reason: payload.reason,
      correlationId,
      requestIp,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
  credit_hold_capture: async ({ payload, actorUserId, requestIp, correlationId }) =>
    captureCreditHold({
      holdId: payload.holdId,
      amountCents: payload.amountCents,
      currencyCode: payload.currencyCode,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      actorType: 'admin',
      orderType: payload.orderType,
      category: payload.category,
      categories: payload.categories,
      menuItemId: payload.menuItemId,
      menuItemIds: payload.menuItemIds,
      city: payload.city,
      state: payload.state,
      postalCode: payload.postalCode,
      country: payload.country,
      referenceType: payload.referenceType,
      referenceId: payload.referenceId,
      correlationId,
      requestIp,
      description: payload.description,
      reason: payload.reason,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
  credit_settlement_approval: async ({ payload, actorUserId, requestIp, correlationId }) =>
    transitionSettlement({
      settlementId: payload.settlementId,
      targetStatus: payload.targetStatus,
      expectedStatus: payload.expectedStatus,
      actorUserId,
      reason: payload.reason,
      paymentReference: payload.paymentReference,
      correlationId,
      requestIp,
    }),
  credit_settlement_payout: async ({ payload, actorUserId, requestIp }) =>
    initiateSettlementPayout({
      settlementId: payload.settlementId,
      actorUserId,
      idempotencyKey: payload.idempotencyKey,
      requestIp,
    }),
  credit_settlement_reversal: async ({ payload, actorUserId, requestIp, correlationId }) =>
    reverseSettlement({
      settlementId: payload.settlementId,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      reason: payload.reason,
      recoveryReference: payload.recoveryReference,
      correlationId,
      requestIp,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
  credit_withdrawal_approval: async ({ payload, actorUserId, requestIp, correlationId }) =>
    approveWithdrawal({
      withdrawalId: payload.withdrawalId,
      actorUserId,
      idempotencyKey: payload.idempotencyKey,
      requestIp,
      correlationId,
    }),
  credit_fee_schedule_update: async ({ client, payload, actorUserId, requestIp, correlationId }) => {
    const row = await updateFeeScheduleRow(client, {
      id: payload.id,
      fixedCents: payload.fixedCents,
      percentageBps: payload.percentageBps,
      minFeeCents: payload.minFeeCents,
      maxFeeCents: payload.maxFeeCents,
      isActive: payload.isActive,
    });
    if (!row) throw new AppError('Fee schedule row was not found', 404, 'credit_fee_schedule_not_found');
    // Preserve the audit event the old single-admin route emitted.
    await insertAudit(client, {
      actionType: 'credit.fee_schedule.updated',
      actorUserId,
      resourceType: 'fee_schedule',
      resourceId: String(row.id),
      reason: payload.reason || 'Fee schedule updated',
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      metadata: { approvedBy: actorUserId },
    });
    return row;
  },
  // Phase 8: reserve policy updates (default per currency or per-partner
  // override) queue for dual approval like fee schedule updates: they carry
  // no amount, so they always need a checker.
  credit_reserve_policy_update: async ({ client, payload, actorUserId, requestIp, correlationId }) => {
    const policy = await upsertReservePolicy(client, {
      partnerId: payload.partnerId ?? payload.partner_id ?? null,
      currencyCode: payload.currencyCode ?? payload.currency_code,
      ratioBps: payload.ratioBps ?? payload.ratio_bps,
      floorCents: payload.floorCents ?? payload.floor_cents,
    });
    await insertAudit(client, {
      actionType: 'credit.reserve_policy.updated',
      actorUserId,
      resourceType: 'reserve_policy',
      resourceId: String(policy.id),
      reason: payload.reason || 'Reserve policy updated',
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      metadata: {
        approvedBy: actorUserId,
        partnerId: policy.partnerId,
        currencyCode: policy.currencyCode,
        ratioBps: policy.ratioBps,
        floorCents: policy.floorCents,
        isDefault: policy.isDefault,
      },
    });
    return policy;
  },
  credit_partner_funding: async ({ client, payload, actorUserId, requestIp, correlationId }) =>
    recordPartnerFundingInTransaction(client, {
      partnerId: payload.partnerId,
      currencyCode: payload.currencyCode,
      amountCents: payload.amountCents,
      direction: payload.direction,
      externalReference: payload.externalReference,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      reason: payload.reason,
      correlationId,
      requestIp,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
  credit_currency_quote: async ({ payload, actorUserId, correlationId }) =>
    createCurrencyQuote({
      sourceCurrencyCode: payload.sourceCurrencyCode,
      targetCurrencyCode: payload.targetCurrencyCode,
      sourceAmountMinorUnits: payload.sourceAmountMinorUnits,
      targetAmountMinorUnits: payload.targetAmountMinorUnits,
      feeAmountMinorUnits: payload.feeAmountMinorUnits,
      rateNumerator: payload.rateNumerator,
      rateDenominator: payload.rateDenominator,
      roundingMode: payload.roundingMode,
      provider: payload.provider,
      providerQuoteReference: payload.providerQuoteReference,
      expiresAt: payload.expiresAt,
      idempotencyKey: payload.idempotencyKey,
      actorUserId,
      customerId: payload.customerId,
      reason: payload.reason,
      correlationId,
      metadata: { ...(payload.metadata || {}), approvedBy: actorUserId },
    }),
};

const ACTION_TYPES = Object.freeze(Object.keys(ACTION_EXECUTORS));

/**
 * Request a pending action (the maker half). Fails closed when the rail is
 * disabled. Below-threshold money movements execute immediately under the
 * requesting admin; everything else queues for a different admin to
 * decide. The caller's Idempotency-Key makes replays return the existing
 * receipt.
 */
async function requestPendingAction({ actionType, payload, requestedBy, idempotencyKey, requestIp, correlationId }) {
  await assertCreditRailEnabled(pool);
  const normalizedType = normalizeText(actionType, 60);
  if (!ACTION_EXECUTORS[normalizedType]) {
    throw new AppError('Unsupported pending action type', 400, 'credit_pending_action_type_invalid');
  }
  if (!requestedBy) throw new AppError('A requesting administrator is required', 403, 'credit_pending_action_actor_required');
  const key = normalizeText(idempotencyKey, 200);
  if (!key) throw new AppError('An Idempotency-Key is required to request a pending action', 400, 'credit_pending_action_idempotency_required');

  const storedPayload = { ...(payload || {}), idempotencyKey: key };
  const amountCents = await resolveActionAmountCents(normalizedType, storedPayload);

  // Threshold bypass: OXSTEED_CREDIT_MAKER_CHECKER_THRESHOLD_CENTS lets
  // Emile exempt small movements from dual approval; the requesting admin
  // alone executes them (default 0 = every movement needs a checker).
  if (MAKER_CHECKER_THRESHOLD_CENTS > 0 && amountCents !== null && amountCents < MAKER_CHECKER_THRESHOLD_CENTS) {
    const executor = ACTION_EXECUTORS[normalizedType];
    const result = await withTransaction(pool, async (client) => executor({
      client,
      payload: storedPayload,
      actorUserId: requestedBy,
      requestIp: requestIp || null,
      correlationId: correlationId || null,
    }));
    await withTransaction(pool, async (client) => insertAudit(client, {
      actionType: 'credit.pending_action.threshold_executed',
      actorUserId: requestedBy,
      resourceType: 'pending_action',
      resourceId: normalizedType,
      reason: `Below maker-checker threshold (${MAKER_CHECKER_THRESHOLD_CENTS} cents); executed directly`,
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      metadata: { actionType: normalizedType, amountCents },
    }));
    return { executed: true, pendingAction: null, result };
  }

  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_HOURS * 3600 * 1000).toISOString();
  try {
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO oxsteed_credit_pending_actions
           (action_type, payload, requested_by, expires_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [normalizedType, JSON.stringify(storedPayload), requestedBy, expiresAt, key]
      );
      await insertAudit(client, {
        actionType: 'credit.pending_action.requested',
        actorUserId: requestedBy,
        resourceType: 'pending_action',
        resourceId: String(rows[0].id),
        reason: `Maker requested ${normalizedType}`,
        correlationId: correlationId || null,
        requestIp: requestIp || null,
        metadata: { actionType: normalizedType, amountCents },
      });
      return rows[0];
    });
    return { executed: false, pendingAction: formatPendingAction(result), result: null, replayed: false };
  } catch (error) {
    if (error && error.code === '23505') {
      const { rows } = await pool.query(
        `SELECT * FROM oxsteed_credit_pending_actions WHERE idempotency_key = $1`,
        [key]
      );
      const existing = formatPendingAction(rows[0]);
      return { executed: false, pendingAction: existing, result: null, replayed: true };
    }
    throw error;
  }
}

/**
 * Decide a pending action (the checker half). The row is locked for the
 * whole decision; the checker proves a fresh step-up challenge, the
 * executor runs, and the row flips to approved with the execution refs in
 * the same commit. Re-approving an approved action returns the stored
 * refs as a no-op.
 */
async function decidePendingAction({ actionId, decidedBy, decision, reason, stepupChallengeId, stepupCode, requestIp, correlationId }) {
  await assertCreditRailEnabled(pool);
  const normalizedDecision = decision === 'rejected' || decision === 'reject' ? 'rejected' : 'approved';
  if (!decidedBy) throw new AppError('A deciding administrator is required', 403, 'credit_pending_action_actor_required');
  const normalizedReason = normalizeText(reason, 2000);

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE`,
      [actionId]
    );
    const action = rows[0];
    if (!action) throw new AppError('Pending action was not found', 404, 'credit_pending_action_not_found');

    if (action.status === 'approved') {
      // Double-approve after a successful execution: replay the stored
      // execution refs; the executor does not run again.
      return { pendingAction: formatPendingAction(action), result: action.execution_refs || {}, replayed: true };
    }
    if (action.status !== 'pending') {
      throw new AppError('Pending action has already been decided', 409, 'credit_pending_action_decided');
    }
    if (action.expires_at && new Date(action.expires_at).getTime() < Date.now()) {
      await client.query(
        `UPDATE oxsteed_credit_pending_actions
            SET status = 'expired', decided_at = NOW()
          WHERE id = $1`,
        [action.id]
      );
      await insertAudit(client, {
        actionType: 'credit.pending_action.expired',
        actorUserId: decidedBy,
        resourceType: 'pending_action',
        resourceId: String(action.id),
        reason: 'Pending action expired before a decision',
        correlationId: correlationId || null,
        requestIp: requestIp || null,
        metadata: { actionType: action.action_type },
      });
      throw new AppError('Pending action has expired and can no longer be decided', 409, 'credit_pending_action_expired');
    }
    if (String(action.requested_by) === String(decidedBy)) {
      throw new AppError('The requesting administrator cannot approve their own action', 403, 'credit_self_approval_forbidden');
    }
    if (normalizedDecision === 'rejected' && !normalizedReason) {
      throw new AppError('A reason is required to reject a pending action', 400, 'credit_decision_reason_required');
    }

    const decidedAt = new Date().toISOString();
    if (normalizedDecision === 'rejected') {
      await client.query(
        `UPDATE oxsteed_credit_pending_actions
            SET status = 'rejected', decided_by = $2, decided_at = $3, decision_reason = $4
          WHERE id = $1`,
        [action.id, decidedBy, decidedAt, normalizedReason]
      );
      await insertAudit(client, {
        actionType: 'credit.pending_action.decided',
        actorUserId: decidedBy,
        resourceType: 'pending_action',
        resourceId: String(action.id),
        reason: normalizedReason,
        correlationId: correlationId || null,
        requestIp: requestIp || null,
        metadata: { actionType: action.action_type, decision: 'rejected', requestedBy: action.requested_by },
      });
      const { rows: rejectedRows } = await client.query(
        `SELECT * FROM oxsteed_credit_pending_actions WHERE id = $1`,
        [action.id]
      );
      return { pendingAction: formatPendingAction(rejectedRows[0]), result: null, replayed: false };
    }

    // Approval: verify the checker's fresh step-up BEFORE any money moves.
    await verifyStepupChallenge({
      challengeId: stepupChallengeId,
      actorUserId: decidedBy,
      actionType: 'pending_action_approve',
      code: stepupCode,
    });

    const executor = ACTION_EXECUTORS[action.action_type];
    if (!executor) throw new AppError('Unsupported pending action type', 400, 'credit_pending_action_type_invalid');
    const storedPayload = { ...(action.payload || {}), idempotencyKey: action.idempotency_key };
    const executionResult = await executor({
      client,
      payload: storedPayload,
      actorUserId: decidedBy,
      requestIp: requestIp || null,
      correlationId: correlationId || null,
    });
    const executionRefs = JSON.parse(JSON.stringify(executionResult || {}));

    await client.query(
      `UPDATE oxsteed_credit_pending_actions
          SET status = 'approved', decided_by = $2, decided_at = $3,
              decision_reason = $4, execution_refs = $5
        WHERE id = $1`,
      [action.id, decidedBy, decidedAt, normalizedReason || null, JSON.stringify(executionRefs)]
    );
    await insertAudit(client, {
      actionType: 'credit.pending_action.decided',
      actorUserId: decidedBy,
      resourceType: 'pending_action',
      resourceId: String(action.id),
      reason: normalizedReason || `Checker approved ${action.action_type}`,
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      metadata: { actionType: action.action_type, decision: 'approved', requestedBy: action.requested_by },
    });
    const { rows: approvedRows } = await client.query(
      `SELECT * FROM oxsteed_credit_pending_actions WHERE id = $1`,
      [action.id]
    );
    return { pendingAction: formatPendingAction(approvedRows[0]), result: executionResult, replayed: false };
  });
}

async function getPendingAction(actionId) {
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_pending_actions WHERE id = $1`,
    [actionId]
  );
  return formatPendingAction(rows[0] || null);
}

async function listPendingActions({ status = null, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status && PENDING_ACTION_STATUSES.includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  params.push(Math.min(200, Math.max(1, Number(limit) || 50)));
  params.push(Math.max(0, Number(offset) || 0));
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_pending_actions
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY requested_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(formatPendingAction);
}

module.exports = {
  ACTION_TYPES,
  PENDING_ACTION_STATUSES,
  MAKER_CHECKER_THRESHOLD_CENTS,
  requestPendingAction,
  decidePendingAction,
  getPendingAction,
  listPendingActions,
  resolveActionAmountCents,
};
