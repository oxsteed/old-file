'use strict';

/**
 * OxSteed Credit customer withdrawals (fiat money OUT).
 *
 * The mirror of the top-up flow (oxsteedCreditTopupService.js), in reverse:
 * a customer requests a withdrawal to their bank via Stripe; an admin
 * approves; the Stripe transfer is created and the `cash_out` lock leg is
 * posted atomically (customer_wallet -> platform_treasury) so the balance
 * cannot be double-spent while the payout is in flight; the withdrawal is
 * marked `paid` only on webhook confirmation of the Stripe transfer.
 *
 * Lifecycle: requested -> approved -> processing -> paid | failed
 *            requested -> rejected | cancelled
 *            processing -> requires_attention (Stripe moved money but the
 *              lock journal post failed; critical incident, Stripe retry)
 *
 * Compliance (Phase 5) on every money step: rail kill switch, identity
 * verification tier (tier 0 cannot withdraw), sanctions screening of the
 * customer, and a fresh step-up challenge for large withdrawals. The admin
 * approval is single-admin for now; maker-checker (dual approval) is a
 * later phase and is noted where the approval happens.
 *
 * Fees (Phase 6, gap 12): the fee is quoted at request time, stored on the
 * row, and the posted fee leg equals the quote exactly. The customer
 * receives amount - fee.
 */

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  MAX_TRANSACTION_CENTS,
  assertSupportedCreditCurrency,
  assertCreditRailEnabled,
  ensureAccount,
  postJournalTransaction,
} = require('./oxsteedCreditService');
const { assertIdentityVerificationTier } = require('./identityVerificationService');
const { quoteFee } = require('./oxsteedCreditFeeScheduleService');
const { recordIncident } = require('./incidentStore');
const { insertAudit } = require('./oxsteedCreditAdminService');

const MIN_WITHDRAWAL_CENTS = Number.parseInt(process.env.OXSTEED_CREDIT_WITHDRAWAL_MIN_CENTS || '500', 10);
const DAILY_WITHDRAWAL_CAP_CENTS = Number.parseInt(process.env.OXSTEED_CREDIT_WITHDRAWAL_DAILY_CAP_CENTS || '250000', 10);
const STRIPE_TRANSFER_IDEMPOTENCY_PREFIX = 'credit-withdrawal-payout:';
const JOURNAL_IDEMPOTENCY_PREFIX = 'credit-withdrawal:';
const WITHDRAWAL_REQUEST_EXPIRY_HOURS = 72;

function fail(message, code, status = 400) {
  throw new AppError(message, status, code);
}

function requireAdministrativeActor(actorUserId) {
  if (!actorUserId) {
    throw new AppError('An identified administrator is required for this Credit change', 401, 'credit_admin_actor_required');
  }
}

function normalizeIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim().slice(0, 160) : '';
  if (!key) {
    fail('Idempotency-Key is required for credit withdrawals', 'credit_withdrawal_idempotency_key_required');
  }
  return key;
}

function validateWithdrawalAmount(amountCents) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('Withdrawal amount must be a positive integer number of cents', 'credit_withdrawal_amount_invalid');
  }
  if (amount < MIN_WITHDRAWAL_CENTS) {
    fail('Withdrawal amount is below the minimum', 'credit_withdrawal_amount_too_small', 402);
  }
  if (amount > MAX_TRANSACTION_CENTS) {
    fail('Withdrawal amount exceeds the maximum transaction size', 'credit_withdrawal_amount_too_large', 402);
  }
  return amount;
}

// Null-guarded lazy Stripe client: never construct with an undefined key.
function defaultGetStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new AppError('Stripe is not configured for credit withdrawals', 503, 'credit_stripe_unavailable');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function resolveCustomerDestination(client, customerId) {
  const { rows } = await client.query(
    `SELECT stripe_account_id
       FROM connect_accounts
      WHERE user_id = $1
        AND payouts_enabled = TRUE
        AND stripe_account_id IS NOT NULL
      LIMIT 1`,
    [customerId]
  );
  return rows[0]?.stripe_account_id || null;
}

async function assertDailyWithdrawalCapacity(client, { customerId, amountCents, currencyCode }) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0) AS day_total
       FROM oxsteed_credit_withdrawals
      WHERE customer_id = $1
        AND currency_code = $2
        AND status IN ('requested', 'approved', 'processing', 'paid', 'requires_attention')
        AND created_at >= date_trunc('day', NOW())`,
    [customerId, currencyCode]
  );
  const dayTotal = Number(rows[0]?.day_total || 0);
  if (dayTotal + Number(amountCents) > DAILY_WITHDRAWAL_CAP_CENTS) {
    fail('Daily withdrawal limit exceeded', 'credit_withdrawal_daily_cap_exceeded', 429);
  }
}

function formatWithdrawal(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    amountCents: Number(row.amount_cents),
    feeCents: Number(row.fee_cents),
    netCents: Number(row.net_cents),
    currencyCode: row.currency_code,
    status: row.status,
    stripeTransferId: row.stripe_transfer_id || null,
    destinationAccountRef: row.destination_account_ref || null,
    journalTransactionId: row.journal_transaction_id || null,
    journalFeeTransactionId: row.journal_fee_transaction_id || null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at || null,
    reviewReason: row.review_reason || null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getWithdrawalById(withdrawalId) {
  const { rows } = await pool.query(`SELECT * FROM oxsteed_credit_withdrawals WHERE id = $1`, [withdrawalId]);
  return rows[0] || null;
}

async function getCustomerWithdrawal({ customerId, withdrawalId }) {
  if (!customerId || !withdrawalId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM oxsteed_credit_withdrawals WHERE id = $1 AND customer_id = $2`,
    [withdrawalId, customerId]
  );
  return rows[0] || null;
}

/**
 * Customer requests a withdrawal. No money moves here: the row is parked as
 * `requested` after compliance, fee quote, destination, and daily-cap
 * checks. An admin approves (and initiates the Stripe transfer) separately.
 */
async function requestWithdrawal({ customerId, amountCents, currencyCode, idempotencyKey }) {
  if (!customerId) fail('Customer is required for a credit withdrawal', 'credit_withdrawal_customer_required');
  const amount = validateWithdrawalAmount(amountCents);
  const currency = assertSupportedCreditCurrency(currencyCode);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);

  const { row: insertedOrExisting, created } = await withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client);

    // Compliance: tier 0 cannot withdraw; sanctions screening fails closed.
    // (Lazy require to avoid a require cycle with insertAudit.)
    const { assertSanctionsClear } = require('./sanctionsScreeningService');
    await assertIdentityVerificationTier(client, { customerId, amountCents: amount, fundingMethod: 'credit_withdrawal' });
    await assertSanctionsClear(client, {
      subjectType: 'customer',
      subjectId: customerId,
      context: { operation: 'credit_withdrawal' },
    });

    const destination = await resolveCustomerDestination(client, customerId);
    if (!destination) {
      fail('No verified payout destination is on file for this customer', 'credit_withdrawal_no_connected_account', 409);
    }

    await assertDailyWithdrawalCapacity(client, { customerId, amountCents: amount, currencyCode: currency });

    // Fee quote BEFORE the persistent side effect; the quote is stored and
    // the posted fee leg must equal it exactly (no hidden fees).
    const { feeCents } = await quoteFee({ operationType: 'withdrawal', currencyCode: currency, amountCents: amount }, client);
    if (feeCents >= amount) {
      fail('Withdrawal amount does not cover the fee', 'credit_withdrawal_fee_exceeds_amount', 402);
    }
    const netCents = amount - feeCents;

    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_withdrawals
         (customer_id, amount_cents, fee_cents, net_cents, currency_code, status,
          destination_account_ref, idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7, NOW() + ($8 || ' hours')::interval)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [customerId, amount, feeCents, netCents, currency, destination, normalizedKey, String(WITHDRAWAL_REQUEST_EXPIRY_HOURS)]
    );
    if (rows[0]) return { row: rows[0], created: true };
    const { rows: existingRows } = await client.query(
      `SELECT * FROM oxsteed_credit_withdrawals WHERE idempotency_key = $1`,
      [normalizedKey]
    );
    return { row: existingRows[0] || null, created: false };
  }, 'credit_withdrawal_request');

  if (!insertedOrExisting) {
    fail('Credit withdrawal could not be created', 'credit_withdrawal_create_failed', 500);
  }
  const withdrawal = insertedOrExisting;

  // Fingerprint check: a reused idempotency key must carry identical semantics.
  if (Number(withdrawal.amount_cents) !== amount || String(withdrawal.currency_code) !== currency) {
    fail('Credit withdrawal idempotency key was already used with different parameters', 'credit_withdrawal_idempotency_conflict', 409);
  }

  // Best-effort audit: the withdrawal row is already committed; an audit
  // write failure must never mask the created withdrawal.
  try {
    await insertAudit(pool, {
      actionType: 'credit.withdrawal.requested',
      actorUserId: customerId,
      customerId,
      resourceType: 'credit_withdrawal',
      resourceId: String(withdrawal.id),
      reason: 'Customer withdrawal request',
      afterState: { status: withdrawal.status, amountCents: amount, feeCents: Number(withdrawal.fee_cents) },
    });
  } catch (auditErr) {
    logger.error('[oxsteed-credit] Failed to audit withdrawal request', {
      withdrawalId: String(withdrawal.id),
      error: auditErr.message,
    });
  }

  return { withdrawal: formatWithdrawal(withdrawal), replayed: !created };
}

/**
 * Admin approves a requested withdrawal and initiates the Stripe transfer in
 * the same transaction: Stripe transfer created first, then the `cash_out`
 * lock leg (customer_wallet -> platform_treasury) plus the `withdrawal_fee`
 * leg (customer_wallet -> platform_revenue) are posted. If Stripe succeeds
 * but the journal fails, the row parks as requires_attention with a critical
 * incident (mirror of the top-up path).
 *
 * NOTE (maker-checker): this is a single-admin approval. Dual approval on
 * money-out is a later phase; the reviewer is recorded on the row and in
 * the audit trail.
 */
async function approveWithdrawal({ withdrawalId, actorUserId, idempotencyKey, requestIp, correlationId, getStripe = defaultGetStripe }) {
  requireAdministrativeActor(actorUserId);
  const normalizedKey = normalizeIdempotencyKey(idempotencyKey);

  let journalError = null;
  const result = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );
    const withdrawal = rows[0];
    if (!withdrawal) fail('Credit withdrawal not found', 'credit_withdrawal_not_found', 404);
    if (withdrawal.status !== 'requested') {
      fail(`Withdrawal cannot be approved from status ${withdrawal.status}`, 'credit_withdrawal_state_conflict', 409);
    }
    if (new Date(withdrawal.expires_at).getTime() < Date.now()) {
      await client.query(
        `UPDATE oxsteed_credit_withdrawals SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [withdrawal.id]
      );
      fail('Withdrawal request has expired', 'credit_withdrawal_expired', 409);
    }

    // Full rail gate (no freeze bypass): this initiates NEW money movement.
    await assertCreditRailEnabled(client);

    // Re-verify compliance in-transaction: time has passed since the request.
    const { assertSanctionsClear } = require('./sanctionsScreeningService');
    await assertIdentityVerificationTier(client, {
      customerId: withdrawal.customer_id,
      amountCents: Number(withdrawal.amount_cents),
      fundingMethod: 'credit_withdrawal',
    });
    await assertSanctionsClear(client, {
      subjectType: 'customer',
      subjectId: withdrawal.customer_id,
      context: { operation: 'credit_withdrawal_approval', withdrawalId: String(withdrawal.id) },
    });

    const destination = await resolveCustomerDestination(client, withdrawal.customer_id);
    if (!destination) {
      fail('No verified payout destination is on file for this customer', 'credit_withdrawal_no_connected_account', 409);
    }

    const amount = Number(withdrawal.amount_cents);
    const feeCents = Number(withdrawal.fee_cents);
    const netCents = Number(withdrawal.net_cents);
    const currency = assertSupportedCreditCurrency(withdrawal.currency_code);

    const wallet = await ensureAccount(client, {
      accountType: 'customer_wallet', customerId: withdrawal.customer_id, currencyCode: currency,
    });
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode: currency,
    });

    // External call first: on Stripe failure the DB transaction rolls back
    // and the withdrawal stays `requested` with no partial state.
    const stripe = getStripe();
    let transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: netCents,
          currency: currency.toLowerCase(),
          destination,
          metadata: { oxsteed_credit_withdrawal_id: String(withdrawal.id) },
        },
        { idempotencyKey: `${STRIPE_TRANSFER_IDEMPOTENCY_PREFIX}${withdrawal.id}` }
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('[oxsteed-credit] Stripe transfer creation failed for withdrawal', {
        withdrawalId: String(withdrawal.id),
        error: err.message,
      });
      throw new AppError('Stripe payout initiation failed', 502, 'credit_withdrawal_stripe_failed');
    }
    if (!transfer || !transfer.id) {
      throw new AppError('Stripe payout initiation failed', 502, 'credit_withdrawal_transfer_failed');
    }

    try {
      // Lock leg: value leaves the customer wallet now, so it cannot be
      // spent while the payout is in flight. cash_out is the mirror of load.
      const { transaction } = await postJournalTransaction(client, {
        transactionType: 'cash_out',
        debitAccountId: wallet.id,
        creditAccountId: treasury.id,
        customerId: withdrawal.customer_id,
        amountCents: netCents,
        currencyCode: currency,
        idempotencyKey: `${JOURNAL_IDEMPOTENCY_PREFIX}${withdrawal.id}`,
        actorType: 'admin',
        actorUserId,
        reason: 'Customer withdrawal payout',
        description: 'Customer withdrawal payout',
        referenceType: 'credit_withdrawal',
        referenceId: String(withdrawal.id),
        metadata: { source: 'credit_withdrawal', stripeTransferId: transfer.id },
        bindIdempotencySemantics: true,
        correlationId,
        requestIp,
      });

      // Fee leg: posted for exactly the quoted fee. No hidden fees.
      let feeTransactionId = null;
      if (feeCents > 0) {
        const revenue = await ensureAccount(client, {
          accountType: 'platform_revenue', currencyCode: currency,
        });
        const { transaction: feeTx } = await postJournalTransaction(client, {
          transactionType: 'withdrawal_fee',
          debitAccountId: wallet.id,
          creditAccountId: revenue.id,
          customerId: withdrawal.customer_id,
          amountCents: feeCents,
          currencyCode: currency,
          idempotencyKey: `${JOURNAL_IDEMPOTENCY_PREFIX}${withdrawal.id}:fee`,
          actorType: 'admin',
          actorUserId,
          reason: 'Customer withdrawal fee',
          description: 'Customer withdrawal fee',
          referenceType: 'credit_withdrawal_fee',
          referenceId: String(withdrawal.id),
          metadata: { source: 'credit_withdrawal', quotedFeeCents: feeCents },
          bindIdempotencySemantics: true,
          correlationId,
          requestIp,
        });
        feeTransactionId = feeTx.id;
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE oxsteed_credit_withdrawals
            SET status = 'processing',
                stripe_transfer_id = $2,
                destination_account_ref = $3,
                account_id = $4,
                journal_transaction_id = $5,
                journal_fee_transaction_id = $6,
                reviewed_by = $7,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND status = 'requested'
          RETURNING *`,
        [withdrawal.id, transfer.id, destination, wallet.id, transaction.id, feeTransactionId, actorUserId]
      );
      if (!updatedRows[0]) {
        fail('Withdrawal was already processed', 'credit_withdrawal_state_conflict', 409);
      }

      await insertAudit(client, {
        actionType: 'credit.withdrawal.approved',
        actorUserId,
        customerId: withdrawal.customer_id,
        resourceType: 'credit_withdrawal',
        resourceId: String(withdrawal.id),
        reason: 'Withdrawal approved and Stripe payout initiated',
        correlationId,
        requestIp,
        afterState: { status: 'processing', stripeTransferId: transfer.id, netCents, feeCents },
      });

      return { withdrawal: formatWithdrawal(updatedRows[0]), stripeTransferId: transfer.id };
    } catch (err) {
      // Stripe moved (or may have moved) money but the lock journal failed:
      // park for operator attention exactly like the top-up path.
      await client.query(
        `UPDATE oxsteed_credit_withdrawals
            SET status = 'requires_attention', stripe_transfer_id = $2, updated_at = NOW()
          WHERE id = $1`,
        [withdrawal.id, transfer.id]
      );
      journalError = err;
      return { withdrawal: null, requiresAttention: true, stripeTransferId: transfer.id };
    }
  }, 'credit_withdrawal_approve');

  if (result.requiresAttention && journalError) {
    try {
      await recordIncident({
        type: 'oxsteed_credit_withdrawal_unlocked',
        severity: 'critical',
        message: 'Stripe withdrawal payout initiated but the lock journal failed',
        dedupeKey: `credit-withdrawal-unlocked:${withdrawalId}`,
        details: { withdrawalId: String(withdrawalId), stripeTransferId: result.stripeTransferId, error: journalError.message },
      });
    } catch (incidentErr) {
      logger.error('[oxsteed-credit] Failed to record withdrawal unlocked incident', { error: incidentErr.message });
    }
    throw journalError;
  }
  return result;
}

async function rejectWithdrawal({ withdrawalId, actorUserId, reason, requestIp, correlationId }) {
  requireAdministrativeActor(actorUserId);
  const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  if (!normalizedReason) fail('A reason is required to reject a withdrawal', 'credit_withdrawal_reason_required');

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );
    const withdrawal = rows[0];
    if (!withdrawal) fail('Credit withdrawal not found', 'credit_withdrawal_not_found', 404);
    if (withdrawal.status !== 'requested') {
      fail(`Withdrawal cannot be rejected from status ${withdrawal.status}`, 'credit_withdrawal_state_conflict', 409);
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_withdrawals
          SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(),
              review_reason = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'requested'
        RETURNING *`,
      [withdrawal.id, actorUserId, normalizedReason]
    );
    await insertAudit(client, {
      actionType: 'credit.withdrawal.rejected',
      actorUserId,
      customerId: withdrawal.customer_id,
      resourceType: 'credit_withdrawal',
      resourceId: String(withdrawal.id),
      reason: normalizedReason,
      correlationId,
      requestIp,
      afterState: { status: 'rejected' },
    });
    return { withdrawal: formatWithdrawal(updatedRows[0]) };
  }, 'credit_withdrawal_reject');
}

async function cancelWithdrawal({ withdrawalId, customerId }) {
  if (!customerId) fail('Customer is required', 'credit_withdrawal_customer_required');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_withdrawals WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
      [withdrawalId, customerId]
    );
    const withdrawal = rows[0];
    if (!withdrawal) fail('Credit withdrawal not found', 'credit_withdrawal_not_found', 404);
    if (withdrawal.status !== 'requested') {
      fail(`Withdrawal cannot be cancelled from status ${withdrawal.status}`, 'credit_withdrawal_state_conflict', 409);
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_withdrawals
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND status = 'requested'
        RETURNING *`,
      [withdrawal.id]
    );
    return { withdrawal: formatWithdrawal(updatedRows[0]) };
  }, 'credit_withdrawal_cancel');
}

// Webhook: the Stripe transfer for a withdrawal completed. The lock journal
// was already posted at approval; confirmation only flips the status.
// In-flight money keeps resolving: bypass the operator freeze but keep the
// rail-enabled gate (same carve-out as top-ups and settlement payouts).
async function confirmWithdrawalFromTransfer(transferId, { getStripe = defaultGetStripe } = {}) {
  return withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client, { bypassFreeze: true });
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_withdrawals WHERE stripe_transfer_id = $1 FOR UPDATE`,
      [transferId]
    );
    const withdrawal = rows[0];
    if (!withdrawal) return { outcome: 'ignored' };
    if (withdrawal.status === 'paid') return { outcome: 'duplicate', withdrawalId: withdrawal.id };
    if (withdrawal.status !== 'processing' && withdrawal.status !== 'requires_attention') {
      return { outcome: 'ignored', reason: `status_${withdrawal.status}`, withdrawalId: withdrawal.id };
    }

    const stripe = getStripe();
    let transfer;
    try {
      transfer = await stripe.transfers.retrieve(transferId);
    } catch (err) {
      throw new AppError('Stripe withdrawal verification failed', 502, 'credit_withdrawal_verification_failed');
    }
    if (transfer.reversed === true) {
      return failWithdrawalFromTransferInTransaction(client, transferId, 'stripe_transfer_reversed', { getStripe });
    }
    if (String(transfer.metadata?.oxsteed_credit_withdrawal_id || '') !== String(withdrawal.id)) {
      fail('Stripe transfer metadata does not match this withdrawal', 'credit_withdrawal_transfer_mismatch', 409);
    }
    if (Number(transfer.amount) !== Number(withdrawal.net_cents)) {
      fail('Stripe transfer amount does not match the withdrawal net amount', 'credit_withdrawal_transfer_mismatch', 409);
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_withdrawals
          SET status = 'paid', updated_at = NOW()
        WHERE id = $1 AND status IN ('processing', 'requires_attention')
        RETURNING *`,
      [withdrawal.id]
    );
    if (!updatedRows[0]) return { outcome: 'duplicate', withdrawalId: withdrawal.id };

    await insertAudit(client, {
      actionType: 'credit.withdrawal.paid',
      actorUserId: withdrawal.reviewed_by,
      customerId: withdrawal.customer_id,
      resourceType: 'credit_withdrawal',
      resourceId: String(withdrawal.id),
      reason: `Stripe transfer ${transferId} confirmed`,
      afterState: { status: 'paid', stripeTransferId: transferId },
    });
    return { outcome: 'paid', withdrawalId: withdrawal.id };
  }, 'credit_withdrawal_confirm');
}

// Webhook: the Stripe transfer failed or was reversed. The lock leg already
// moved value out of the wallet, so a compensating `load` returns the FULL
// gross amount (net + fee) to the customer: the customer is made whole and
// the platform keeps the quoted fee for the processed attempt. A fee waiver
// remains an explicit admin adjustment, never a silent edit.
async function failWithdrawalFromTransfer(transferId, reason = 'stripe_transfer_failed', { getStripe = defaultGetStripe } = {}) {
  return withTransaction(pool, async (client) => {
    await assertCreditRailEnabled(client, { bypassFreeze: true });
    return failWithdrawalFromTransferInTransaction(client, transferId, reason, { getStripe });
  }, 'credit_withdrawal_fail');
}

async function failWithdrawalFromTransferInTransaction(client, transferId, reason, { getStripe = defaultGetStripe } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_withdrawals WHERE stripe_transfer_id = $1 FOR UPDATE`,
    [transferId]
  );
  const withdrawal = rows[0];
  if (!withdrawal) return { outcome: 'ignored' };
  if (withdrawal.status === 'failed') return { outcome: 'duplicate', withdrawalId: withdrawal.id };

  if (withdrawal.status === 'paid') {
    // Already paid: never auto-reverse the journal. Page the operator; the
    // money correction belongs to an explicit admin adjustment.
    await recordIncident({
      type: 'oxsteed_credit_withdrawal_paid_then_failed',
      severity: 'critical',
      message: `OxSteed Credit withdrawal ${withdrawal.id} was already marked paid when its Stripe transfer failed; use an admin adjustment for the money correction`,
      dedupeKey: `credit-withdrawal-paid-failed:${withdrawal.id}`,
      details: { withdrawalId: String(withdrawal.id), stripeTransferId: transferId, reason, requiresManualReversal: true },
    });
    return { outcome: 'ignored', reason: 'already_paid', withdrawalId: withdrawal.id };
  }

  // Compensating reversal: full gross back to the wallet. Append-only: the
  // original cash_out (and fee) rows are never edited.
  let reversalTransactionId = null;
  if (withdrawal.journal_transaction_id) {
    const currency = assertSupportedCreditCurrency(withdrawal.currency_code);
    const wallet = await ensureAccount(client, {
      accountType: 'customer_wallet', customerId: withdrawal.customer_id, currencyCode: currency,
    });
    const treasury = await ensureAccount(client, {
      accountType: 'platform_treasury', currencyCode: currency,
    });
    const { transaction } = await postJournalTransaction(client, {
      transactionType: 'load',
      debitAccountId: treasury.id,
      creditAccountId: wallet.id,
      customerId: withdrawal.customer_id,
      amountCents: Number(withdrawal.amount_cents),
      currencyCode: currency,
      idempotencyKey: `${JOURNAL_IDEMPOTENCY_PREFIX}${withdrawal.id}:reversal`,
      actorType: 'system',
      reason: 'Withdrawal payout failed; funds returned',
      description: 'Withdrawal payout failed; funds returned',
      referenceType: 'credit_withdrawal_reversal',
      referenceId: String(withdrawal.id),
      metadata: { source: 'credit_withdrawal', stripeTransferId: transferId, failureReason: reason },
      bindIdempotencySemantics: true,
    });
    reversalTransactionId = transaction.id;
  }

  const { rows: updatedRows } = await client.query(
    `UPDATE oxsteed_credit_withdrawals
        SET status = 'failed', journal_reversal_transaction_id = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [withdrawal.id, reversalTransactionId]
  );

  await insertAudit(client, {
    actionType: 'credit.withdrawal.failed',
    actorUserId: withdrawal.reviewed_by,
    customerId: withdrawal.customer_id,
    resourceType: 'credit_withdrawal',
    resourceId: String(withdrawal.id),
    reason: `Stripe transfer ${transferId} failed: ${reason}`,
    afterState: { status: 'failed', reversalTransactionId },
  });
  await recordIncident({
    type: 'oxsteed_credit_withdrawal_failed',
    severity: 'critical',
    message: `OxSteed Credit withdrawal ${withdrawal.id} Stripe payout transfer failed`,
    dedupeKey: `credit-withdrawal-failed:${withdrawal.id}`,
    details: { withdrawalId: String(withdrawal.id), stripeTransferId: transferId, reason },
  });
  return { outcome: 'failed', withdrawalId: updatedRows[0]?.id || withdrawal.id };
}

async function listWithdrawals({ status = null, customerId = null, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`w.status = $${params.length}`); }
  if (customerId) { params.push(customerId); conditions.push(`w.customer_id = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await pool.query(
    `SELECT w.*, u.email AS customer_email
       FROM oxsteed_credit_withdrawals w
       LEFT JOIN users u ON u.id = w.customer_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY w.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map((row) => ({ ...formatWithdrawal(row), customerEmail: row.customer_email || null }));
}

module.exports = {
  MIN_WITHDRAWAL_CENTS,
  DAILY_WITHDRAWAL_CAP_CENTS,
  formatWithdrawal,
  getWithdrawalById,
  getCustomerWithdrawal,
  requestWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  cancelWithdrawal,
  confirmWithdrawalFromTransfer,
  failWithdrawalFromTransfer,
  listWithdrawals,
};
