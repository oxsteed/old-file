'use strict';

/**
 * G1-B1 (D-718): real Credit holds for planned-needs funding.
 *
 * When a customer funds a planned expense goal, the money is actually held:
 * the customer's wallet `reserved_cents` grows by the funded amount, so the
 * held sum is no longer spendable anywhere else, and a row in
 * `oxsteed_credit_reservations` records the hold for release and audit.
 *
 * Why a reservation, not a row in `oxsteed_credit_holds`: the holds table
 * requires a partner_id and an agreement_id (both NOT NULL), and a planned
 * need has no payee at funding time (no helper hired, no job published
 * yet), so there is no participant to resolve. Inventing a platform
 * counterparty would fabricate a payee. The reservations table (migration
 * 640, Phase 7 gap 11) is the designed mechanism for exactly this: a
 * reservation on the customer's own account with no counterparty, and the
 * migration-755 consistency guard proves
 *   reserved_cents = SUM(active holds) + SUM(active reservations)
 * per wallet at every commit, so a hold recorded here cannot drift from
 * the balance. The service reuses `oxsteedCreditReservationService`
 * (`reserveFunds` / `releaseReservation`) rather than reimplementing the
 * lock, the available-balance check, and the guarded bump.
 *
 * One reservation per fund call, not per need: the reservations table
 * carries one live row per (reference_type, reference_id), and a need is
 * funded repeatedly, so the reference is the fund's own key
 * (`planned-need-fund:<needId>:<clientRequestId>` for keyed funds, a
 * generated UUID suffix for unkeyed ones). The endpoint-level idempotency
 * already replays a retried fund before this code runs; the reservation
 * reference makes the hold itself replay-safe too.
 *
 * Rail bypass, scoped narrowly to this hold path (Emile's call, D-717:
 * "Hold runs now, clearance aside", 2026-11-27 ~13:50 EST):
 * - This path NEVER consults FEATURE_RAIL_CREDIT, FEATURE_PAYMENT_RAILS,
 *   or credit_payment_legal_cleared: it performs no paymentRailPolicy
 *   lookup and never routes through paymentRails/creditRail. The bypass is
 *   by construction, not a flag flip, and no flag, default, or gate changes
 *   anywhere else. G4-1/G4-2 stay open and unchanged.
 * - The rail's own enable flag (`oxsteed_credit_enabled`, migration 422:
 *   "Keep the rail disabled until legal/compliance review") is likewise NOT
 *   consulted here: the canonical hold path's `assertCreditRailEnabled`
 *   would refuse while that flag is off, which is exactly what "hold runs
 *   now" overrides for this path only.
 * - The operator freeze IS honored: `assertCreditRailNotFrozen` runs before
 *   any hold. A freeze is an incident control, not a clearance gate, so it
 *   still refuses with 503 `credit_rail_frozen` while one is open.
 *
 * Fail closed: insufficient balance, a suspended/closed wallet, an
 * unsupported currency, a frozen rail, or any service error refuses with a
 * clear AppError and the caller rolls the whole fund transaction back, so a
 * failed hold never leaves a reservation behind. No silent fallback.
 */

const { randomUUID } = require('node:crypto');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  assertSupportedCreditCurrency,
  assertCreditRailNotFrozen,
  assertCustomerSpendCapacity,
  ensureAccount,
} = require('./oxsteedCreditService');
const {
  reserveFunds,
  releaseReservation,
} = require('./oxsteedCreditReservationService');

const RESERVATION_TYPE = 'planned_need_fund';
const REFERENCE_TYPE = 'planned_need_fund';

function referenceIdFor(needId, key) {
  return `planned-need-fund:${needId}:${key}`;
}

function formatHold({ reservation, needId, customerId, currencyCode }) {
  return {
    id: String(reservation.id),
    plannedNeedId: Number(needId),
    customerId: String(customerId),
    accountId: Number(reservation.accountId),
    amountCents: Number(reservation.amountCents),
    currencyCode,
    status: reservation.status,
    referenceId: reservation.referenceId,
    releasedAt: reservation.releasedAt || null,
    releasedReason: reservation.releasedReason || null,
    createdAt: reservation.createdAt || null,
  };
}

async function writeAuditEvent(client, { actionType, actorUserId, customerId, reservation, needId, currencyCode, reason }) {
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason, correlation_id, request_ip, after_state)
     VALUES ($1, $2, $3, NULL, 'credit_reservation', $4, $5, $6, NULL, $7::jsonb)`,
    [
      actionType,
      actorUserId || null,
      customerId,
      String(reservation.id),
      reason,
      reservation.referenceId,
      JSON.stringify({
        amountCents: Number(reservation.amountCents),
        currencyCode,
        plannedNeedId: Number(needId),
        reservationType: RESERVATION_TYPE,
      }),
    ]
  );
}

/**
 * Place a need-scoped hold inside the caller's transaction (the fund
 * endpoint's transaction). The caller owns BEGIN/COMMIT/ROLLBACK, so a hold
 * failure rolls the reservation increment back with it.
 */
async function placePlannedNeedCreditHold(client, {
  needId,
  customerId,
  amountCents,
  currencyCode,
  idempotencyKey,
  actorUserId = null,
}) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Hold amount must be a positive whole number of cents.', 400, 'validation_failed');
  }
  const currency = assertSupportedCreditCurrency(currencyCode);
  const key = idempotencyKey || `planned-need-hold:${needId}:${randomUUID()}`;
  const referenceId = referenceIdFor(needId, key);

  // Incident control, not a clearance gate: still honored (D-718).
  await assertCreditRailNotFrozen(client);
  // Daily velocity envelope, same as the canonical hold path.
  await assertCustomerSpendCapacity(client, { customerId, amountCents: amount, currencyCode: currency });

  // ensureAccount locks the wallet row FOR UPDATE.
  const account = await ensureAccount(client, {
    accountType: 'customer_wallet',
    customerId,
    currencyCode: currency,
  });
  if (account.status !== 'active') {
    throw new AppError('OxSteed Credit is not available on this account right now.', 409, 'credit_account_not_active');
  }

  const { reservation, replayed } = await reserveFunds(client, {
    accountId: account.id,
    reservationType: RESERVATION_TYPE,
    referenceType: REFERENCE_TYPE,
    referenceId,
    amountCents: amount,
  });
  if (!replayed) {
    await writeAuditEvent(client, {
      actionType: 'credit.planned_need_hold.created',
      actorUserId,
      customerId,
      reservation,
      needId,
      currencyCode: currency,
      reason: 'Planned need funded',
    });
  }
  return { hold: formatHold({ reservation, needId, customerId, currencyCode: currency }), replayed };
}

/**
 * Release every active hold on a need, returning the money to the spendable
 * balance. Idempotent: only `active` rows are touched, so a second call
 * releases nothing. Runs inside the caller's transaction.
 */
async function releasePlannedNeedCreditHolds(client, { needId, reason, actorUserId = null }) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_reservations
      WHERE reference_type = $1 AND reference_id LIKE $2 AND status = 'active'
      ORDER BY created_at ASC FOR UPDATE`,
    [REFERENCE_TYPE, `planned-need-fund:${needId}:%`]
  );
  const released = [];
  for (const row of rows) {
    const { released: didRelease, reservation } = await releaseReservation(client, { reservationId: row.id, reason });
    if (!didRelease || !reservation) continue;
    // The reservation carries no customer or currency; resolve both from
    // the account it reserves against.
    const { rows: accountRows } = await client.query(
      'SELECT customer_id, currency_code FROM oxsteed_credit_accounts WHERE id = $1',
      [row.account_id]
    );
    await writeAuditEvent(client, {
      actionType: 'credit.planned_need_hold.released',
      actorUserId,
      customerId: accountRows[0]?.customer_id || null,
      reservation,
      needId,
      currencyCode: accountRows[0]?.currency_code || 'USD',
      reason: reason || 'Planned-need hold released',
    });
    released.push(String(row.id));
  }
  if (released.length) {
    logger.info('planned_need_credit_hold.released', { needId: Number(needId), released: released.length, reason });
  }
  return { released };
}

/**
 * Release the holds on every need that published this job. Called from the
 * hire path: the job's own payment/collateral hold supersedes the
 * planned-need hold, so the earmark must not stay held alongside it.
 */
async function releasePlannedNeedCreditHoldsForJob(client, { jobId, reason, actorUserId = null }) {
  const { rows } = await client.query(
    'SELECT id FROM planned_needs WHERE published_job_id = $1',
    [jobId]
  );
  const released = [];
  for (const row of rows) {
    const result = await releasePlannedNeedCreditHolds(client, { needId: row.id, reason, actorUserId });
    released.push(...result.released);
  }
  return { released };
}

module.exports = {
  placePlannedNeedCreditHold,
  releasePlannedNeedCreditHolds,
  releasePlannedNeedCreditHoldsForJob,
  RESERVATION_TYPE,
  REFERENCE_TYPE,
  referenceIdFor,
  formatHold,
};
