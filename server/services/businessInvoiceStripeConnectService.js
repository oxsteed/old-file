'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveBusinessInvoiceConnect } = require('./stripeConnectSoTService');
const {
  invoiceBalanceCents,
  stripeInvoiceCurrency,
  round2,
  businessInvoiceStripeConnectEnabled,
  PAYABLE_INVOICE_STATUSES,
  isInvoicePayer,
} = require('../utils/businessInvoiceHelpers');

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

function normalizeAccountId(value) {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
}

function connectReady({ accountId, chargesEnabled, accountStatus }) {
  const status = String(accountStatus || '').toLowerCase();
  if (status === 'restricted' || status === 'rejected') return false;
  return Boolean(accountId && chargesEnabled);
}

/**
 * Resolve the Stripe Connect account that should receive invoice card funds.
 * Business invoices: businesses.stripe_account_id (Standard OAuth), then
 * restaurant_connect_accounts for the same business_id (dual-write fallback).
 * Helper invoices: connect_accounts for issuer user_id (Express).
 */
async function resolveInvoiceStripeConnectDestination(invoice, client = pool) {
  const db = client || pool;

  if (invoice.business_id) {
    const resolved = await resolveBusinessInvoiceConnect(db, invoice.business_id);
    if (resolved.reason === 'stripe_connect_accounts_mismatch') {
      return { ...resolved, ready: false };
    }
    const candidate = {
      accountId: resolved.accountId,
      chargesEnabled: resolved.chargesEnabled,
      payoutsEnabled: resolved.payoutsEnabled,
      accountStatus: resolved.accountStatus,
      source: resolved.source,
      payeeKind: resolved.payeeKind,
    };
    if (connectReady(candidate)) return candidate;
    if (candidate.accountId && !candidate.chargesEnabled) {
      return { ...candidate, ready: false, reason: 'charges_disabled' };
    }
    return {
      ...candidate,
      ready: false,
      reason: resolved.reason || 'no_connect_account',
    };
  }

  const issuerId = invoice.user_id;
  if (!issuerId) {
    return {
      accountId: null,
      ready: false,
      reason: 'no_issuer',
      payeeKind: 'helper',
    };
  }

  const { rows: caRows } = await db.query(
    `SELECT stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete
       FROM connect_accounts
      WHERE user_id = $1
      LIMIT 1`,
    [issuerId],
  );
  const ca = caRows[0];
  if (!ca) {
    return {
      accountId: null,
      ready: false,
      reason: 'no_connect_account',
      payeeKind: 'helper',
      source: null,
    };
  }
  const candidate = {
    accountId: normalizeAccountId(ca.stripe_account_id),
    chargesEnabled: Boolean(ca.charges_enabled),
    payoutsEnabled: Boolean(ca.payouts_enabled),
    accountStatus: ca.charges_enabled ? 'active' : 'pending',
    source: 'helper_express',
    payeeKind: 'helper',
  };
  if (connectReady(candidate)) return candidate;
  return {
    ...candidate,
    ready: false,
    reason: candidate.accountId ? 'charges_disabled' : 'no_connect_account',
  };
}

function assertConnectDestinationReady(connect) {
  if (connect?.reason === 'stripe_connect_accounts_mismatch') {
    throw new AppError(
      'Stripe Connect is configured differently for this business and its restaurant. Align accounts in Business Hub or food merchant settings before accepting card payments.',
      409,
      'stripe_connect_accounts_mismatch',
      { divergence: connect.divergence || null },
    );
  }
  if (!connect || !connect.accountId) {
    throw new AppError(
      'The invoice issuer has not connected Stripe for card payments.',
      503,
      'invoice_payee_stripe_not_connected',
    );
  }
  if (!connect.chargesEnabled) {
    throw new AppError(
      'Stripe Connect onboarding is incomplete. Card payments are not available until charges are enabled.',
      503,
      'invoice_payee_stripe_not_ready',
      { accountStatus: connect.accountStatus || 'pending' },
    );
  }
  return connect;
}

function invoiceCardApplicationFeeCents(amountCents) {
  const feeBps = Math.max(0, Math.min(10000, Number(process.env.INVOICE_CARD_FEE_BPS ?? process.env.FOOD_CARD_FEE_BPS ?? 0) || 0));
  return Math.floor(amountCents * feeBps / 10000);
}

function buildDestinationChargeParams({
  invoice,
  connect,
  payerUserId,
  amountCents,
  currency,
  idempotencyKey,
}) {
  const applicationFeeAmount = invoiceCardApplicationFeeCents(amountCents);
  return {
    amount: amountCents,
    currency: currency.toLowerCase(),
    transfer_data: { destination: connect.accountId },
    ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
    metadata: {
      business_invoice_payment: 'true',
      invoice_id: String(invoice.id),
      payer_id: String(payerUserId),
      invoice_type: invoice.business_id ? 'business_invoice' : 'helper_invoice',
      connect_account_id: connect.accountId,
      connect_source: connect.source || '',
      idempotency_key: String(idempotencyKey || '').slice(0, 160),
    },
  };
}

function paymentIntentDestinationId(paymentIntent) {
  return normalizeAccountId(paymentIntent?.transfer_data?.destination);
}

function assertPaymentIntentMatchesInvoice({
  paymentIntent,
  invoice,
  payerUserId,
  connect,
  expectedAmountCents,
}) {
  const currency = stripeInvoiceCurrency(invoice);
  const actualAmountCents = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
  const destination = paymentIntentDestinationId(paymentIntent);

  if (String(paymentIntent.metadata?.invoice_id || '') !== String(invoice.id)) {
    throw new AppError('Payment does not belong to this invoice', 403, 'payment_invoice_mismatch');
  }
  if (String(paymentIntent.metadata?.payer_id || '') !== String(payerUserId)) {
    throw new AppError('Payment does not belong to this invoice', 403, 'payment_invoice_mismatch');
  }
  if (paymentIntent.metadata?.business_invoice_payment !== 'true') {
    throw new AppError('Payment is not an invoice Connect charge', 403, 'payment_invoice_mismatch');
  }
  if (destination !== connect.accountId) {
    throw new AppError(
      'Payment was not directed to the issuer Connect account',
      403,
      'payment_connect_destination_mismatch',
    );
  }
  if (actualAmountCents !== expectedAmountCents) {
    throw new AppError('Payment amount does not match the invoice balance', 403, 'payment_invoice_mismatch');
  }
  if (String(paymentIntent.currency || '').toLowerCase() !== currency) {
    throw new AppError('Payment currency does not match the invoice', 403, 'payment_invoice_mismatch');
  }
  if (paymentIntent.status !== 'succeeded') {
    return { ok: false, status: paymentIntent.status };
  }
  return { ok: true };
}

async function applyInvoiceCardPayment(client, { invoiceId, amountDollars }) {
  const { rows: [locked] } = await client.query(
    `SELECT * FROM business_invoices WHERE id = $1 FOR UPDATE`,
    [invoiceId],
  );
  if (!locked) return null;

  const totalCents = Math.round(Number(locked.total || 0) * 100);
  const payCents = Math.round(Number(amountDollars || 0) * 100);
  const currentPaidCents = Math.round(Number(locked.amount_paid || 0) * 100);
  const targetPaidCents = Math.min(totalCents, currentPaidCents + payCents);
  const targetPaid = round2(targetPaidCents / 100);

  if (targetPaidCents <= currentPaidCents) {
    return locked;
  }

  const isFullyPaid = targetPaidCents >= totalCents - 1;
  const newStatus = isFullyPaid ? 'paid' : 'partial';

  const { rows: [updated] } = await client.query(
    `UPDATE business_invoices
        SET amount_paid = $1::numeric(12,2),
            status = $2::varchar(20),
            paid_at = CASE WHEN $2::varchar(20) = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
            updated_at = NOW()
      WHERE id = $3::bigint
      RETURNING *`,
    [targetPaid, newStatus, invoiceId],
  );
  return updated;
}

async function applyBusinessInvoicePaymentFromWebhook(client, paymentIntent) {
  if (paymentIntent?.metadata?.business_invoice_payment !== 'true') return false;
  const invoiceId = paymentIntent.metadata?.invoice_id;
  if (!invoiceId) return false;

  const { rows: [invoice] } = await client.query(
    `SELECT * FROM business_invoices WHERE id = $1 FOR UPDATE`,
    [invoiceId],
  );
  if (!invoice) return true;

  const balanceCents = invoiceBalanceCents(invoice);
  if (balanceCents <= 0) {
    return true;
  }

  const connect = await resolveInvoiceStripeConnectDestination(invoice, client);
  try {
    assertConnectDestinationReady(connect);
    const check = assertPaymentIntentMatchesInvoice({
      paymentIntent,
      invoice,
      payerUserId: paymentIntent.metadata?.payer_id,
      connect,
      expectedAmountCents: balanceCents,
    });
    if (!check.ok) return true;
  } catch (err) {
    logger.error('[Stripe] Business invoice card webhook could not apply payment', {
      paymentIntentId: paymentIntent.id,
      invoiceId: invoice.id,
      error: err.message,
      code: err.code,
    });
    throw err;
  }

  const amountPaid = balanceCents / 100;
  await applyInvoiceCardPayment(client, { invoiceId: invoice.id, amountDollars: amountPaid });
  return true;
}

async function evaluateInvoiceCardEligibility(invoice, user) {
  if (!businessInvoiceStripeConnectEnabled()) {
    return {
      eligible: false,
      code: 'invoice_card_pay_disabled',
      launchHidden: true,
    };
  }
  if (!invoice || !isInvoicePayer(invoice, user)) {
    return { eligible: false, code: 'invoice_not_found' };
  }
  const status = String(invoice.status || '').toLowerCase();
  if (!PAYABLE_INVOICE_STATUSES.has(status)) {
    return { eligible: false, code: 'invoice_not_payable', status };
  }
  const balanceCents = invoiceBalanceCents(invoice);
  if (balanceCents <= 0) {
    return { eligible: false, code: 'invoice_already_paid' };
  }
  const currency = stripeInvoiceCurrency(invoice);
  if (currency !== 'usd') {
    return { eligible: false, code: 'invoice_currency_not_supported', currency };
  }
  const connect = await resolveInvoiceStripeConnectDestination(invoice);
  if (!connect.accountId || !connect.chargesEnabled) {
    return {
      eligible: false,
      code: connect.reason || 'invoice_payee_stripe_not_ready',
      payeeKind: connect.payeeKind,
      connectSource: connect.source || null,
      accountStatus: connect.accountStatus || null,
    };
  }
  return {
    eligible: true,
    balanceCents,
    currency: 'USD',
    payeeKind: connect.payeeKind,
    connectSource: connect.source,
  };
}

async function createOrReuseInvoicePaymentIntent({
  invoice,
  payerUserId,
  idempotencyKey,
}) {
  if (!stripe) {
    throw new AppError('Stripe payments are not configured', 503, 'stripe_not_configured');
  }

  const connect = assertConnectDestinationReady(
    await resolveInvoiceStripeConnectDestination(invoice),
  );

  const balanceCents = invoiceBalanceCents(invoice);
  if (balanceCents <= 0 || invoice.status === 'paid') {
    throw new AppError('Invoice is already paid', 409, 'invoice_already_paid');
  }

  const currency = stripeInvoiceCurrency(invoice);
  if (currency !== 'usd') {
    throw new AppError('Only USD invoices can be paid online', 422, 'invoice_currency_not_supported');
  }

  const key = String(idempotencyKey || `invoice-card:${invoice.id}:${payerUserId}:${balanceCents}`).slice(0, 160);

  if (invoice.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(invoice.stripe_payment_intent_id);
      const dest = paymentIntentDestinationId(existing);
      const sameDestination = dest === connect.accountId;
      const sameAmount = Number(existing.amount) === balanceCents;
      const reusable = !['succeeded', 'canceled'].includes(existing.status);
      if (reusable && sameDestination && sameAmount) {
        return {
          paymentIntent: existing,
          connect,
          balanceCents,
          reused: true,
        };
      }
      if (reusable) {
        try {
          await stripe.paymentIntents.cancel(invoice.stripe_payment_intent_id);
        } catch {
          /* intent may already be canceled or uncancelable */
        }
      }
    } catch {
      /* create fresh intent below */
    }
  }

  const params = buildDestinationChargeParams({
    invoice,
    connect,
    payerUserId,
    amountCents: balanceCents,
    currency,
    idempotencyKey: key,
  });

  const paymentIntent = await stripe.paymentIntents.create(params, {
    idempotencyKey: `business-invoice-pi:${invoice.id}:${key}`,
  });

  await pool.query(
    `UPDATE business_invoices
        SET stripe_payment_intent_id = $2,
            stripe_connect_account_id = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [invoice.id, paymentIntent.id, connect.accountId],
  );

  return { paymentIntent, connect, balanceCents, reused: false };
}

module.exports = {
  resolveInvoiceStripeConnectDestination,
  assertConnectDestinationReady,
  buildDestinationChargeParams,
  assertPaymentIntentMatchesInvoice,
  applyInvoiceCardPayment,
  applyBusinessInvoicePaymentFromWebhook,
  createOrReuseInvoicePaymentIntent,
  evaluateInvoiceCardEligibility,
  paymentIntentDestinationId,
};
