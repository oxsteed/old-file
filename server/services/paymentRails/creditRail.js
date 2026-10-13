'use strict';

/**
 * OxSteed Credit as the payment rail (decisions #3 #4 #4b).
 *
 * Where a country's policy has credit_payment_legal_cleared, the Credit hold
 * IS the payment: it is placed in the job's settlement currency (the
 * helper's currency) at acceptance and captured to the helper's Credit
 * partner ledger on completion, with the platform fee posted to platform
 * revenue. Elsewhere Credit stays escrow collateral behind the Stripe rail
 * (the existing behaviour in jobController.assignHelper).
 *
 * If the customer's Credit is in another currency, they first accept a
 * disclosed FX quote (spread ≤ 1%, charged as the conversion fee). The quote
 * is consumed through the existing ledger-correct conversion service, then
 * the hold is placed in the settlement currency.
 */

const crypto = require('crypto');
const { AppError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const money = require('../../validation/money');

const QUOTE_TTL_MINUTES = 15;
const MAX_SPREAD_BPS = 100;

function lazy() {
  return {
    spend: require('../creditSpendAdapter'),
    conversion: require('../oxsteedCreditCurrencyConversionService'),
    fx: require('../fxRateProvider'),
    credit: require('../oxsteedCreditService'),
    changeOrder: require('../jobChangeOrderFinance'),
  };
}

function supportedCreditCurrency(code) {
  try {
    return lazy().credit.assertSupportedCreditCurrency(code);
  } catch {
    return null;
  }
}

/**
 * Smallest source amount whose converted value covers `targetMinor`.
 * Rates are per MAJOR unit; minor-unit exponents are applied here.
 */
function sourceForTarget(targetMinor, from, to, rateNumerator, rateDenominator) {
  let source = money.convertMinor(targetMinor, to, from, rateDenominator, rateNumerator, 'up');
  if (source === null) return null;
  for (let i = 0; i < 4 && money.convertMinor(source, from, to, rateNumerator, rateDenominator) < targetMinor; i += 1) source += 1;
  return source;
}

/** Rate scaled for minor units, as the conversion service expects. */
function minorRate(from, to, rateNumerator, rateDenominator) {
  const shift = money.currencyExponent(to) - money.currencyExponent(from);
  let num = BigInt(rateNumerator);
  let den = BigInt(rateDenominator);
  if (shift > 0) num *= 10n ** BigInt(shift);
  if (shift < 0) den *= 10n ** BigInt(-shift);
  return { num: num.toString(), den: den.toString() };
}

/**
 * Quote what the customer pays (in their Credit currency) for a job price in
 * the settlement currency. Returns { fx: false } when no conversion is needed.
 */
async function quoteCreditPayment(client, { customer, jobId, bidId = null, amountMinor, settlementCurrency, spreadBps = MAX_SPREAD_BPS }) {
  const target = money.normalizeCurrency(settlementCurrency);
  const source = supportedCreditCurrency(customer?.preferred_currency || 'USD') || 'USD';
  if (!target || !supportedCreditCurrency(target)) {
    throw new AppError('OxSteed Credit is not available in this currency', 409, 'credit_currency_unsupported');
  }
  if (source === target) return { fx: false, currency: target, amount_minor: amountMinor };
  const spread = Math.max(0, Math.min(MAX_SPREAD_BPS, Number(spreadBps) || 0));
  const rate = await lazy().fx.getFxQuote(source, target);
  const base = sourceForTarget(amountMinor, source, target, rate.rateNumerator, rate.rateDenominator);
  if (!base) throw new AppError('Currency conversion is unavailable right now', 503, 'credit_fx_unavailable');
  const fee = money.bpsOf(base, spread, 'up');
  const scaled = minorRate(source, target, rate.rateNumerator, rate.rateDenominator);
  const targetAmount = money.convertMinor(base, source, target, rate.rateNumerator, rate.rateDenominator);
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000);
  const { quote } = await lazy().conversion.createCurrencyQuote({
    sourceCurrencyCode: source,
    targetCurrencyCode: target,
    sourceAmountMinorUnits: base,
    targetAmountMinorUnits: targetAmount,
    feeAmountMinorUnits: fee,
    rateNumerator: scaled.num,
    rateDenominator: scaled.den,
    roundingMode: 'half_up',
    provider: rate.provider,
    providerQuoteReference: `${rate.provider}:${source}:${target}:${rate.quotedAt}`,
    expiresAt,
    idempotencyKey: `job-credit-fx:${jobId}:${crypto.randomUUID()}`,
    actorUserId: customer.id,
    customerId: customer.id,
    reason: 'Job payment with OxSteed Credit',
    metadata: { jobId: String(jobId), bidId: bidId ? String(bidId) : null, spreadBps: spread },
  });
  const { rows } = await client.query(
    `INSERT INTO payment_fx_quotes
       (user_id, job_id, bid_id, purpose, source_currency, target_currency, source_amount_minor,
        target_amount_minor, rate_numerator, rate_denominator, spread_bps, provider, quoted_at, expires_at)
     VALUES ($1, $2, $3, 'credit_payment', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [customer.id, jobId, bidId, source, target, base + fee, targetAmount, String(rate.rateNumerator), String(rate.rateDenominator),
      spread, rate.provider, rate.quotedAt, expiresAt]
  );
  return {
    fx: true,
    quote_id: rows[0].id,
    credit_quote_id: String(quote.id),
    source_currency: source,
    target_currency: target,
    source_amount_minor: base,
    fee_minor: fee,
    total_source_minor: base + fee,
    target_amount_minor: targetAmount,
    spread_bps: spread,
    rate: { numerator: String(rate.rateNumerator), denominator: String(rate.rateDenominator) },
    expires_at: expiresAt.toISOString(),
  };
}

async function consumeQuote(client, { quoteId, creditQuoteId, customer, jobId, settlementCurrency, amountMinor, isImpersonated }) {
  const { rows } = await client.query(
    `SELECT * FROM payment_fx_quotes WHERE id = $1 AND user_id = $2 AND job_id = $3 FOR UPDATE`,
    [quoteId, customer.id, jobId]
  );
  const quote = rows[0];
  if (!quote) throw new AppError('Currency quote not found. Review the converted amount again.', 409, 'credit_fx_quote_required');
  if (quote.consumed_at) throw new AppError('This currency quote was already used', 409, 'credit_fx_quote_used');
  if (new Date(quote.expires_at) <= new Date()) throw new AppError('The currency quote expired. Review the new amount.', 409, 'credit_fx_quote_expired');
  if (quote.target_currency !== settlementCurrency || Number(quote.target_amount_minor) < amountMinor) {
    throw new AppError('The currency quote no longer covers this price', 409, 'credit_fx_quote_mismatch');
  }
  if (isImpersonated) throw new AppError('Impersonated sessions cannot spend OxSteed Credit', 403, 'impersonation_blocked');
  await lazy().conversion.convertCustomerCreditInTransaction(client, {
    customerId: customer.id,
    quoteId: creditQuoteId,
    sourceAmountMinorUnits: Number(quote.source_amount_minor) - feeFromTotal(quote),
    idempotencyKey: `job-credit-fx-convert:${quote.id}`,
    actorUserId: customer.id,
    metadata: { jobId: String(jobId), paymentFxQuoteId: String(quote.id) },
  });
  await client.query('UPDATE payment_fx_quotes SET consumed_at = NOW() WHERE id = $1', [quote.id]);
  return quote;
}

/** total = base + ceil(base * spread / 10000); recover base from the stored total. */
function feeFromTotal(quote) {
  const total = Number(quote.source_amount_minor);
  const spread = Number(quote.spread_bps);
  let base = Math.floor((total * 10000) / (10000 + spread));
  while (base + money.bpsOf(base, spread, 'up') < total) base += 1;
  while (base > 0 && base + money.bpsOf(base, spread, 'up') > total) base -= 1;
  return total - base;
}

/**
 * Place the Credit payment hold at acceptance (inside assignHelper's
 * transaction). Fail-closed: insufficient Credit rolls the hire back.
 */
async function placePaymentHold(client, { job, bid, customer, amountMinor, settlementCurrency, fxQuoteId = null, creditQuoteId = null, platformFeeMinor = 0, isImpersonated = false }) {
  let fxQuote = null;
  const customerCurrency = supportedCreditCurrency(customer?.preferred_currency || 'USD') || 'USD';
  if (customerCurrency !== settlementCurrency) {
    if (!fxQuoteId || !creditQuoteId) throw new AppError('Review the converted amount before paying with Credit', 409, 'credit_fx_quote_required');
    fxQuote = await consumeQuote(client, { quoteId: fxQuoteId, creditQuoteId, customer, jobId: job.id, settlementCurrency, amountMinor, isImpersonated });
  }
  const hold = await lazy().spend.spendWithCredit({
    client,
    participantRef: { type: 'helper', subjectId: String(bid.helper_id) },
    customerId: String(customer.id),
    amountCents: amountMinor,
    currency: settlementCurrency,
    surface: 'jobs',
    mode: 'hold',
    referenceType: 'job_payment',
    referenceId: String(job.id),
    idempotencyKey: `credit-spend:jobs:job_payment:${job.id}:${bid.id}`,
    isImpersonated,
    metadata: { bidId: String(bid.id), jobTitle: job.title, fxQuoteId: fxQuote ? String(fxQuote.id) : null },
  });
  const holdId = hold.hold?.id || null;
  if (!holdId) throw new AppError('Credit hold could not be placed', 409, 'credit_hold_failed');
  await client.query(
    `INSERT INTO job_credit_payments
       (job_id, customer_id, helper_id, credit_hold_id, amount_minor, currency, settlement_amount_minor,
        settlement_currency, fx_quote_id, platform_fee_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8)`,
    [job.id, customer.id, bid.helper_id, holdId, amountMinor, settlementCurrency, fxQuote?.id || null, platformFeeMinor]
  );
  await client.query(
    `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [job.id, JSON.stringify({ creditPaymentHoldId: holdId, creditPaymentKey: hold.idempotencyKey })]
  );
  return { holdId };
}

/** A change order replaced the hold (jobChangeOrderFinance). */
async function supersedePaymentHold(client, { jobId, oldHoldId, newHoldId, amountMinor, currency }) {
  const { rows } = await client.query(
    `UPDATE job_credit_payments SET status = 'superseded', released_at = NOW(), updated_at = NOW()
      WHERE job_id = $1 AND credit_hold_id = $2 AND status = 'held' RETURNING *`,
    [jobId, oldHoldId]
  );
  const prev = rows[0];
  if (!prev || !newHoldId) return;
  await client.query(
    `INSERT INTO job_credit_payments
       (job_id, customer_id, helper_id, credit_hold_id, amount_minor, currency, settlement_amount_minor,
        settlement_currency, platform_fee_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7)`,
    [jobId, prev.customer_id, prev.helper_id, newHoldId, amountMinor, currency, prev.platform_fee_minor]
  );
}

async function activePayment(client, jobId) {
  const { rows } = await client.query(
    `SELECT * FROM job_credit_payments WHERE job_id = $1 AND status = 'held' FOR UPDATE`,
    [jobId]
  );
  return rows[0] || null;
}

/**
 * Completion: capture the hold to the helper's partner ledger and post the
 * platform fee. Idempotent through the hold capture key.
 */
async function capturePayment(client, { job, actorUserId }) {
  const payment = await activePayment(client, job.id);
  if (!payment) throw new AppError('No Credit payment is held for this job', 409, 'credit_payment_missing');
  const amount = Number(job.job_value_cents) || Number(payment.amount_minor);
  const finalAmount = Math.min(amount, Number(payment.amount_minor));
  const capture = await lazy().spend.finalizeCreditSpendInTransaction(client, {
    holdId: payment.credit_hold_id,
    finalAmountCents: finalAmount,
    currencyCode: payment.currency,
    idempotencyKey: `credit-finalize:job_payment:${job.id}`,
    actorUserId,
    actorType: 'customer',
    referenceType: 'job_payment',
    referenceId: String(job.id),
    description: 'Job payment captured',
  });
  const fee = Math.min(finalAmount, Number(job.platform_fee_cents ?? payment.platform_fee_minor) || 0);
  if (fee > 0) await postPlatformFee(client, { job, payment, fee });
  await client.query(
    `UPDATE job_credit_payments SET status = 'captured', captured_at = NOW(), platform_fee_minor = $2, updated_at = NOW() WHERE id = $1`,
    [payment.id, fee]
  );
  logger.info('credit_rail.captured', { jobId: job.id, amount: finalAmount, fee });
  return { capture, amount: finalAmount, fee };
}

async function postPlatformFee(client, { job, payment, fee }) {
  const { credit } = lazy();
  const { rows } = await client.query('SELECT partner_id FROM oxsteed_credit_holds WHERE id = $1', [payment.credit_hold_id]);
  const partnerId = rows[0]?.partner_id;
  if (!partnerId) return;
  const payable = await credit.ensureAccount(client, { accountType: 'partner_payable', partnerId, currencyCode: payment.currency });
  const revenue = await credit.ensureAccount(client, { accountType: 'platform_revenue', currencyCode: payment.currency });
  await credit.postJournalTransaction(client, {
    transactionType: 'fee',
    debitAccountId: payable.id,
    creditAccountId: revenue.id,
    amountCents: fee,
    currencyCode: payment.currency,
    partnerId,
    idempotencyKey: `job-credit-fee:${job.id}`,
    actorType: 'system',
    actorUserId: null,
    referenceType: 'job_payment_fee',
    referenceId: String(job.id),
    description: 'OxSteed platform fee (Credit job payment)',
    metadata: { jobId: String(job.id) },
  });
}

/** Cancellation / rail switch: release the hold back to the customer. */
async function releasePayment(client, { job, reason }) {
  const payment = await activePayment(client, job.id);
  if (!payment) return { released: false };
  await lazy().changeOrder.releaseCollateralHold(client, payment.credit_hold_id, job.id, reason);
  await client.query(
    `UPDATE job_credit_payments SET status = 'released', released_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [payment.id]
  );
  await client.query(
    `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) - 'creditPaymentHoldId' - 'creditPaymentKey' WHERE id = $1`,
    [job.id]
  );
  return { released: true };
}

module.exports = {
  QUOTE_TTL_MINUTES,
  MAX_SPREAD_BPS,
  supportedCreditCurrency,
  sourceForTarget,
  minorRate,
  quoteCreditPayment,
  placePaymentHold,
  supersedePaymentHold,
  capturePayment,
  releasePayment,
  activePayment,
  feeFromTotal,
};
