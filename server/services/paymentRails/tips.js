'use strict';

/**
 * Tips (decision #9): the helper receives the tip minus only the payment
 * processing cost; OxSteed keeps no fee (job_tips.platform_fee_minor is
 * CHECKed to 0).
 *   stripe rail  card PaymentIntent, captured immediately. Direct charges:
 *                Stripe's fee comes out of the helper's account, no
 *                application fee. Destination charges: Stripe bills the
 *                platform, so the application fee equals the estimated
 *                processing cost only.
 *   credit rail  Credit hold finalized at once; no processing cost.
 *   offline      not processed — tip the helper directly.
 */

const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const pool = require('../../db');
const logger = require('../../utils/logger');
const flags = require('../paymentLayerFlags');
const railPolicy = require('../paymentRailPolicy');
const chargeModel = require('../stripeChargeModel');
const { railOf } = require('./index');

const TIPPABLE = new Set(['in_progress', 'completed', 'closed']);
const MAX_TIP_SHARE = 1; // a tip can be at most 100% of the job price

function stripeClient() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function quoteTip({ jobId, user, amountMinor }) {
  if (!flags.isEnabled('TIPS')) throw new AppError('Tips are not available', 404, 'feature_disabled');
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job || String(job.client_id) !== String(user.id)) throw new AppError('Job not found', 404, 'job_not_found');
  const rail = railOf(job);
  const currency = railPolicy.settlementCurrency({ job });
  const policy = await railPolicy.getCountryPolicy(pool, railPolicy.jobCountry(job, null));
  const amount = Number(amountMinor);
  const cost = Number.isSafeInteger(amount) && amount > 0 ? railPolicy.tipProcessingCost({ amountMinor: amount, rail, policy }) : null;
  return { rail, currency, amount_minor: amount, processing_cost_minor: cost, helper_receives_minor: cost === null ? null : amount - cost, platform_fee_minor: 0, tippable: rail !== 'offline' && TIPPABLE.has(String(job.status)) };
}

async function createTip({ jobId, user, amountMinor, idempotencyKey, isImpersonated = false }) {
  if (!flags.isEnabled('TIPS')) throw new AppError('Tips are not available', 404, 'feature_disabled');
  if (isImpersonated) throw new AppError('Impersonated sessions cannot send money', 403, 'impersonation_blocked');
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Enter a tip amount', 400, 'validation_failed', { amount_minor: 'tip_amount_invalid' });
  if (!idempotencyKey) throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');

  const prepared = await withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job || String(job.client_id) !== String(user.id)) throw new AppError('Job not found', 404, 'job_not_found');
    if (!TIPPABLE.has(String(job.status)) || !job.assigned_helper_id) throw new AppError('This job cannot be tipped yet', 409, 'tip_not_allowed');
    const rail = railOf(job);
    if (rail === 'offline') throw new AppError('Tip your helper directly for jobs paid offline', 409, 'tip_offline_rail');
    const { rows: existing } = await client.query('SELECT * FROM job_tips WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing[0]) return { replay: existing[0], job, rail };
    const jobValue = Number(job.job_value_cents) || 0;
    if (jobValue > 0 && amount > jobValue * MAX_TIP_SHARE) throw new AppError('The tip is larger than allowed', 400, 'validation_failed', { amount_minor: 'tip_too_large' });
    const currency = railPolicy.settlementCurrency({ job });
    const policy = await railPolicy.getCountryPolicy(client, railPolicy.jobCountry(job, null));
    const cost = railPolicy.tipProcessingCost({ amountMinor: amount, rail, policy });
    const { rows: inserted } = await client.query(
      `INSERT INTO job_tips (job_id, customer_id, helper_id, rail, amount_minor, currency, processing_cost_minor, helper_net_minor, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [job.id, user.id, job.assigned_helper_id, rail, amount, currency, cost, amount - cost, idempotencyKey]
    );
    const tip = inserted[0];
    if (rail === 'credit') {
      const spend = require('../creditSpendAdapter');
      const hold = await spend.spendWithCredit({
        client, participantRef: { type: 'helper', subjectId: String(job.assigned_helper_id) }, customerId: String(user.id),
        amountCents: amount, currency, surface: 'jobs', mode: 'hold', referenceType: 'job_tip', referenceId: String(tip.id),
        idempotencyKey: `credit-spend:jobs:job_tip:${tip.id}`, isImpersonated, metadata: { jobId: String(job.id) },
      });
      await spend.finalizeCreditSpendInTransaction(client, {
        holdId: hold.hold?.id, finalAmountCents: amount, currencyCode: currency, idempotencyKey: `credit-finalize:job_tip:${tip.id}`,
        actorUserId: user.id, actorType: 'customer', referenceType: 'job_tip', referenceId: String(tip.id), description: 'Job tip',
      });
      const { rows: done } = await client.query(
        `UPDATE job_tips SET status = 'succeeded', credit_hold_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [tip.id, hold.hold?.id || null]
      );
      return { tip: done[0], job, rail, settled: true };
    }
    return { tip, job, rail, currency, cost };
  }, 'job_tip_create');

  if (prepared.replay) return viewTip(prepared.replay);
  if (prepared.settled) {
    await notifyTipReceived(prepared.tip).catch((err) => logger.warn('tips.notify_failed', { error: err.message }));
    return viewTip(prepared.tip);
  }

  // Stripe rail.
  const { tip, job, currency, cost } = prepared;
  const { rows: connect } = await pool.query('SELECT stripe_account_id FROM connect_accounts WHERE user_id = $1', [job.assigned_helper_id]);
  const account = connect[0]?.stripe_account_id;
  if (!account) throw new AppError('Your helper cannot receive card tips yet', 409, 'helper_account_not_ready');
  const { rows: payRows } = await pool.query(
    `SELECT charge_model FROM payments WHERE job_id = $1 ORDER BY id DESC LIMIT 1`, [job.id]
  );
  const model = chargeModel.modelOf(payRows[0]) === 'direct' ? 'direct' : 'destination';
  const built = chargeModel.intentParams({
    model, amountMinor: Number(tip.amount_minor), currency,
    applicationFeeMinor: model === 'direct' ? 0 : cost, helperAccountId: account,
    metadata: { job_id: String(job.id), job_tip: 'true', tip_id: String(tip.id), helper_id: String(job.assigned_helper_id) },
  });
  built.params.capture_method = 'automatic';
  if (model === 'direct') delete built.params.application_fee_amount;
  const intent = await stripeClient().paymentIntents.create(built.params, { ...built.options, idempotencyKey: `job-tip:${tip.id}` });
  await pool.query('UPDATE job_tips SET stripe_payment_intent_id = $2, updated_at = NOW() WHERE id = $1', [tip.id, intent.id]);
  return { ...viewTip({ ...tip, stripe_payment_intent_id: intent.id }), client_secret: intent.client_secret, stripe_account_id: model === 'direct' ? account : null, publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null };
}

function viewTip(tip) {
  return {
    id: String(tip.id), rail: tip.rail, status: tip.status, currency: tip.currency,
    amount_minor: Number(tip.amount_minor), processing_cost_minor: Number(tip.processing_cost_minor),
    helper_net_minor: Number(tip.helper_net_minor), platform_fee_minor: 0,
  };
}

async function notifyTipReceived(tip) {
  const templates = require('../notificationTemplates');
  const { sendNotification } = require('../notificationService');
  const recipient = await templates.loadRecipient(pool, tip.helper_id);
  const copy = templates.render('tip_received', recipient, { amount_minor: Number(tip.amount_minor), currency: tip.currency });
  return sendNotification({
    userId: tip.helper_id, type: 'job_tip_received', title: copy.title, body: copy.body,
    data: { job_id: tip.job_id, tip_id: String(tip.id) }, action_url: `/jobs/${tip.job_id}`, idempotencyKey: `job-tip-received:${tip.id}`,
  });
}

async function listTips(jobId, user) {
  const { rows } = await pool.query('SELECT client_id, assigned_helper_id FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job || ![String(job.client_id), String(job.assigned_helper_id)].includes(String(user.id))) throw new AppError('Job not found', 404, 'job_not_found');
  const { rows: tips } = await pool.query(`SELECT * FROM job_tips WHERE job_id = $1 AND status = 'succeeded' ORDER BY id`, [jobId]);
  return tips.map(viewTip);
}

module.exports = { quoteTip, createTip, notifyTipReceived, listTips, viewTip };
