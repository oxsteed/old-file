'use strict';

/**
 * Switching a hired job to another rail (decision #6): only before work
 * starts (status accepted), and only with both parties' consent — one asks,
 * the other accepts. Moving to the offline rail needs both offline
 * acknowledgements and must pass the same eligibility checks as a hire.
 */

const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const pool = require('../../db');
const flags = require('../paymentLayerFlags');
const railPolicy = require('../paymentRailPolicy');
const creditRail = require('./creditRail');
const offlineRail = require('./offlineRail');
const chargeModel = require('../stripeChargeModel');
const { enqueueJobEvent, EVENT_TYPES } = require('../jobEventOutbox');
const { railOf, loadParties } = require('./index');

const SWITCH_TTL_HOURS = 48;
const SWITCHABLE_STATUSES = new Set(['accepted']);

function assertEnabled() {
  if (!flags.isEnabled('PAYMENT_RAILS')) throw new AppError('Payment options are not available', 404, 'feature_disabled');
}

function partyOf(job, user) {
  if (String(job.client_id) === String(user.id)) return 'customer';
  if (job.assigned_helper_id && String(job.assigned_helper_id) === String(user.id)) return 'helper';
  return null;
}

async function lockJob(client, jobId) {
  const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
  if (!rows[0]) throw new AppError('Job not found', 404, 'job_not_found');
  return rows[0];
}

function view(row) {
  if (!row) return null;
  return {
    id: String(row.id), from_rail: row.from_rail, to_rail: row.to_rail, status: row.status,
    requested_by: String(row.requested_by), expires_at: row.expires_at, created_at: row.created_at,
  };
}

async function getSwitchState(jobId, user) {
  assertEnabled();
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = rows[0];
  if (!job || !partyOf(job, user)) throw new AppError('Job not found', 404, 'job_not_found');
  const { rows: pending } = await pool.query(
    `SELECT * FROM job_rail_switch_requests WHERE job_id = $1 AND status = 'pending' AND expires_at > NOW()`,
    [jobId]
  );
  const rail = railOf(job);
  let options = null;
  if (SWITCHABLE_STATUSES.has(String(job.status)) && job.assigned_helper_id) {
    const parties = await loadParties(pool, { customerId: job.client_id, helperId: job.assigned_helper_id });
    options = await railPolicy.railOptions(pool, { job, amountMinor: Number(job.job_value_cents), ...parties });
  }
  return {
    rail,
    can_switch: SWITCHABLE_STATUSES.has(String(job.status)),
    pending: pending[0] ? { ...view(pending[0]), requested_by_me: String(pending[0].requested_by) === String(user.id) } : null,
    options: options ? options.rails.filter((r) => r.rail !== rail) : [],
    my_role: partyOf(job, user),
  };
}

async function requestSwitch({ jobId, user, toRail, offlineAck = false }) {
  assertEnabled();
  return withTransaction(pool, async (client) => {
    const job = await lockJob(client, jobId);
    const role = partyOf(job, user);
    if (!role) throw new AppError('Job not found', 404, 'job_not_found');
    if (!SWITCHABLE_STATUSES.has(String(job.status))) {
      throw new AppError('The payment method can only change before work starts', 409, 'rail_switch_after_start');
    }
    const from = railOf(job);
    if (!railPolicy.RAILS.includes(toRail) || toRail === from) {
      throw new AppError('Choose a different payment method', 400, 'payment_rail_invalid', { payment_rail: 'invalid' });
    }
    const parties = await loadParties(client, { customerId: job.client_id, helperId: job.assigned_helper_id });
    const options = await railPolicy.railOptions(client, { job, amountMinor: Number(job.job_value_cents), ...parties });
    const entry = railPolicy.assertRailAvailable(options, toRail);
    if (toRail === 'offline' && entry.requires_offline_ack && offlineAck !== true) {
      throw new AppError('Confirm that direct payments are not covered by OxSteed', 422, 'offline_ack_required', { offline_ack: 'required' });
    }
    await client.query(
      `UPDATE job_rail_switch_requests SET status = 'expired' WHERE job_id = $1 AND status = 'pending' AND expires_at <= NOW()`,
      [job.id]
    );
    const { rows } = await client.query(
      `INSERT INTO job_rail_switch_requests (job_id, from_rail, to_rail, requested_by, offline_ack_requester, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6::int * INTERVAL '1 hour'))
       ON CONFLICT (job_id) WHERE status = 'pending' DO NOTHING
       RETURNING *`,
      [job.id, from, toRail, user.id, offlineAck === true, SWITCH_TTL_HOURS]
    );
    if (!rows[0]) throw new AppError('A payment change is already waiting for an answer', 409, 'rail_switch_pending');
    await enqueueJobEvent(client, {
      jobId: job.id, eventType: EVENT_TYPES.RAIL_SWITCH_REQUESTED, coalesce: false,
      payload: { request_id: String(rows[0].id), from_rail: from, to_rail: toRail, counterparty_id: role === 'customer' ? job.assigned_helper_id : job.client_id },
    });
    return { request: view(rows[0]), downgrade: railPolicy.isDowngrade(from, toRail) };
  }, 'rail_switch_request');
}

async function respondToSwitch({ jobId, requestId, user, accept, offlineAck = false, fxQuoteId = null, creditQuoteId = null, isImpersonated = false }) {
  assertEnabled();
  const released = [];
  const result = await withTransaction(pool, async (client) => {
    const job = await lockJob(client, jobId);
    const role = partyOf(job, user);
    if (!role) throw new AppError('Job not found', 404, 'job_not_found');
    const { rows } = await client.query(
      `SELECT * FROM job_rail_switch_requests WHERE id = $1 AND job_id = $2 FOR UPDATE`,
      [requestId, jobId]
    );
    const request = rows[0];
    if (!request || request.status !== 'pending') throw new AppError('This payment change is no longer pending', 409, 'rail_switch_not_pending');
    const requesterIsMe = String(request.requested_by) === String(user.id);
    if (!accept) {
      await client.query(
        `UPDATE job_rail_switch_requests SET status = $2, responded_by = $3, responded_at = NOW() WHERE id = $1`,
        [request.id, requesterIsMe ? 'canceled' : 'declined', user.id]
      );
      await enqueueJobEvent(client, { jobId: job.id, eventType: EVENT_TYPES.RAIL_SWITCH_RESOLVED, coalesce: false,
        payload: { request_id: String(request.id), status: requesterIsMe ? 'canceled' : 'declined', to_rail: request.to_rail } });
      return { status: requesterIsMe ? 'canceled' : 'declined' };
    }
    if (requesterIsMe) throw new AppError('The other party must accept this change', 403, 'rail_switch_needs_counterparty');
    if (new Date(request.expires_at) <= new Date()) {
      await client.query(`UPDATE job_rail_switch_requests SET status = 'expired' WHERE id = $1`, [request.id]);
      throw new AppError('This payment change request expired', 409, 'rail_switch_expired');
    }
    if (!SWITCHABLE_STATUSES.has(String(job.status))) {
      throw new AppError('The payment method can only change before work starts', 409, 'rail_switch_after_start');
    }
    if (railOf(job) !== request.from_rail) throw new AppError('The payment method already changed', 409, 'rail_switch_stale');
    const parties = await loadParties(client, { customerId: job.client_id, helperId: job.assigned_helper_id });
    const amountMinor = Number(job.job_value_cents);
    const options = await railPolicy.railOptions(client, { job, amountMinor, ...parties });
    const entry = railPolicy.assertRailAvailable(options, request.to_rail);
    if (request.to_rail === 'offline' && entry.requires_offline_ack && offlineAck !== true) {
      throw new AppError('Confirm that direct payments are not covered by OxSteed', 422, 'offline_ack_required', { offline_ack: 'required' });
    }
    if (request.to_rail === 'credit' && role !== 'customer' && entry.mode === 'payment') {
      throw new AppError('Only the customer can move this job to OxSteed Credit', 403, 'rail_switch_customer_only');
    }

    // Unwind the old rail.
    if (request.from_rail === 'credit') {
      await creditRail.releasePayment(client, { job, reason: 'rail_switch' });
    }
    if (request.from_rail === 'stripe') {
      const { rows: payments } = await client.query(
        `SELECT * FROM payments WHERE job_id = $1 AND status IN ('pending', 'authorized') FOR UPDATE`,
        [job.id]
      );
      for (const payment of payments) {
        released.push(payment);
        await client.query(
          `UPDATE payments SET status = 'canceled', payment_hold_status = 'released', updated_at = NOW(),
                  metadata = COALESCE(metadata, '{}'::jsonb) || '{"canceledBy":"rail_switch"}'::jsonb
            WHERE id = $1`,
          [payment.id]
        );
      }
      await client.query(
        `UPDATE jobs SET transaction_mode = CASE WHEN transaction_mode = 'guided_protected' THEN 'direct' ELSE transaction_mode END,
                escrow_status = 'none'
          WHERE id = $1`,
        [job.id]
      );
    }

    // Set up the new rail.
    let effective = request.to_rail;
    if (request.to_rail === 'credit' && entry.mode === 'payment') {
      await creditRail.placePaymentHold(client, {
        job, bid: { id: `switch-${request.id}`, helper_id: job.assigned_helper_id }, customer: parties.customer, amountMinor,
        settlementCurrency: options.settlement_currency, fxQuoteId, creditQuoteId,
        platformFeeMinor: Number(job.platform_fee_cents) || 0, isImpersonated,
      });
    } else if (request.to_rail === 'credit') {
      effective = 'stripe';
    } else if (request.to_rail === 'offline') {
      await offlineRail.recordAcceptanceAck(client, { job, amountMinor, currency: options.settlement_currency });
      await client.query(
        `UPDATE offline_payment_confirmations SET helper_ack_not_covered_at = COALESCE(helper_ack_not_covered_at, NOW()) WHERE job_id = $1`,
        [job.id]
      );
    }
    await client.query(
      `UPDATE jobs SET payment_rail = $2, payment_rail_locked_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [job.id, effective]
    );
    await client.query(
      `UPDATE job_rail_switch_requests SET status = 'accepted', responded_by = $2, responded_at = NOW(), offline_ack_responder = $3 WHERE id = $1`,
      [request.id, user.id, offlineAck === true]
    );
    await enqueueJobEvent(client, { jobId: job.id, eventType: EVENT_TYPES.RAIL_SWITCH_RESOLVED, coalesce: false,
      payload: { request_id: String(request.id), status: 'accepted', to_rail: effective } });
    return { status: 'accepted', rail: effective };
  }, 'rail_switch_respond');

  // Release Stripe money after commit (idempotent per payment).
  if (released.length) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    for (const payment of released) {
      await chargeModel.releaseIntent(stripe, {
        intentId: payment.stripe_payment_intent_id,
        model: chargeModel.modelOf(payment),
        stripeAccount: payment.stripe_account_id,
        idempotencyKey: `rail-switch-release:${payment.id}`,
      }).catch((err) => require('../../utils/logger').warn('rail_switch.release_failed', { paymentId: payment.id, error: err.message }));
    }
  }
  return result;
}

async function expireStaleSwitches() {
  const { rowCount } = await pool.query(
    `UPDATE job_rail_switch_requests SET status = 'expired' WHERE status = 'pending' AND expires_at <= NOW()`
  );
  return rowCount || 0;
}

module.exports = { getSwitchState, requestSwitch, respondToSwitch, expireStaleSwitches, SWITCH_TTL_HOURS };
