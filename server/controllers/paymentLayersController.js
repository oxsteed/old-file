'use strict';

/**
 * HTTP surface for the payment layers (docs/payment-layers.md). Every
 * endpoint is inert (404 feature_disabled) while its launch flag is off.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const flags = require('../services/paymentLayerFlags');
const railPolicy = require('../services/paymentRailPolicy');
const paymentRails = require('../services/paymentRails');
const creditRail = require('../services/paymentRails/creditRail');
const offlineRail = require('../services/paymentRails/offlineRail');
const railSwitch = require('../services/paymentRails/railSwitch');
const tips = require('../services/paymentRails/tips');
const cashout = require('../services/creditCashoutService');
const privacy = require('../services/privacyRetentionService');
const payoutPartners = require('../services/payoutPartners');
const { normalizeCountryCode } = require('../validation/countries');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireFlag(flag) {
  if (!flags.isEnabled(flag)) throw new AppError('Not available', 404, 'feature_disabled');
}

function idempotencyKey(req) {
  return req.get?.('Idempotency-Key') || req.body?.idempotency_key || null;
}

/** Public: which layers are on (booleans only) so the client can adapt. */
exports.getConfig = wrap(async (req, res) => {
  res.json({ flags: flags.snapshot() });
});

async function loadCustomerJobAndBid(jobId, bidId, user) {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1 AND deleted_at IS NULL', [jobId]);
  const job = rows[0];
  if (!job || String(job.client_id) !== String(user.id)) throw new AppError('Job not found', 404, 'job_not_found');
  if (!bidId) throw new AppError('bid_id is required', 400, 'validation_failed', { bid_id: 'required' });
  const { rows: bids } = await pool.query('SELECT * FROM bids WHERE id = $1 AND job_id = $2', [bidId, jobId]);
  if (!bids[0]) throw new AppError('Bid not found', 404, 'bid_not_found');
  return { job, bid: bids[0] };
}

/** GET /jobs/:id/options?bid_id= — rails the customer can pay this bid with. */
exports.getPaymentOptions = wrap(async (req, res) => {
  const { job, bid } = await loadCustomerJobAndBid(req.params.id, req.query.bid_id, req.user);
  const parties = await paymentRails.loadParties(pool, { customerId: job.client_id, helperId: bid.helper_id });
  const options = await railPolicy.railOptions(pool, { job, amountMinor: Number(bid.amount_cents), ...parties });
  res.json({ ...options, amount_minor: Number(bid.amount_cents) });
});

/** POST /jobs/:id/credit-quote {bid_id} — FX estimate for paying with Credit (#4, #4b). */
exports.createCreditQuote = wrap(async (req, res) => {
  requireFlag('PAYMENT_RAILS');
  requireFlag('CREDIT_RAIL');
  const { job, bid } = await loadCustomerJobAndBid(req.params.id, req.body?.bid_id, req.user);
  const parties = await paymentRails.loadParties(pool, { customerId: job.client_id, helperId: bid.helper_id });
  const policy = await railPolicy.getCountryPolicy(pool, railPolicy.jobCountry(job, parties.customer));
  const quote = await creditRail.quoteCreditPayment(pool, {
    customer: parties.customer,
    jobId: job.id,
    bidId: bid.id,
    amountMinor: Number(bid.amount_cents),
    settlementCurrency: railPolicy.settlementCurrency({ job }),
    spreadBps: policy ? Number(policy.credit_fx_spread_bps) || 0 : 0,
  });
  res.status(201).json({ quote, estimate: true });
});

exports.getRailSwitch = wrap(async (req, res) => {
  res.json(await railSwitch.getSwitchState(req.params.id, req.user));
});

exports.requestRailSwitch = wrap(async (req, res) => {
  const result = await railSwitch.requestSwitch({
    jobId: req.params.id, user: req.user, toRail: req.body?.to_rail, offlineAck: req.body?.offline_ack === true,
  });
  res.status(201).json(result);
});

exports.respondRailSwitch = wrap(async (req, res) => {
  const result = await railSwitch.respondToSwitch({
    jobId: req.params.id,
    requestId: req.params.requestId,
    user: req.user,
    accept: req.body?.accept === true,
    offlineAck: req.body?.offline_ack === true,
    fxQuoteId: req.body?.fx_quote_id || null,
    creditQuoteId: req.body?.credit_quote_id || null,
    isImpersonated: Boolean(req.isImpersonated),
  });
  res.json(result);
});

exports.getOfflinePayment = wrap(async (req, res) => {
  requireFlag('PAYMENT_RAILS');
  const { rows } = await pool.query('SELECT id, client_id, assigned_helper_id FROM jobs WHERE id = $1', [req.params.id]);
  const job = rows[0];
  if (!job || ![String(job.client_id), String(job.assigned_helper_id)].includes(String(req.user.id))) throw new AppError('Job not found', 404, 'job_not_found');
  res.json({ confirmation: await offlineRail.getConfirmation(pool, job.id) });
});

exports.confirmOfflinePayment = wrap(async (req, res) => {
  requireFlag('PAYMENT_RAILS');
  if (req.body?.acknowledge_not_covered !== true) {
    throw new AppError('Confirm that offline payments are not covered by OxSteed', 400, 'validation_failed', { acknowledge_not_covered: 'required' });
  }
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new AppError('Job not found', 404, 'job_not_found');
  const confirmation = await offlineRail.confirmOfflinePayment(pool, { job: rows[0], user: req.user });
  res.json({ confirmation });
});

exports.listTips = wrap(async (req, res) => {
  requireFlag('TIPS');
  res.json({ tips: await tips.listTips(req.params.id, req.user) });
});

exports.quoteTip = wrap(async (req, res) => {
  res.json(await tips.quoteTip({ jobId: req.params.id, user: req.user, amountMinor: req.body?.amount_minor }));
});

exports.createTip = wrap(async (req, res) => {
  const tip = await tips.createTip({
    jobId: req.params.id, user: req.user, amountMinor: req.body?.amount_minor,
    idempotencyKey: idempotencyKey(req), isImpersonated: Boolean(req.isImpersonated),
  });
  res.status(201).json(tip);
});

exports.getCashoutEligibility = wrap(async (req, res) => {
  res.json(await cashout.eligibility(req.user));
});

exports.listCashouts = wrap(async (req, res) => {
  res.json({ cashouts: await cashout.listCashouts(req.user) });
});

exports.requestCashout = wrap(async (req, res) => {
  const result = await cashout.requestCashout({
    user: req.user, amountMinor: req.body?.amount_minor, destinationId: req.body?.destination_id,
    idempotencyKey: idempotencyKey(req), isImpersonated: Boolean(req.isImpersonated),
    stepupChallengeId: req.body?.stepup_challenge_id || null, stepupCode: req.body?.stepup_code || null,
    requestIp: req.ip || null,
  });
  res.status(201).json({ cashout: result });
});

exports.cancelCashout = wrap(async (req, res) => {
  res.json({ cashout: await cashout.cancelCashout({ user: req.user, cashoutId: req.params.id }) });
});

// Large helper cash-outs need an emailed step-up code (licence readiness §5).
exports.issueCashoutStepup = wrap(async (req, res) => {
  requireFlag('CREDIT_CASHOUT');
  const e = await cashout.getEligibility(require('../db'), req.user.id);
  const amount = Number(req.body?.amount_minor);
  if (!e.currency || !Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Enter an amount', 400, 'validation_failed');
  if (amount < Number(e.stepup_from_minor)) throw new AppError('A code is not needed for this amount', 400, 'credit_stepup_not_required');
  const { issueStepupChallenge } = require('../services/stepupChallengeService');
  const { challenge, delivery } = await issueStepupChallenge({
    actorUserId: req.user.id, actorEmail: req.user.email, actionType: 'helper_cashout', amountCents: amount, currencyCode: e.currency,
  });
  res.status(201).json({ challenge: { id: challenge.id, expiresAt: challenge.expiresAt }, delivery });
});

const destinations = require('../services/creditPayoutDestinationService');

exports.listPayoutDestinations = wrap(async (req, res) => {
  requireFlag('CREDIT_CASHOUT');
  res.json({ destinations: await destinations.listDestinations(req.user), cooling_off_days: destinations.COOLING_OFF_DAYS });
});

exports.addPayoutDestination = wrap(async (req, res) => {
  requireFlag('CREDIT_CASHOUT');
  const b = req.body || {};
  const destination = await destinations.addDestination({
    user: req.user,
    input: {
      countryCode: b.country_code, currencyCode: b.currency_code, holderName: b.holder_name, bankName: b.bank_name,
      bankCode: b.bank_code, accountNumber: b.account_number, verificationMethod: b.verification_method,
    },
    isImpersonated: Boolean(req.isImpersonated),
    requestIp: req.ip || null,
  });
  res.status(201).json({ destination });
});

exports.verifyPayoutDestination = wrap(async (req, res) => {
  requireFlag('CREDIT_CASHOUT');
  const destination = await destinations.verifyDestination({
    user: req.user, destinationId: req.params.id, amounts: req.body?.amounts_minor || null, code: req.body?.code || null,
    isImpersonated: Boolean(req.isImpersonated), requestIp: req.ip || null,
  });
  res.json({ destination });
});

exports.removePayoutDestination = wrap(async (req, res) => {
  requireFlag('CREDIT_CASHOUT');
  res.json({ destination: await destinations.disableDestination({ user: req.user, destinationId: req.params.id, isImpersonated: Boolean(req.isImpersonated) }) });
});

exports.requestErasure = wrap(async (req, res) => {
  const request = await privacy.requestErasure(req.user);
  res.status(202).json({ request: { id: String(request.id), status: request.status, requested_at: request.requested_at } });
});

exports.getErasureStatus = wrap(async (req, res) => {
  res.json({ request: await privacy.getErasureStatus(req.user) });
});

// ── Admin ──────────────────────────────────────────────────────────────────

const POLICY_COLUMNS = {
  enabled: 'boolean', tax_review_cleared: 'boolean', tax_review_note: 'text',
  stripe_rail_enabled: 'boolean', stripe_connect_supported: 'boolean',
  credit_rail_enabled: 'boolean', credit_payment_legal_cleared: 'boolean',
  offline_rail_enabled: 'boolean', local_methods_legal_cleared: 'boolean', local_payment_methods: 'text[]',
  platform_hold_legal_cleared: 'boolean', card_auth_window_days: 'int',
  platform_fee_bps: 'int', platform_fee_min_minor: 'int', credit_fee_discount_bps: 'int',
  tip_processing_bps: 'int', tip_processing_fixed_minor: 'int', offline_first_job_cap_minor: 'int',
  credit_fx_spread_bps: 'int', cashout_partner: 'text', cashout_hold_days: 'int',
  cashout_daily_cap_minor: 'int', cashout_monthly_cap_minor: 'int', sms_sender_id: 'text',
};

function coerce(type, value, key) {
  if (value === null) return null;
  const bad = () => { throw new AppError(`Invalid ${key}`, 400, 'validation_failed', { [key]: 'invalid' }); };
  if (type === 'boolean') return typeof value === 'boolean' ? value : bad();
  if (type === 'int') return Number.isSafeInteger(value) && value >= 0 ? value : bad();
  if (type === 'text[]') return Array.isArray(value) && value.every((v) => typeof v === 'string' && /^[a-z0-9_]{1,40}$/.test(v)) ? value : bad();
  return typeof value === 'string' ? value.slice(0, 500) : bad();
}

exports.adminListPolicies = wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM payment_country_policies ORDER BY country_code');
  res.json({ policies: rows, flags: flags.snapshot() });
});

exports.adminUpdatePolicy = wrap(async (req, res) => {
  const code = normalizeCountryCode(String(req.params.code || ''));
  if (!code) throw new AppError('Unknown country', 400, 'validation_failed', { country_code: 'invalid' });
  const body = req.body || {};
  const sets = [];
  const params = [code];
  for (const [key, type] of Object.entries(POLICY_COLUMNS)) {
    if (!(key in body)) continue;
    params.push(coerce(type, body[key], key));
    sets.push(`${key} = $${params.length}${type === 'text[]' ? '::text[]' : ''}`);
  }
  if (!sets.length) throw new AppError('Nothing to update', 400, 'validation_failed');
  if (body.credit_fx_spread_bps != null && body.credit_fx_spread_bps > 100) {
    throw new AppError('Credit FX spread is capped at 1%', 400, 'validation_failed', { credit_fx_spread_bps: 'max_100' });
  }
  if (body.cashout_partner && !payoutPartners.getPartner(body.cashout_partner)) {
    throw new AppError('Unknown payout partner', 400, 'validation_failed', { cashout_partner: 'unknown' });
  }
  const { rows: current } = await pool.query('SELECT * FROM payment_country_policies WHERE country_code = $1', [code]);
  if (!current[0]) throw new AppError('Country policy not found', 404, 'not_found');
  const next = { ...current[0], ...body };
  // Decision #13: a country cannot go live before its tax review clears.
  if (next.enabled === true && next.tax_review_cleared !== true) {
    throw new AppError('Clear the country tax review before enabling it', 409, 'country_tax_review_pending');
  }
  params.push(req.user?.id || null);
  sets.push(`updated_by = $${params.length}`, 'updated_at = NOW()');
  const { rows } = await pool.query(
    `UPDATE payment_country_policies SET ${sets.join(', ')} WHERE country_code = $1 RETURNING *`,
    params
  );
  railPolicy.clearPolicyCache();
  res.json({ policy: rows[0] });
});

exports.adminListPartners = wrap(async (req, res) => {
  res.json({ partners: payoutPartners.listPartners() });
});
