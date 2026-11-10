'use strict';

// Careers vendor webhooks (Checkr, EOR partner, Stripe). Mounted in
// index.js with express.raw() before express.json() so signatures are
// checked over the exact bytes. Each provider is off until configured;
// an unconfigured or badly signed call gets 401/503 and changes nothing.

const pool = require('../../db');
const logger = require('../../utils/logger');
const { withTransaction } = require('../../utils/transaction');
const checkrProvider = require('../../services/careers/providers/checkr');
const eorProvider = require('../../services/careers/providers/eor');
const billingProvider = require('../../services/careers/providers/billing');
const { checkrConfig, eorConfig, billingConfig, plansConfig } = require('../../services/careers/providers/config');
const checks = require('../../services/careers/backgroundChecks');
const offers = require('../../services/careers/offers');
const onboarding = require('../../services/careers/onboardingRun');
const billing = require('../../services/careers/billing');
const plans = require('../../services/careers/marketplace/plans');

function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return null;
}

function parseJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

async function runAfterCommit(runId) {
  if (!runId) return;
  await onboarding.executeRun(runId).catch((err) => logger.error('careers: onboarding run after webhook failed', { runId, error: err.message }));
}

exports.checkr = async (req, res) => {
  if (!checkrConfig().webhookSecret) return res.status(503).json({ error: 'Not configured', code: 'provider_not_configured' });
  const body = rawBody(req);
  if (!checkrProvider.verifyWebhook(body, req.get('X-Checkr-Signature'))) return res.status(401).json({ error: 'Invalid signature' });
  const event = parseJson(body);
  if (!event) return res.status(400).json({ error: 'Invalid JSON' });
  try {
    const result = await withTransaction(pool, (c) => checks.applyWebhook(c, event, {
      finalize: (db, args) => offers.finalizeHire(db, { ...args, startRun: onboarding.startRun }),
    }), 'career_checkr_webhook');
    await runAfterCommit(result.hire?.runId);
    return res.json({ received: true, duplicate: Boolean(result.duplicate), ignored: Boolean(result.ignored) });
  } catch (err) {
    logger.error('careers: checkr webhook failed', { type: event.type, error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

exports.eor = async (req, res) => {
  if (!eorConfig().webhookSecret) return res.status(503).json({ error: 'Not configured', code: 'provider_not_configured' });
  const body = rawBody(req);
  if (!eorProvider.verifyWebhook(body, req.get('X-EOR-Signature') || req.get('X-Signature'))) return res.status(401).json({ error: 'Invalid signature' });
  const event = parseJson(body);
  const mapped = event && eorProvider.mapEvent(event);
  if (!mapped) return res.json({ received: true, ignored: true });
  try {
    const assignment = await withTransaction(pool, (c) => onboarding.applyEorStatus(c, mapped), 'career_eor_webhook');
    return res.json({ received: true, ignored: !assignment });
  } catch (err) {
    logger.error('careers: eor webhook failed', { error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

exports.stripe = async (req, res) => {
  // One signed endpoint serves boosts/hiring events (CAREERS_BILLING_ENABLED)
  // and employer plans (CAREERS_PLANS_ENABLED); each stays off on its own.
  const boosts = billingConfig();
  const subs = plansConfig();
  if (!(boosts.configured || subs.configured) || !(boosts.webhookSecret || subs.webhookSecret)) {
    return res.status(503).json({ error: 'Not configured', code: 'provider_not_configured' });
  }
  let event;
  try {
    event = boosts.configured
      ? billingProvider.constructEvent(rawBody(req), req.get('Stripe-Signature'))
      // eslint-disable-next-line global-require
      : require('stripe')(subs.stripeKey).webhooks.constructEvent(rawBody(req), req.get('Stripe-Signature'), subs.webhookSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  try {
    if (plans.isPlanEvent(event)) {
      if (!subs.configured) return res.json({ received: true, ignored: true });
      const result = await withTransaction(pool, (c) => plans.applyStripeEvent(c, event), 'career_plan_webhook');
      return res.json({ received: true, ignored: Boolean(result.ignored), duplicate: Boolean(result.duplicate) });
    }
    if (!boosts.configured) return res.json({ received: true, ignored: true });
    const result = await withTransaction(pool, (c) => billing.applyStripeEvent(c, event), 'career_stripe_webhook');
    return res.json({ received: true, ignored: Boolean(result.ignored) });
  } catch (err) {
    logger.error('careers: stripe webhook failed', { type: event.type, error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
