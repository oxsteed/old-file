'use strict';

/**
 * Applies an approved work-agreement change order to the job's money, inside
 * the caller's transaction (all-or-nothing with the approval):
 *
 *  - agreed price: jobs.job_value_cents (+ fee breakdown via setFinancials when
 *    the job uses platform payments)
 *  - card payment: decreases lower the capture amount (partial capture releases
 *    the rest); increases above the authorized amount are recorded as
 *    payments.pending_increase_cents and flagged for re-authorization
 *  - OxSteed Credit escrow collateral: the active hold is released and a new
 *    hold for the new price is placed (fail-closed: insufficient Credit rolls
 *    back the approval)
 *  - audit: job_revisions (source 'change_order') + job.change_order_applied
 *    outbox event
 *
 * Lock order: jobs → payments → credit holds.
 */

const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { setFinancials, setFinancialsMinor } = require('../models/jobModel');
const { currencyExponent } = require('../validation/money');
const flags = require('./paymentLayerFlags');

/** Credit holds a job can carry: escrow collateral, or the payment itself. */
const CREDIT_HOLD_KINDS = Object.freeze({
  collateral: { metaKey: 'creditCollateralHoldId', keyKey: 'creditCollateralKey', referenceType: 'job_escrow_collateral' },
  payment: { metaKey: 'creditPaymentHoldId', keyKey: 'creditPaymentKey', referenceType: 'job_payment' },
});

function jobCurrency(job) {
  return String(job?.settlement_currency || job?.currency_code || 'USD').trim().toUpperCase();
}

/** Price the job in minor units of its currency (country fees when enabled). */
async function setJobPrice(client, job, valueMinor) {
  const currency = jobCurrency(job);
  if (currencyExponent(currency) === 2 && !flags.isEnabled('COUNTRY_FEES') && currency === 'USD') {
    return setFinancials(job.id, valueMinor / 100, Boolean(job.is_broker_mediated), client);
  }
  return setFinancialsMinor(job.id, valueMinor, { currency, country: job.location_country_code, rail: job.payment_rail, isBrokerMediated: Boolean(job.is_broker_mediated) }, client);
}
const { spendWithCredit } = require('./creditSpendAdapter');
const { enqueueJobEvent, EVENT_TYPES } = require('./jobEventOutbox');

function supersedeOpenAttempts(client, jobId, reason) {
  return require('./jobPaymentReauthorizationService').supersedeOpenAttempts(client, jobId, reason);
}

function cents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value;
}

async function releaseCollateralHold(client, holdId, jobId, reason) {
  const { rows } = await client.query('SELECT * FROM oxsteed_credit_holds WHERE id = $1 FOR UPDATE', [holdId]);
  const hold = rows[0];
  if (!hold || hold.status !== 'active') return { released: false, hold };
  const reserve = await client.query(
    `UPDATE oxsteed_credit_accounts
        SET reserved_cents = reserved_cents - $1, updated_at = NOW()
      WHERE id = $2 AND reserved_cents >= $1
      RETURNING id`,
    [hold.amount_cents, hold.account_id]
  );
  if (!reserve.rows[0]) throw new AppError('Credit hold reservation is inconsistent', 409, 'credit_hold_reservation_invalid');
  await client.query(
    `UPDATE oxsteed_credit_holds
        SET status = 'released', released_at = NOW(), release_actor_type = 'system',
            release_reason = $1, updated_at = NOW()
      WHERE id = $2`,
    [reason, hold.id]
  );
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id, reason)
     VALUES ('credit.hold.released', NULL, $1, $2, 'credit_hold', $3, $4)`,
    [hold.customer_id, hold.partner_id, String(hold.id), `${reason} (job ${jobId})`]
  );
  return { released: true, hold };
}

/**
 * Release the active Credit collateral hold and place a new one for
 * amountCents, inside the caller's transaction. Returns { holdId } (undefined
 * when there was no active hold to replace).
 */
async function replaceCreditCollateral(client, { job, amountCents, reason, idempotencyKey, isImpersonated = false, metadata = {}, helperId = null, kind = 'collateral' }) {
  const spec = CREDIT_HOLD_KINDS[kind] || CREDIT_HOLD_KINDS.collateral;
  const jobMeta = parseJson(job.metadata);
  const oldHoldId = jobMeta[spec.metaKey];
  if (!oldHoldId) return { holdId: undefined };
  const { released } = await releaseCollateralHold(client, oldHoldId, job.id, reason);
  if (!released) return { holdId: undefined };
  const currency = kind === 'payment' ? jobCurrency(job) : 'USD';
  const hold = await spendWithCredit({
    client,
    participantRef: { type: 'helper', subjectId: String(helperId || job.assigned_helper_id) },
    customerId: String(job.client_id),
    amountCents,
    currency,
    surface: 'jobs',
    mode: 'hold',
    referenceType: spec.referenceType,
    referenceId: String(job.id),
    idempotencyKey: kind === 'payment' ? idempotencyKey.replace('job_escrow_collateral', 'job_payment') : idempotencyKey,
    isImpersonated,
    metadata: { ...metadata, replacesHoldId: String(oldHoldId) },
  });
  const newHoldId = hold.hold?.id || null;
  await client.query(
    `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [job.id, JSON.stringify({ [spec.metaKey]: newHoldId, [spec.keyKey]: hold.idempotencyKey })]
  );
  if (kind === 'payment') {
    await require('./paymentRails/creditRail').supersedePaymentHold(client, { jobId: job.id, oldHoldId, newHoldId, amountMinor: amountCents, currency });
  }
  return { holdId: newHoldId };
}

/**
 * @param {import('pg').PoolClient} client  open transaction
 * @param {{ agreement: object, changeOrder: object, actorId: string, isImpersonated?: boolean }} args
 */
async function applyApprovedChangeOrder(client, { agreement, changeOrder, actorId, isImpersonated = false }) {
  const delta = cents(changeOrder.price_change_cents) || 0;
  const { rows: jobRows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [agreement.job_id]);
  const job = jobRows[0];
  if (!job) throw new AppError('Job not found', 404, 'job_not_found');

  const adjustment = { price_change_cents: delta, payment_action: 'none', credit_action: 'none' };
  if (delta === 0) {
    await client.query(
      `UPDATE work_agreement_change_orders SET applied_at = NOW(), payment_adjustment = $2::jsonb WHERE id = $1`,
      [changeOrder.id, JSON.stringify(adjustment)]
    );
    return { job, adjustment, newValueCents: cents(job.job_value_cents) };
  }

  let baseCents = cents(job.job_value_cents) ?? (job.job_value != null ? Math.round(Number(job.job_value) * 100) : null);
  if (baseCents === null) {
    const { rows: bidRows } = await client.query(
      `SELECT amount_cents, amount FROM bids WHERE job_id = $1 AND status = 'accepted' ORDER BY updated_at DESC LIMIT 1`,
      [job.id]
    );
    baseCents = bidRows[0] ? (cents(bidRows[0].amount_cents) ?? Math.round(Number(bidRows[0].amount) * 100)) : null;
  }
  if (baseCents === null) {
    throw new AppError('This job has no agreed price to change.', 409, 'change_order_no_agreed_price');
  }
  const newValueCents = baseCents + delta;
  if (newValueCents <= 0) {
    throw new AppError('A change order cannot reduce the job price to zero or below.', 422, 'validation_failed',
      { priceChangeCents: 'change_order_invalid_total' });
  }
  adjustment.from_value_cents = baseCents;
  adjustment.to_value_cents = newValueCents;

  const platformPriced = job.job_value != null || job.job_value_cents != null;
  if (platformPriced) {
    await setJobPrice(client, job, newValueCents);
  } else {
    await client.query('UPDATE jobs SET job_value_cents = $2, updated_at = NOW() WHERE id = $1', [job.id, newValueCents]);
  }

  // Card payment (Stripe manual capture).
  const { rows: payRows } = await client.query(
    `SELECT id, amount, currency, status, metadata, capture_amount_cents, pending_increase_cents
       FROM payments WHERE job_id = $1 AND status IN ('pending', 'authorized')
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [job.id]
  );
  const payment = payRows[0];
  if (payment) {
    const meta = parseJson(payment.metadata);
    const appliedCredit = cents(meta.appliedCreditCents) || 0;
    const scale = 10 ** currencyExponent(payment.currency);
    const authorizedCents = cents(meta.authorized_amount_cents) ?? Math.round(Number(payment.amount) * scale);
    const targetCents = Math.max(0, newValueCents - appliedCredit);
    const nextMeta = { ...meta, authorized_amount_cents: authorizedCents, last_change_order_id: changeOrder.id };
    if (payment.status === 'pending') {
      // Not yet authorized: the intent must be re-priced before confirmation.
      adjustment.payment_action = 'intent_reprice_required';
      await client.query(
        `UPDATE payments SET pending_increase_cents = $2, capture_amount_cents = $3, metadata = $4::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [payment.id, Math.max(0, targetCents - authorizedCents), targetCents, JSON.stringify(nextMeta)]
      );
    } else if (targetCents <= authorizedCents) {
      adjustment.payment_action = 'capture_reduced';
      await client.query(
        `UPDATE payments SET amount = $2, capture_amount_cents = $3, pending_increase_cents = 0,
                metadata = $4::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [payment.id, targetCents / scale, targetCents, JSON.stringify(nextMeta)]
      );
    } else {
      adjustment.payment_action = 'reauthorization_required';
      await client.query(
        `UPDATE payments SET pending_increase_cents = $2, capture_amount_cents = $3, metadata = $4::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [payment.id, targetCents - authorizedCents, authorizedCents, JSON.stringify(nextMeta)]
      );
    }
    adjustment.payment_id = payment.id;
    adjustment.capture_target_cents = targetCents;
  }

  // OxSteed Credit escrow collateral. Insufficient Credit no longer blocks
  // the approval: the old hold stays in place (savepoint) and the customer is
  // asked to add Credit and re-authorize (jobPaymentReauthorizationService).
  const jobMeta = parseJson(job.metadata);
  const creditKind = jobMeta.creditPaymentHoldId ? 'payment' : jobMeta.creditCollateralHoldId ? 'collateral' : null;
  if (creditKind) {
    await client.query('SAVEPOINT change_order_credit');
    try {
      const { holdId } = await replaceCreditCollateral(client, {
        job,
        kind: creditKind,
        amountCents: newValueCents,
        reason: `Replaced by approved change order ${changeOrder.id}`,
        idempotencyKey: `credit-spend:jobs:job_escrow_collateral:${job.id}:co:${changeOrder.id}`,
        isImpersonated,
        metadata: { changeOrderId: String(changeOrder.id) },
        helperId: agreement.helper_id,
      });
      await client.query('RELEASE SAVEPOINT change_order_credit');
      if (holdId !== undefined) {
        adjustment.credit_action = 'hold_replaced';
        adjustment.credit_hold_id = holdId;
        await client.query(
          `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) - 'creditAdjustmentRequired' - 'creditAdjustmentAmountCents' - 'creditAdjustmentChangeOrderId' - 'creditAdjustmentKind' WHERE id = $1`,
          [job.id]
        );
      }
    } catch (err) {
      if (err?.code !== 'credit_insufficient_funds') throw err;
      await client.query('ROLLBACK TO SAVEPOINT change_order_credit');
      adjustment.credit_action = 'credit_reauthorization_required';
      await client.query(
        `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [job.id, JSON.stringify({ creditAdjustmentRequired: true, creditAdjustmentAmountCents: newValueCents, creditAdjustmentChangeOrderId: changeOrder.id, creditAdjustmentKind: creditKind })]
      );
    }
  }
  if (adjustment.payment_action === 'reauthorization_required' || adjustment.payment_action === 'intent_reprice_required') {
    await client.query(
      `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [job.id, JSON.stringify({ paymentAdjustmentRequired: adjustment.payment_action, paymentAdjustmentChangeOrderId: changeOrder.id })]
    );
  } else if (adjustment.payment_action === 'capture_reduced') {
    // A later decrease can make an earlier re-authorization unnecessary.
    await client.query(
      `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) - 'paymentAdjustmentRequired' - 'paymentAdjustmentChangeOrderId' WHERE id = $1`,
      [job.id]
    );
    await supersedeOpenAttempts(client, job.id, 'superseded');
  }

  const { rows: updatedRows } = await client.query('SELECT version, revision FROM jobs WHERE id = $1', [job.id]);
  await client.query(
    `INSERT INTO job_revisions (job_id, version, revision, is_material, source, actor_id, reason, changes)
     VALUES ($1, $2, $3, TRUE, 'change_order', $4, $5, $6::jsonb)`,
    [job.id, updatedRows[0]?.version ?? job.version, updatedRows[0]?.revision ?? job.revision, actorId,
      `Change order ${changeOrder.id} approved`,
      JSON.stringify({ job_value_cents: { from: baseCents, to: newValueCents } })]
  );
  await client.query(
    `UPDATE work_agreement_change_orders
        SET applied_at = NOW(), applied_job_value_cents = $2, payment_adjustment = $3::jsonb
      WHERE id = $1`,
    [changeOrder.id, newValueCents, JSON.stringify(adjustment)]
  );
  await enqueueJobEvent(client, {
    jobId: job.id,
    eventType: EVENT_TYPES.CHANGE_ORDER_APPLIED,
    coalesce: false,
    payload: {
      change_order_id: changeOrder.id,
      customer_id: job.client_id,
      helper_id: agreement.helper_id,
      payment_action: adjustment.payment_action,
      credit_action: adjustment.credit_action,
    },
  });
  logger.info('change_order.applied', { jobId: job.id, changeOrderId: changeOrder.id, ...adjustment });
  return { job, adjustment, newValueCents };
}

module.exports = { applyApprovedChangeOrder, replaceCreditCollateral, releaseCollateralHold, setJobPrice };
