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
const { setFinancials } = require('../models/jobModel');
const { spendWithCredit } = require('./creditSpendAdapter');
const { enqueueJobEvent, EVENT_TYPES } = require('./jobEventOutbox');

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

async function releaseCollateralHold(client, holdId, jobId, changeOrderId) {
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
  const reason = `Replaced by approved change order ${changeOrderId}`;
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
    await setFinancials(job.id, newValueCents / 100, Boolean(job.is_broker_mediated), client);
  } else {
    await client.query('UPDATE jobs SET job_value_cents = $2, updated_at = NOW() WHERE id = $1', [job.id, newValueCents]);
  }

  // Card payment (Stripe manual capture).
  const { rows: payRows } = await client.query(
    `SELECT id, amount, status, metadata, capture_amount_cents, pending_increase_cents
       FROM payments WHERE job_id = $1 AND status IN ('pending', 'authorized')
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [job.id]
  );
  const payment = payRows[0];
  if (payment) {
    const meta = parseJson(payment.metadata);
    const appliedCredit = cents(meta.appliedCreditCents) || 0;
    const authorizedCents = cents(meta.authorized_amount_cents) ?? Math.round(Number(payment.amount) * 100);
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
        [payment.id, targetCents / 100, targetCents, JSON.stringify(nextMeta)]
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

  // OxSteed Credit escrow collateral.
  const jobMeta = parseJson(job.metadata);
  if (jobMeta.creditCollateralHoldId) {
    const { released } = await releaseCollateralHold(client, jobMeta.creditCollateralHoldId, job.id, changeOrder.id);
    if (released) {
      const collateral = await spendWithCredit({
        client,
        participantRef: { type: 'helper', subjectId: String(agreement.helper_id) },
        customerId: String(job.client_id),
        amountCents: newValueCents,
        currency: 'USD',
        surface: 'jobs',
        mode: 'hold',
        referenceType: 'job_escrow_collateral',
        referenceId: String(job.id),
        idempotencyKey: `credit-spend:jobs:job_escrow_collateral:${job.id}:co:${changeOrder.id}`,
        isImpersonated,
        metadata: { changeOrderId: String(changeOrder.id), replacesHoldId: String(jobMeta.creditCollateralHoldId) },
      });
      await client.query(
        `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [job.id, JSON.stringify({ creditCollateralHoldId: collateral.hold?.id || null, creditCollateralKey: collateral.idempotencyKey })]
      );
      adjustment.credit_action = 'hold_replaced';
      adjustment.credit_hold_id = collateral.hold?.id || null;
    }
  }
  if (adjustment.payment_action === 'reauthorization_required' || adjustment.payment_action === 'intent_reprice_required') {
    await client.query(
      `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [job.id, JSON.stringify({ paymentAdjustmentRequired: adjustment.payment_action, paymentAdjustmentChangeOrderId: changeOrder.id })]
    );
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
    },
  });
  logger.info('change_order.applied', { jobId: job.id, changeOrderId: changeOrder.id, ...adjustment });
  return { job, adjustment, newValueCents };
}

module.exports = { applyApprovedChangeOrder };
