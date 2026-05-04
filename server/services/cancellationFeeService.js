/**
 * cancellationFeeService.js
 *
 * Collects the cancellation recognition fee from a customer's saved Stripe
 * payment method and transfers the helper's share to their Connect account.
 *
 * Called fire-and-forget from jobController after the DB transaction commits.
 * All errors are logged; none are re-thrown (so they never affect the HTTP response).
 *
 * Flow:
 *  1. Look up customer's stripe_customer_id.
 *  2. Find their default (or first) saved card.
 *  3. Create + confirm a PaymentIntent (off_session) to charge the fee.
 *  4. Look up helper's stripe_account_id from connect_accounts.
 *  5. Transfer feeToHelper cents to the helper's Connect account.
 *  6. Update cancellation_fees row → status 'collected'.
 *
 * If the customer has no saved payment method the fee is left at status
 * 'pending' so it can be collected later (e.g. on their next checkout).
 */

const pool   = require('../db');
const logger = require('../utils/logger');

let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch (_) {
  /* Stripe not available in this environment — fee collection will be skipped */
}

/**
 * collectCancellationFee
 *
 * @param {Object} opts
 * @param {number} opts.feeRecordId    - cancellation_fees.id
 * @param {string} opts.customerId     - users.id (UUID) of the payer
 * @param {string} opts.helperId       - users.id (UUID) of the payee
 * @param {number} opts.feeTotalCents  - gross amount to charge the customer
 * @param {number} opts.feeToHelper    - amount to transfer to helper's Connect account
 */
async function collectCancellationFee({ feeRecordId, customerId, helperId, feeTotalCents, feeToHelper }) {
  if (!stripe) {
    logger.warn('cancellationFeeService: Stripe not initialised — skipping fee collection', { feeRecordId });
    return;
  }

  if (!feeRecordId || !feeTotalCents || feeTotalCents <= 0) {
    return; // nothing to do
  }

  // ── 1. Get customer's Stripe customer ID ───────────────────────────────────
  const customerRow = await pool.query(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [customerId]
  );
  const stripeCustomerId = customerRow.rows[0]?.stripe_customer_id;

  if (!stripeCustomerId) {
    logger.info('cancellationFeeService: customer has no Stripe customer ID — fee left pending', {
      feeRecordId, customerId
    });
    await markFeePending(feeRecordId, 'no_stripe_customer');
    return;
  }

  // ── 2. Find a saved payment method ────────────────────────────────────────
  let paymentMethodId;
  try {
    const methods = await stripe.customers.listPaymentMethods(stripeCustomerId, { type: 'card', limit: 1 });
    paymentMethodId = methods.data[0]?.id;
  } catch (err) {
    logger.error('cancellationFeeService: failed to list payment methods', {
      feeRecordId, stripeCustomerId, error: err.message
    });
  }

  if (!paymentMethodId) {
    logger.info('cancellationFeeService: no saved card found — fee left pending', {
      feeRecordId, customerId
    });
    await markFeePending(feeRecordId, 'no_payment_method');
    return;
  }

  // ── 3. Charge the customer ────────────────────────────────────────────────
  let chargeId;
  let paymentIntentId;
  try {
    const intent = await stripe.paymentIntents.create({
      amount:               feeTotalCents,
      currency:             'usd',
      customer:             stripeCustomerId,
      payment_method:       paymentMethodId,
      confirm:              true,
      off_session:          true,
      description:          'OxSteed job cancellation recognition fee',
      metadata: {
        fee_record_id: String(feeRecordId),
        payer_id:      customerId,
        payee_id:      helperId,
        type:          'cancellation_fee',
      },
    });

    paymentIntentId = intent.id;
    // The charge ID lives on the latest_charge field
    chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id;

    logger.info('cancellationFeeService: customer charge succeeded', {
      feeRecordId, paymentIntentId, chargeId, feeTotalCents
    });
  } catch (err) {
    logger.error('cancellationFeeService: Stripe charge failed', {
      feeRecordId, stripeCustomerId, error: err.message, code: err.code
    });
    await markFeeFailed(feeRecordId, err.message);
    return;
  }

  // ── 4. Get helper's Connect account ───────────────────────────────────────
  let helperStripeAccountId;
  if (feeToHelper > 0) {
    try {
      const connectRow = await pool.query(
        'SELECT stripe_account_id FROM connect_accounts WHERE user_id = $1 AND status = $2 LIMIT 1',
        [helperId, 'active']
      );
      helperStripeAccountId = connectRow.rows[0]?.stripe_account_id;
    } catch (err) {
      logger.warn('cancellationFeeService: could not look up helper Connect account', {
        feeRecordId, helperId, error: err.message
      });
    }
  }

  // ── 5. Transfer helper's share to their Connect account ───────────────────
  let transferId;
  if (helperStripeAccountId && feeToHelper > 0) {
    try {
      const transfer = await stripe.transfers.create({
        amount:            feeToHelper,
        currency:          'usd',
        destination:       helperStripeAccountId,
        source_transaction: chargeId,
        description:       'Cancellation recognition fee — helper share',
        metadata: {
          fee_record_id: String(feeRecordId),
          payer_id:      customerId,
          payee_id:      helperId,
          type:          'cancellation_fee_transfer',
        },
      });
      transferId = transfer.id;
      logger.info('cancellationFeeService: helper transfer succeeded', {
        feeRecordId, transferId, feeToHelper, helperStripeAccountId
      });
    } catch (err) {
      // Transfer failure is non-fatal — charge already succeeded.
      // Log prominently so finance team can reconcile manually.
      logger.error('cancellationFeeService: helper transfer FAILED after successful charge — NEEDS MANUAL RECONCILIATION', {
        feeRecordId, chargeId, feeToHelper, helperStripeAccountId, error: err.message
      });
    }
  } else if (feeToHelper > 0) {
    logger.warn('cancellationFeeService: helper has no active Connect account — transfer skipped', {
      feeRecordId, helperId, feeToHelper
    });
  }

  // ── 6. Mark fee as collected in DB ────────────────────────────────────────
  try {
    await pool.query(
      `UPDATE cancellation_fees SET
         status             = 'collected',
         stripe_charge_id   = $1,
         stripe_transfer_id = $2,
         failure_reason     = NULL,
         collected_at       = NOW(),
         updated_at         = NOW()
       WHERE id = $3`,
      [chargeId || paymentIntentId, transferId || null, feeRecordId]
    );
  } catch (dbErr) {
    logger.error('cancellationFeeService: failed to update fee record after successful charge', {
      feeRecordId, chargeId, transferId, error: dbErr.message
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function markFeePending(feeRecordId, reason) {
  try {
    await pool.query(
      `UPDATE cancellation_fees SET
         status         = 'pending',
         failure_reason = $1,
         updated_at     = NOW()
       WHERE id = $2`,
      [reason, feeRecordId]
    );
  } catch (_) { /* non-fatal */ }
}

async function markFeeFailed(feeRecordId, reason) {
  try {
    await pool.query(
      `UPDATE cancellation_fees SET
         status         = 'failed',
         failure_reason = $1,
         updated_at     = NOW()
       WHERE id = $2`,
      [reason?.slice(0, 500), feeRecordId]
    );
  } catch (_) { /* non-fatal */ }
}

module.exports = { collectCancellationFee };
