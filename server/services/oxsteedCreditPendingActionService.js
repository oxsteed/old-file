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
 * - Self-approval is always 403 credit_self_approval_forbidden. The former
 *   single-super-admin break-glass (P1-9-F05) was retired by security
 *   review F-06: there is no flag, environment or admin-count exception.
 * - Rejection requires a reason (400 credit_decision_reason_required).
 * - Lazy expiry: deciding an expired pending action marks it expired and
 *   returns 409 credit_pending_action_expired; it can never execute.
 * - Every money movement requires a distinct checker. There is no amount,
 *   flag or environment bypass for maker-checker.
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
const { upsertRestaurantConversionPolicy } = require('./oxsteedCreditRestaurantConversionPolicyService');
const { recordPartnerFundingInTransaction } = require('./oxsteedCreditPartnerLedgerService');
const { createCurrencyQuote } = require('./oxsteedCreditCurrencyConversionService');
const { verifyStepupChallenge } = require('./stepupChallengeService');
const {
  activateParticipantInTransaction,
  activatePartnerWithGuards,
} = require('./oxsteedCreditParticipantService');
// Review P2-1-F07: dispute provisional credit and compensated resolutions
// bypassed maker-checker. They now execute as pending-action types below.
const {
  issueProvisionalCredit,
  resolveDisputeWithCompensation,
} = require('./oxsteedCreditDisputeService');
// ADM-019/ADM-114: re-evaluate the fiat compliance choke point at checker
// execution time for funding actions; the maker-time pass can be up to 24h
// stale by the time money moves.
const { evaluateFundingCompliance } = require('./fiatComplianceService');

const PENDING_ACTION_TTL_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_PENDING_ACTION_TTL_HOURS || '24', 10) || 24
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

// ADM-115: key-order-insensitive payload comparison for idempotency-key
// conflict detection. The stored payload carries the injected
// idempotencyKey; stripStoredIdempotencyKey removes it before comparing.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = sortKeysDeep(value[k]);
      return acc;
    }, {});
  }
  return value;
}

function stripStoredIdempotencyKey(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload || {};
  const copy = { ...payload };
  delete copy.idempotencyKey;
  return copy;
}

function payloadsEqual(a, b) {
  return JSON.stringify(sortKeysDeep(a || {})) === JSON.stringify(sortKeysDeep(b || {}));
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
    case 'credit_dispute_provisional_credit':
      return parseAmount(payload.amountCents ?? payload.amount_cents);
    case 'credit_dispute_resolve':
      return parseAmount(payload.compensationCents ?? payload.compensation_cents ?? 0);
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
    case 'credit_restaurant_conversion_policy_update':
    default:
      return null;
  }
}

/**
 * Amount a checker's step-up challenge must have been issued for (auth
 * audit item 6). This is what the checker issue endpoint binds, so the
 * issue and verify figures agree by construction: the payload amount
 * when the stored payload carries one (the ADM-155 client figure), else
 * the settlement's net_cents, else the withdrawal row's amount. Returns
 * null when the action carries no resolvable money amount, in which
 * case the caller skips binding (legacy behavior). Deliberately
 * separate from resolveActionAmountCents (threshold routing): changing
 * that function's withdrawal case would change dual-approval routing,
 * which is out of scope here. A missing row resolves to null, never an
 * error: the executor below reports the missing row with its own error.
 * The queryable is the caller's transaction client when inside one, so
 * the binding reads the same snapshot the decision commits.
 */
async function resolveCheckerStepupAmountCents(queryable, action) {
  const payload = action.payload || {};
  const direct = parseAmount(payload.amountCents ?? payload.amount_cents);
  if (direct !== null && direct > 0) return direct;
  const compensation = parseAmount(payload.compensationCents ?? payload.compensation_cents);
  if (compensation !== null && compensation > 0) return compensation;
  // Currency-quote actions carry their amount under the conversion-specific
  // field. Keep checker challenge issuance and approval bound to the same
  // source amount as the pending-action audit/threshold resolver.
  const quoteSource = parseAmount(payload.sourceAmountMinorUnits ?? payload.source_amount_minor_units);
  if (quoteSource !== null && quoteSource > 0) return quoteSource;
  const settlementId = payload.settlementId || payload.settlement_id;
  if (settlementId) {
    const { rows } = await queryable.query(
      'SELECT net_cents FROM oxsteed_credit_settlements WHERE id = $1',
      [settlementId]
    );
    const net = rows[0] ? parseAmount(rows[0].net_cents) : null;
    if (net !== null && net > 0) return net;
  }
  const withdrawalId = payload.withdrawalId || payload.withdrawal_id;
  if (withdrawalId) {
    const { rows } = await queryable.query(
      'SELECT amount_cents FROM oxsteed_credit_withdrawals WHERE id = $1',
      [withdrawalId]
    );
    const amount = rows[0] ? parseAmount(rows[0].amount_cents) : null;
    if (amount !== null && amount > 0) return amount;
  }
  return null;
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
  // Restaurant conversion allowlist: a per-restaurant toggle enabling the
  // from_restaurant direction. Amount-less, so it always needs a checker,
  // like fee schedule and reserve policy updates.
  credit_restaurant_conversion_policy_update: async ({ client, payload, actorUserId, requestIp, correlationId }) => {
    const policy = await upsertRestaurantConversionPolicy(client, {
      restaurantId: payload.restaurantId ?? payload.restaurant_id,
      allowRestaurantToOxsteed: payload.allowRestaurantToOxsteed ?? payload.allow_restaurant_to_oxsteed,
      updatedByUserId: actorUserId,
    });
    await insertAudit(client, {
      actionType: 'credit.restaurant_conversion_policy.updated',
      actorUserId,
      resourceType: 'restaurant_conversion_policy',
      resourceId: String(policy.restaurantId),
      reason: payload.reason || 'Restaurant conversion policy updated',
      correlationId: correlationId || null,
      requestIp: requestIp || null,
      metadata: {
        approvedBy: actorUserId,
        restaurantId: policy.restaurantId,
        allowRestaurantToOxsteed: policy.allowRestaurantToOxsteed,
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
  // Credit Everywhere Phase 1 (LOCKED): partner/participant activation is
  // amount-less, so it always requires dual approval — the threshold
  // bypass in requestPendingAction never applies (resolveActionAmountCents
  // returns null for these types). The executor runs inside the checker's
  // decision transaction; the Didit gate is enforced here at execution
  // time so a verification lapse between request and approval still
  // blocks activation.
  credit_partner_activation: async ({ payload, actorUserId, requestIp, correlationId }) =>
    activatePartnerWithGuards({
      partnerId: payload.partnerId,
      expectedStatus: payload.expectedStatus || 'pending',
      reason: payload.reason,
      actorUserId,
      requestIp,
      correlationId,
    }),
  credit_participant_activation: async ({ client, payload, actorUserId, requestIp, correlationId }) =>
    activateParticipantInTransaction(client, {
      participantId: payload.participantId,
      actorUserId,
      reason: payload.reason,
      requestIp,
      correlationId,
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
  // Review P2-1-F07: dispute provisional credit and compensated resolutions
  // move money, so they execute only as the checker half of maker-checker.
  // The executor runs inside the checker's decision transaction with the
  // checker's identity; the original Idempotency-Key is carried so a crash
  // between execution and the decision commit replays safely.
  credit_dispute_provisional_credit: async ({ payload, actorUserId, requestIp, correlationId }) =>
    issueProvisionalCredit({
      disputeId: payload.disputeId,
      adminId: actorUserId,
      amountCents: payload.amountCents,
      reason: payload.reason,
      requestIp,
      correlationId,
    }),
  credit_dispute_resolve: async ({ payload, actorUserId, requestIp, correlationId }) =>
    resolveDisputeWithCompensation({
      disputeId: payload.disputeId,
      adminId: actorUserId,
      decision: payload.decision,
      reason: payload.reason,
      compensationCents: payload.compensationCents ?? 0,
      requestIp,
      correlationId,
    }),
};

const ACTION_TYPES = Object.freeze(Object.keys(ACTION_EXECUTORS));

/**
 * Licence-readiness OVERSIGHT actions (safeguarding balance entries, limit
 * rule changes, SAR filing, held cash-out release, sanctions list
 * activation, escheat runs, wind-down, access-review sign-off, ...).
 *
 * They share the maker-checker table and its rules with two differences:
 *  - they keep working while the Credit rail kill switch is off, because
 *    reconciliation, AML and wind-down must continue when money movement
 *    is stopped (readiness review bug 4), and
 *  - the single-super-admin break-glass NEVER applies: two distinct
 *    administrators are always required.
 * Modules register their executors at load time; each executor runs inside
 * the decision transaction with { client, payload, actorUserId, requestedBy }.
 */
const OVERSIGHT_EXECUTORS = new Map();

function registerOversightAction(actionType, executor) {
  const type = normalizeText(actionType, 60);
  if (!type || typeof executor !== 'function') throw new Error('Oversight action needs a type and an executor');
  if (ACTION_EXECUTORS[type]) throw new Error(`Oversight action ${type} collides with a money action`);
  OVERSIGHT_EXECUTORS.set(type, executor);
}

function isOversightAction(actionType) {
  ensureOversightLoaded();
  return OVERSIGHT_EXECUTORS.has(actionType);
}

function listOversightActionTypes() {
  ensureOversightLoaded();
  return [...OVERSIGHT_EXECUTORS.keys()].sort();
}

function loadOversightModules() {
  // Lazy so the registry does not create require cycles at boot.
  for (const mod of [
    './creditCompliance/limitRules',
    './creditCashoutService',
    './creditCompliance/oversightActions',
  ]) {
    try {
      const loaded = require(mod);
      if (loaded && typeof loaded.registerOversightActions === 'function') loaded.registerOversightActions(registerOversightAction);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes(mod.split('/').pop())) throw error;
    }
  }
}
let oversightLoaded = false;
function ensureOversightLoaded() {
  if (!oversightLoaded) {
    oversightLoaded = true;
    loadOversightModules();
  }
}

/**
 * Request a pending action (the maker half). Fails closed when the rail is
 * disabled. Every money movement queues for a distinct checker to decide;
 * there is no amount or environment bypass for maker-checker. The caller's
 * Idempotency-Key makes replays return the existing receipt.
 */
async function requestPendingAction({ actionType, payload, requestedBy, idempotencyKey, requestIp, correlationId }) {
  ensureOversightLoaded();
  const normalizedType = normalizeText(actionType, 60);
  if (!OVERSIGHT_EXECUTORS.has(normalizedType)) await assertCreditRailEnabled(pool);
  if (!ACTION_EXECUTORS[normalizedType] && !OVERSIGHT_EXECUTORS.has(normalizedType)) {
    throw new AppError('Unsupported pending action type', 400, 'credit_pending_action_type_invalid');
  }
  if (!requestedBy) throw new AppError('A requesting administrator is required', 403, 'credit_pending_action_actor_required');
  const key = normalizeText(idempotencyKey, 200);
  if (!key) throw new AppError('An Idempotency-Key is required to request a pending action', 400, 'credit_pending_action_idempotency_required');

  // Finding 38: a settlement can have only one undecided payout pending
  // action. The UI clears its idempotency key after each queue, so key
  // dedupe alone cannot stop a double-queue; reject the duplicate here
  // (and in the route, before step-up) instead of queuing a second
  // checker approval that can only 409 at execution.
  if (normalizedType === 'credit_settlement_payout' && payload?.settlementId) {
    const { rows: existingPending } = await pool.query(
      `SELECT id FROM oxsteed_credit_pending_actions
        WHERE action_type = 'credit_settlement_payout' AND status = 'pending'
          AND payload->>'settlementId' = $1
        LIMIT 1`,
      [String(payload.settlementId)]
    );
    if (existingPending[0]) {
      throw new AppError('A settlement payout is already queued for this settlement', 409, 'credit_settlement_payout_already_queued');
    }
  }
  const storedPayload = { ...(payload || {}), idempotencyKey: key };
  // Oversight executors may expose validate(payload) so a malformed request
  // is refused at maker time instead of waiting for the checker.
  const oversightExecutor = OVERSIGHT_EXECUTORS.get(normalizedType);
  if (oversightExecutor && typeof oversightExecutor.validate === 'function') oversightExecutor.validate(storedPayload);
  // The amount is recorded in the audit trail for traceability. There is no
  // threshold bypass: every money movement requires a distinct checker.
  const amountCents = await resolveActionAmountCents(normalizedType, storedPayload);
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
      const row = rows[0];
      if (!row) {
        // Nov 3 audit item 7: the remaining 23505 source for this insert
        // is the pending settlement-payout partial unique index (a second
        // maker won the race past the SELECT pre-check). Report it as
        // the same friendly 409 the pre-check returns, not a raw 500.
        if (normalizedType === 'credit_settlement_payout' && payload?.settlementId) {
          const { rows: dupRows } = await pool.query(
            `SELECT id FROM oxsteed_credit_pending_actions
              WHERE action_type = 'credit_settlement_payout' AND status = 'pending'
                AND payload->>'settlementId' = $1
              LIMIT 1`,
            [String(payload.settlementId)]
          );
          if (dupRows[0]) {
            throw new AppError('A settlement payout is already queued for this settlement', 409, 'credit_settlement_payout_already_queued');
          }
        }
        throw error;
      }
      // ADM-115: a key reuse with a different action type or payload is a
      // conflict, not a replay. The idempotency key is globally unique, so
      // silently returning another intent's receipt would misattribute money
      // movement. Fail closed.
      if (row.action_type !== normalizedType || !payloadsEqual(stripStoredIdempotencyKey(row.payload), payload || {})) {
        throw new AppError(
          'This idempotency key was already used for a different pending action',
          409,
          'credit_pending_action_idempotency_conflict'
        );
      }
      const existing = formatPendingAction(row);
      // ADM-081/ADM-116: a replayed terminal (approved/rejected/expired) row
      // is flagged so senders return 409 instead of 200: the client must not
      // misread a dead intent as a fresh receipt.
      if (row.status !== 'pending') {
        return { executed: false, pendingAction: existing, result: null, replayed: true, terminalReplay: true };
      }
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
async function decidePendingAction(params) {
  await assertCreditRailEnabled(pool);
  return decidePendingActionCore(params, { oversightOnly: false });
}

/**
 * Checker half for oversight actions: no rail gate (they must work while
 * the kill switch is off) and no break-glass self-approval.
 */
async function decideOversightAction(params) {
  ensureOversightLoaded();
  return decidePendingActionCore(params, { oversightOnly: true });
}

async function decidePendingActionCore({ actionId, decidedBy, decision, reason, stepupChallengeId, stepupCode, requestIp, correlationId }, { oversightOnly }) {
  ensureOversightLoaded();
  // ADM-080: fail closed on unrecognized decisions. The old code defaulted
  // anything that was not an explicit rejection spelling to 'approved', so a
  // typo or malformed client value approved a money movement.
  const decisionText = String(decision || '').trim().toLowerCase();
  let normalizedDecision;
  if (decisionText === 'approved' || decisionText === 'approve') {
    normalizedDecision = 'approved';
  } else if (decisionText === 'rejected' || decisionText === 'reject') {
    normalizedDecision = 'rejected';
  } else {
    throw new AppError('Decision must be "approved" or "rejected"', 400, 'credit_decision_invalid');
  }
  if (!decidedBy) throw new AppError('A deciding administrator is required', 403, 'credit_pending_action_actor_required');
  const normalizedReason = normalizeText(reason, 2000);

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE`,
      [actionId]
    );
    const action = rows[0];
    if (!action) throw new AppError('Pending action was not found', 404, 'credit_pending_action_not_found');

    if (oversightOnly && !OVERSIGHT_EXECUTORS.has(action.action_type)) {
      throw new AppError('This endpoint only decides oversight actions', 400, 'credit_pending_action_type_invalid');
    }
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
      // Maker-checker is absolute (security review F-06): every Credit
      // approval, settlement and oversight decision needs a second, distinct
      // administrator. The former single-super-admin break-glass is retired
      // (migration 20261110104200); no flag, env or admin count re-opens it.
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
    // Auth audit item 6: bind it to the action's amount when resolvable
    // (same resolver the checker issue endpoint uses); actions without a
    // resolvable amount keep the legacy unbound challenge.
    const checkerExpectedAmount = await resolveCheckerStepupAmountCents(client, action);
    await verifyStepupChallenge({
      challengeId: stepupChallengeId,
      actorUserId: decidedBy,
      actionType: 'pending_action_approve',
      code: stepupCode,
      ...(checkerExpectedAmount !== null ? { expectedAmountCents: checkerExpectedAmount } : {}),
    });

    const executor = ACTION_EXECUTORS[action.action_type] || OVERSIGHT_EXECUTORS.get(action.action_type);
    if (!executor) throw new AppError('Unsupported pending action type', 400, 'credit_pending_action_type_invalid');
    const storedPayload = { ...(action.payload || {}), idempotencyKey: action.idempotency_key };
    // ADM-019/ADM-114 + P3-10-F01 (auth audit item 2): the compliance choke
    // point ran at maker time, up to 24h before this approval. Re-evaluate
    // now, at the moment money moves, so a sanctions hit or identity-tier
    // change in between fails closed instead of executing on a stale pass.
    // credit_adjustment is re-evaluated exactly like credit_load: admin
    // adjustments move real customer balances in both directions.
    if (action.action_type === 'credit_load' || action.action_type === 'credit_adjustment') {
      await evaluateFundingCompliance({
        customerId: storedPayload.customerId,
        amountCents: storedPayload.amountCents,
        currencyCode: storedPayload.currencyCode,
        fundingMethod: action.action_type === 'credit_load' ? 'admin_load' : 'admin_adjustment',
        actorUserId: decidedBy,
        requestIp: requestIp || null,
        correlationId: correlationId || null,
      });
    }
    // Item 43: refunds are re-evaluated at checker time too, with sanctions
    // + identity-tier checks only. The stored refund payload carries no
    // customerId, so a naive gate would 400 every queued refund; resolve
    // the customer + currency from the original purchase instead, with the
    // same join refundCreditInTransaction uses (read-only here; the
    // executor re-resolves under lock). No issuance-capacity check: a
    // refund reduces outstanding credit, so that check would deny refunds
    // for customers near a cap.
    if (action.action_type === 'credit_refund') {
      const { rows: purchaseRows } = await client.query(
        `SELECT ca.customer_id, t.currency_code
           FROM oxsteed_credit_transactions t
           JOIN oxsteed_credit_accounts ca ON ca.id = t.debit_account_id
          WHERE t.id = $1 AND t.transaction_type = 'purchase' AND t.status = 'posted'`,
        [storedPayload.purchaseTransactionId]
      );
      const purchase = purchaseRows[0];
      if (!purchase) throw new AppError('Original credit purchase not found', 404, 'credit_purchase_not_found');
      await evaluateFundingCompliance({
        customerId: purchase.customer_id,
        amountCents: storedPayload.amountCents,
        currencyCode: purchase.currency_code,
        fundingMethod: 'admin_refund',
        actorUserId: decidedBy,
        requestIp: requestIp || null,
        correlationId: correlationId || null,
        skipIssuanceCapacity: true,
      });
    }
    const executionResult = await executor({
      client,
      payload: storedPayload,
      requestedBy: action.requested_by,
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

/** Review P1-253: expire undecided actions past their deadline. */
async function expireStalePendingActions() {
  const { rows } = await pool.query(
    `UPDATE oxsteed_credit_pending_actions
        SET status = 'expired', decided_at = NOW()
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
      RETURNING id, action_type`
  );
  for (const row of rows) {
    await insertAudit(pool, {
      actionType: 'credit.pending_action.expired',
      actorUserId: null,
      resourceType: 'pending_action',
      resourceId: String(row.id),
      reason: 'Pending action expired before a decision (sweeper)',
      metadata: { actionType: row.action_type },
    }).catch(() => {});
  }
  return { expired: rows.length };
}

async function listPendingActions({ status = null, limit = 50, offset = 0, actionTypes = null } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(actionTypes) && actionTypes.length) {
    params.push(actionTypes);
    where.push(`action_type = ANY($${params.length}::text[])`);
  }
  if (status && PENDING_ACTION_STATUSES.includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
    // Review P1-253: past-deadline rows are not decidable; don't list them as pending.
    if (status === 'pending') where.push('(expires_at IS NULL OR expires_at >= NOW())');
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
  requestPendingAction,
  decidePendingAction,
  decideOversightAction,
  registerOversightAction,
  isOversightAction,
  listOversightActionTypes,
  getPendingAction,
  listPendingActions,
  expireStalePendingActions,
  resolveActionAmountCents,
  resolveCheckerStepupAmountCents,
};
