'use strict';
/**
 * OxSteed Logistics — Phase 3 payment plumbing (server-side money logic).
 *
 * Scope: durable payment attempts, server-computed amounts (integer cents,
 * USD only), Stripe PaymentIntent creation, signed-webhook settlement,
 * and the reconciliation queue. OxSteed Credit execution is owned by the
 * parallel Credit workstream; this module only records credit-method
 * attempts and exposes settleCreditAttempt() as the integration seam.
 *
 * Money rules enforced here (fail closed):
 *  - Integer minor units everywhere. No float math on money.
 *  - Client-supplied amounts are NEVER trusted; the expected amount is
 *    computed server-side from the accepted quote minus verified paid
 *    amounts. A mismatch is rejected, never adjusted.
 *  - Only a signature-verified Stripe webhook may mark an attempt
 *    'succeeded'. Browser redirects / client-reported success cannot.
 *  - Re-verify before re-paying: settling re-reads the attempt row under
 *    SELECT FOR UPDATE and refuses terminal-state or amount mismatches.
 *  - Everything new-payment related is gated on LOGISTICS_PAYMENTS_ENABLED
 *    (default off); see middleware/requireLogisticsPayments.
 */
const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');

const INSTALLMENTS = new Set(['deposit', 'final']);
const METHODS = new Set(['stripe', 'credit']);
const SUBJECT_TYPES = new Set(['purchase_order', 'pooled_participant']);

/** Roles allowed to see any buyer's attempt / manage the recon queue. */
const STAFF_ROLES = new Set(['admin', 'super_admin', 'logistics_coordinator']);

/** Attempts stuck in a non-terminal state longer than this get reconciled. */
const STUCK_TIMEOUT_MINUTES = 30;

/** Stripe's minimum for a USD card charge, in cents. */
const STRIPE_USD_MINIMUM_CENTS = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLogisticsPaymentsEnabled() {
  return String(process.env.LOGISTICS_PAYMENTS_ENABLED || '').trim().toLowerCase() === 'true';
}

function isStaffRole(role) {
  return STAFF_ROLES.has(role);
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new AppError('Stripe is not configured', 503, 'stripe_not_configured');
  }
  return require('stripe')(key);
}

function toCents(floatUsd) {
  const n = Number(floatUsd);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Public view of an attempt: never expose internal failure detail. */
function publicAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    idempotency_key: row.idempotency_key,
    buyer_user_id: row.buyer_user_id,
    subject_type: row.subject_type,
    purchase_order_id: row.purchase_order_id,
    participant_id: row.participant_id,
    quote_id: row.quote_id,
    installment: row.installment,
    amount_cents: row.amount_cents,
    currency: row.currency,
    method: row.method,
    status: row.status,
    settled_at: row.settled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Subject ownership ──────────────────────────────────────────

async function assertBuyerOwnsSubject(client, userId, { subjectType, purchaseOrderId, participantId }) {
  if (subjectType === 'purchase_order') {
    const { rows } = await client.query(
      `SELECT buyer_user_id, buyer_business_id, status
         FROM purchase_orders WHERE id = $1`,
      [purchaseOrderId]
    );
    const po = rows[0];
    if (!po) throw new AppError('Purchase order not found', 404, 'not_found');
    if (po.buyer_user_id && String(po.buyer_user_id) === String(userId)) return po;
    if (po.buyer_business_id) {
      const { rows: members } = await client.query(
        `SELECT 1 FROM business_members WHERE business_id = $1 AND user_id = $2 LIMIT 1`,
        [po.buyer_business_id, userId]
      );
      if (members.length) return po;
    }
    throw new AppError('Not authorized for this purchase order', 403, 'forbidden');
  }
  const { rows } = await client.query(
    `SELECT user_id, pooled_order_id, status
       FROM pooled_order_participants WHERE id = $1`,
    [participantId]
  );
  const part = rows[0];
  if (!part) throw new AppError('Participation not found', 404, 'not_found');
  if (String(part.user_id) !== String(userId)) {
    throw new AppError('Not authorized for this participation', 403, 'forbidden');
  }
  return part;
}

// ─── Quote → expected amount (server-computed, integer cents) ──

async function getCurrentQuote(client, { subjectType, purchaseOrderId, participantId }) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_buyer_quotes
      WHERE subject_type = $1
        AND (
          ($2::int IS NOT NULL AND purchase_order_id = $2)
          OR
          ($3::int IS NOT NULL AND participant_id = $3)
        )
      ORDER BY version DESC
      LIMIT 1`,
    [subjectType, purchaseOrderId || null, participantId || null]
  );
  return rows[0] || null;
}

function assertQuoteCollectible(quote) {
  if (!quote) {
    throw new AppError('No buyer quote exists for this order', 409, 'quote_missing');
  }
  if (quote.status !== 'accepted' || !quote.accepted_at) {
    throw new AppError(
      `Quote ${quote.reference} v${quote.version} is not accepted (status: ${quote.status}); payment requires an accepted quote`,
      409,
      'quote_not_accepted'
    );
  }
  if (quote.valid_until && new Date(quote.valid_until).getTime() < Date.now()) {
    throw new AppError(`Quote ${quote.reference} v${quote.version} has expired`, 409, 'quote_expired');
  }
  if (quote.currency !== 'USD') {
    throw new AppError('Only USD quotes can be collected', 409, 'quote_currency_unsupported');
  }
  return quote;
}

async function getPaidCents(client, { subjectType, purchaseOrderId, participantId, installment }) {
  const column = installment === 'deposit' ? 'deposit_paid_cents' : 'final_paid_cents';
  if (subjectType === 'purchase_order') {
    const { rows } = await client.query(
      `SELECT deposit_paid_cents, final_paid_cents FROM purchase_orders WHERE id = $1`,
      [purchaseOrderId]
    );
    if (!rows[0]) throw new AppError('Purchase order not found', 404, 'not_found');
    return Number(rows[0][column] || 0);
  }
  const { rows } = await client.query(
    `SELECT deposit_paid_cents, final_paid_cents FROM pooled_order_participants WHERE id = $1`,
    [participantId]
  );
  if (!rows[0]) throw new AppError('Participation not found', 404, 'not_found');
  return Number(rows[0][column] || 0);
}

/**
 * Server-computed expected amount for an installment, in integer cents.
 * Never trusts the client: due comes from the accepted quote, paid comes
 * from the integer paid columns (which the webhook maintains).
 */
async function computeExpectedAmountCents(client, subject, installment) {
  const quote = assertQuoteCollectible(
    await getCurrentQuote(client, subject)
  );
  const dueCents = installment === 'deposit' ? Number(quote.deposit_cents) : Number(quote.final_cents);
  const paidCents = await getPaidCents(client, { ...subject, installment });
  return {
    quote,
    dueCents,
    paidCents,
    expectedCents: dueCents - paidCents,
  };
}

// ─── Attempt creation ─────────────────────────────────────────

function validateCreateInput({ idempotencyKey, subjectType, purchaseOrderId, participantId, installment, method, amountCents }) {
  if (!idempotencyKey || !UUID_RE.test(String(idempotencyKey))) {
    throw new AppError('idempotency_key must be a client-generated UUID', 400, 'validation_failed');
  }
  if (!SUBJECT_TYPES.has(subjectType)) {
    throw new AppError('subject_type must be purchase_order or pooled_participant', 400, 'validation_failed');
  }
  if (subjectType === 'purchase_order' && !Number.isInteger(purchaseOrderId)) {
    throw new AppError('purchase_order_id is required', 400, 'validation_failed');
  }
  if (subjectType === 'pooled_participant' && !Number.isInteger(participantId)) {
    throw new AppError('participant_id is required', 400, 'validation_failed');
  }
  if (!INSTALLMENTS.has(installment)) {
    throw new AppError('installment must be deposit or final', 400, 'validation_failed');
  }
  if (!METHODS.has(method)) {
    throw new AppError('method must be stripe or credit', 400, 'validation_failed');
  }
  if (amountCents !== undefined && amountCents !== null
      && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    throw new AppError('amount_cents must be a positive integer when supplied', 400, 'validation_failed');
  }
}

async function insertAttemptRow(client, row) {
  const { rows } = await client.query(
    `INSERT INTO logistics_payment_attempts
       (idempotency_key, buyer_user_id, subject_type, purchase_order_id, participant_id,
        quote_id, installment, amount_cents, currency, method, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      row.idempotencyKey, row.buyerUserId, row.subjectType,
      row.purchaseOrderId || null, row.participantId || null,
      row.quoteId, row.installment, row.amountCents, 'USD', row.method,
    ]
  );
  return rows[0] || null;
}

async function findAttemptByKey(client, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_payment_attempts WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

function assertReplayMatches(existing, request) {
  const same =
    String(existing.buyer_user_id) === String(request.buyerUserId)
    && existing.subject_type === request.subjectType
    && Number(existing.purchase_order_id || 0) === Number(request.purchaseOrderId || 0)
    && Number(existing.participant_id || 0) === Number(request.participantId || 0)
    && existing.installment === request.installment
    && existing.method === request.method
    && Number(existing.amount_cents) === Number(request.amountCents);
  if (!same) {
    throw new AppError(
      'idempotency_key was already used for a different payment; generate a new key',
      409,
      'idempotency_key_reused'
    );
  }
  return existing;
}

async function attachStripeIntent(client, attempt) {
  const stripe = getStripe();
  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: attempt.amount_cents,
        currency: 'usd',
        // One explicit confirmation per installment. No setup_future_usage:
        // the spec forbids unattended saved-card charges, so the card is
        // never stored for reuse.
        metadata: {
          logistics_payment_attempt_id: String(attempt.id),
          logistics_subject_type: attempt.subject_type,
          logistics_installment: attempt.installment,
          logistics_quote_id: String(attempt.quote_id),
          buyer_user_id: String(attempt.buyer_user_id),
        },
        description: `OxSteed Logistics ${attempt.installment} payment (attempt ${attempt.id})`,
      },
      { idempotencyKey: `logistics_payment_attempt:${attempt.idempotency_key}` }
    );
  } catch (err) {
    // Transient processor/API errors leave the attempt 'pending' so the
    // client can retry with the same idempotency key (no duplicate). Any
    // other creation failure (invalid request, declined) marks the
    // attempt 'failed' with the processor's code.
    const statusCode = Number((err && err.statusCode) || 0);
    const isTransient = statusCode === 0 || statusCode === 429 || statusCode >= 500;
    if (isTransient) {
      logger.warn('[logistics-payments] Stripe API unavailable creating intent; attempt left pending', {
        attemptId: attempt.id, code: err.code, statusCode,
      });
      throw new AppError(
        'Payment processor unavailable; retry with the same idempotency key',
        502,
        'processor_unavailable'
      );
    }
    await client.query(
      `UPDATE logistics_payment_attempts
          SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = NOW()
        WHERE id = $1`,
      [attempt.id, String(err.code || err.type || 'stripe_error').slice(0, 80),
       String(err.message || 'Stripe error').slice(0, 500)]
    );
    logger.warn('[logistics-payments] Stripe intent creation failed', {
      attemptId: attempt.id, code: err.code, message: err.message,
    });
    throw new AppError(`Card payment could not be started: ${err.message || 'processor error'}`, 502, 'processor_error');
  }
  const { rows } = await client.query(
    `UPDATE logistics_payment_attempts
        SET stripe_payment_intent_id = $2, status = 'processing', updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [attempt.id, intent.id]
  );
  return { attempt: rows[0], clientSecret: intent.client_secret };
}

/**
 * Create a payment attempt. Idempotent on the client idempotency key:
 * a repeated submission returns the existing attempt instead of a
 * duplicate. The amount is always server-computed; a client-supplied
 * amount that does not match is rejected.
 */
async function createPaymentAttempt(userId, input) {
  validateCreateInput(input);
  const subject = {
    subjectType: input.subjectType,
    purchaseOrderId: input.subjectType === 'purchase_order' ? input.purchaseOrderId : null,
    participantId: input.subjectType === 'pooled_participant' ? input.participantId : null,
  };

  return withTransaction(db, async (client) => {
    await assertBuyerOwnsSubject(client, userId, subject);
    const { quote, expectedCents, dueCents, paidCents } = await computeExpectedAmountCents(
      client, subject, input.installment
    );
    if (expectedCents <= 0) {
      throw new AppError(
        `The ${input.installment} installment is not due (due ${dueCents}c, paid ${paidCents}c)`,
        409,
        'installment_not_due'
      );
    }
    if (input.amountCents !== undefined && input.amountCents !== null
        && input.amountCents !== expectedCents) {
      throw new AppError(
        `amount_cents ${input.amountCents} does not match the server-computed amount ${expectedCents}`,
        422,
        'amount_mismatch'
      );
    }
    const amountCents = expectedCents;
    if (input.method === 'stripe' && amountCents < STRIPE_USD_MINIMUM_CENTS) {
      throw new AppError(
        `Card payments require at least $${(STRIPE_USD_MINIMUM_CENTS / 100).toFixed(2)}`,
        422,
        'amount_below_minimum'
      );
    }

    const request = {
      buyerUserId: userId,
      subjectType: input.subjectType,
      purchaseOrderId: subject.purchaseOrderId,
      participantId: subject.participantId,
      quoteId: quote.id,
      installment: input.installment,
      method: input.method,
      amountCents,
      idempotencyKey: String(input.idempotencyKey),
    };

    let attempt = await insertAttemptRow(client, request);
    if (!attempt) {
      // Same key raced us (or this is a client retry): converge on the
      // single existing row instead of creating a duplicate.
      const existing = await findAttemptByKey(client, request.idempotencyKey);
      if (!existing) {
        throw new AppError('Payment attempt could not be created', 500, 'attempt_create_failed');
      }
      attempt = assertReplayMatches(existing, request);
      logger.info('[logistics-payments] idempotent replay of payment attempt', {
        attemptId: attempt.id, idempotencyKey: request.idempotencyKey,
      });
      return { attempt: publicAttempt(attempt), idempotentReplay: true, clientSecret: null, credit: null };
    }

    if (input.method === 'stripe') {
      const { attempt: updated, clientSecret } = await attachStripeIntent(client, attempt);
      return { attempt: publicAttempt(updated), idempotentReplay: false, clientSecret, credit: null };
    }

    // method === 'credit': the attempt is durably recorded here; actual
    // debit execution belongs to the parallel OxSteed Credit workstream,
    // which settles via settleCreditAttempt() below.
    logger.info('[logistics-payments] credit-method attempt recorded; awaiting Credit workstream execution', {
      attemptId: attempt.id,
    });
    return {
      attempt: publicAttempt(attempt),
      idempotentReplay: false,
      clientSecret: null,
      credit: {
        status: 'pending_execution',
        message: 'Credit execution is handled by the OxSteed Credit integration; this attempt is recorded and pending.',
      },
    };
  }, 'logistics_create_payment_attempt');
}

async function getPaymentAttempt(id) {
  const attemptId = Number(id);
  if (!Number.isInteger(attemptId) || attemptId <= 0) {
    throw new AppError('Invalid attempt id', 400, 'validation_failed');
  }
  const { rows } = await db.query(
    `SELECT * FROM logistics_payment_attempts WHERE id = $1`,
    [attemptId]
  );
  return rows[0] || null;
}

// ─── Reconciliation queue (shared) ────────────────────────────
// Uses the shared logistics_reconciliation_queue table owned by the
// parallel refund workstream (873_logistics_refund_dual_admin.sql), which
// documents it as jointly owned with this Stripe workstream: "Do NOT
// create a second queue." Mapping:
//   source    = 'logistics_payment'
//   entity_id = payment attempt id (0 when no attempt exists, e.g. an
//               unmatched webhook — the stripe event id lives in payload)
//   payload   = { kind, attempt_id, stripe_event_id?, ...details }
//   status    : pending (open) | claimed (investigating) | resolved
const RECON_SOURCE = 'logistics_payment';

function truncateReason(reason) {
  const s = String(reason || 'logistics payment reconciliation');
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

async function enqueueReconciliation(client, { kind, referenceId, reason, details }) {
  const entityId = Number.isInteger(Number(referenceId)) ? Number(referenceId) : 0;
  const stripeEventId = details && details.stripe_event_id != null
    ? String(details.stripe_event_id)
    : null;
  const payload = {
    kind,
    attempt_id: entityId || null,
    stripe_event_id: stripeEventId,
    ...(details || {}),
  };
  const { rows } = await client.query(
    `INSERT INTO logistics_reconciliation_queue (source, entity_id, reason, payload, status)
     SELECT 'logistics_payment', $1, $2, $3::jsonb, 'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM logistics_reconciliation_queue
       WHERE source = 'logistics_payment'
         AND entity_id = $1
         AND status = 'pending'
         AND COALESCE(payload->>'kind', '') = $4
         AND COALESCE(payload->>'stripe_event_id', '') = COALESCE($5, '')
     )
     RETURNING *`,
    [entityId, truncateReason(`[${kind}] ${reason}`), JSON.stringify(payload), kind, stripeEventId]
  );
  if (rows[0]) {
    logger.warn('[logistics-payments] reconciliation item enqueued', { kind, referenceId, reason });
  }
  return rows[0] || null;
}

const RECON_STATUS_IN = { open: 'pending', pending: 'pending', investigating: 'claimed', claimed: 'claimed', resolved: 'resolved' };

async function listReconciliation({ status, kind, limit = 50, offset = 0 } = {}) {
  const where = [`source = '${RECON_SOURCE}'`];
  const params = [];
  if (status) {
    const mapped = RECON_STATUS_IN[String(status)];
    if (!mapped) throw new AppError('Invalid status filter', 400, 'validation_failed');
    params.push(mapped);
    where.push(`status = $${params.length}`);
  }
  if (kind) {
    params.push(kind);
    where.push(`payload->>'kind' = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await db.query(
    `SELECT *, payload->>'kind' AS kind FROM logistics_reconciliation_queue
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function resolveReconciliation(id, { status, notes, resolvedBy }) {
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new AppError('Invalid reconciliation id', 400, 'validation_failed');
  }
  if (!['open', 'investigating', 'resolved'].includes(status)) {
    throw new AppError('status must be open, investigating or resolved', 400, 'validation_failed');
  }
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE logistics_reconciliation_queue
          SET status = CASE $2
                         WHEN 'investigating' THEN 'claimed'
                         WHEN 'resolved' THEN 'resolved'
                         ELSE 'pending'
                       END,
              resolution_notes = COALESCE($3, resolution_notes),
              claimed_by = CASE WHEN $2 IN ('investigating', 'resolved') THEN COALESCE(claimed_by, $4) ELSE NULL END,
              claimed_at = CASE WHEN $2 IN ('investigating', 'resolved') THEN COALESCE(claimed_at, NOW()) ELSE NULL END,
              resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 AND source = 'logistics_payment'
        RETURNING *, payload->>'kind' AS kind`,
      [itemId, status, notes ?? null, resolvedBy ?? null]
    );
    if (!rows[0]) throw new AppError('Reconciliation item not found', 404, 'not_found');
    return rows[0];
  }, 'logistics_resolve_reconciliation');
}

/** Flag attempts stuck in a non-terminal state past the timeout. */
async function sweepStuckAttempts() {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT id, idempotency_key, installment, amount_cents, method, updated_at
         FROM logistics_payment_attempts
        WHERE status IN ('pending', 'processing')
          AND updated_at < NOW() - make_interval(mins => $1)
        ORDER BY updated_at ASC
        LIMIT 500`,
      [STUCK_TIMEOUT_MINUTES]
    );
    let enqueued = 0;
    for (const a of rows) {
      const item = await enqueueReconciliation(client, {
        kind: 'attempt_stuck_processing',
        referenceId: a.id,
        reason: `Payment attempt ${a.id} (${a.installment}, ${a.amount_cents}c via ${a.method}) stuck in non-terminal state since ${a.updated_at}`,
        details: {
          attempt_id: a.id,
          idempotency_key: a.idempotency_key,
          installment: a.installment,
          amount_cents: a.amount_cents,
          method: a.method,
          stuck_since: a.updated_at,
        },
      });
      if (item) enqueued += 1;
    }
    return { checked: rows.length, enqueued };
  }, 'logistics_sweep_stuck_attempts');
}

// ─── Webhook settlement (signed events only) ──────────────────

const LOGISTICS_WEBHOOK_TYPES = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
]);

function extractWebhookRefs(event) {
  const obj = (event && event.data && event.data.object) || {};
  const metadata = obj.metadata || {};
  const attemptId = metadata.logistics_payment_attempt_id
    || metadata.logisticsPaymentAttemptId
    || null;
  let paymentIntentId = null;
  if (event && typeof event.type === 'string' && event.type.startsWith('payment_intent')) {
    paymentIntentId = obj.id || null;
  } else if (typeof obj.payment_intent === 'string') {
    paymentIntentId = obj.payment_intent;
  } else if (obj.payment_intent && typeof obj.payment_intent.id === 'string') {
    paymentIntentId = obj.payment_intent.id;
  }
  return { attemptId, paymentIntentId };
}

async function findAttemptByPaymentIntent(client, paymentIntentId) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_payment_attempts WHERE stripe_payment_intent_id = $1`,
    [paymentIntentId]
  );
  return rows[0] || null;
}

async function findAttemptById(client, id) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_payment_attempts WHERE id = $1`,
    [Number(id)]
  );
  return rows[0] || null;
}

/**
 * Route a verified Stripe event to logistics settlement.
 * Returns { handled: false } when the event is not a logistics payment
 * event so the existing webhook handlers keep processing it.
 */
async function handleStripeEvent(event) {
  if (!event || !LOGISTICS_WEBHOOK_TYPES.has(event.type) || !event.id) {
    return { handled: false };
  }
  const { attemptId: markerAttemptId, paymentIntentId } = extractWebhookRefs(event);

  let attempt = null;
  if (markerAttemptId) {
    attempt = await findAttemptById(db, markerAttemptId);
    if (!attempt) {
      // Logistics-tagged event naming an attempt that does not exist:
      // never invent an attempt from a webhook. Claim the event (with no
      // attempt link) and reconcile it for staff review instead.
      return withTransaction(db, async (client) => {
        const payloadHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(event.data.object || {}))
          .digest('hex');
        await client.query(
          `INSERT INTO logistics_stripe_webhook_events
             (stripe_event_id, event_type, payment_attempt_id, payload_hash)
           VALUES ($1, $2, NULL, $3)
           ON CONFLICT (stripe_event_id) DO NOTHING`,
          [event.id, event.type, payloadHash]
        );
        await enqueueReconciliation(client, {
          kind: 'unknown_attempt_webhook',
          referenceId: 0,
          reason: `Stripe ${event.type} names unknown logistics attempt ${markerAttemptId}`,
          details: {
            stripe_event_id: event.id,
            claimed_attempt_id: String(markerAttemptId),
            payment_intent_id: paymentIntentId,
          },
        });
        return { handled: true, unknownAttempt: true };
      }, 'logistics_webhook_unknown_attempt');
    }
  }
  if (!attempt && paymentIntentId) {
    attempt = await findAttemptByPaymentIntent(db, paymentIntentId);
  }
  if (!attempt) {
    // Not a logistics payment (no marker, no matching attempt): leave it
    // for the existing handlers.
    return { handled: false };
  }

  return withTransaction(db, async (client) => {
    // Claim the event first: a duplicate delivery conflicts on
    // stripe_event_id and is skipped before any money state changes.
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(event.data.object || {}))
      .digest('hex');
    const { rows: claimed } = await client.query(
      `INSERT INTO logistics_stripe_webhook_events
         (stripe_event_id, event_type, payment_attempt_id, payload_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_event_id) DO NOTHING
       RETURNING id`,
      [event.id, event.type, attempt.id, payloadHash]
    );
    if (!claimed.length) {
      logger.info('[logistics-payments] duplicate Stripe event skipped', {
        stripeEventId: event.id, eventType: event.type, attemptId: attempt.id,
      });
      return { handled: true, duplicate: true, attemptId: attempt.id };
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        return applyPaymentSucceeded(client, event, attempt);
      case 'payment_intent.payment_failed':
        return applyPaymentFailed(client, event, attempt);
      case 'charge.refunded':
        return applyChargeRefunded(client, event, attempt);
      default:
        return { handled: true, attemptId: attempt.id };
    }
  }, `logistics_webhook_${event.type}`);
}

/** Re-read the attempt under lock; the row is the settlement authority. */
async function lockAttempt(client, attemptId) {
  const { rows } = await client.query(
    `SELECT * FROM logistics_payment_attempts WHERE id = $1 FOR UPDATE`,
    [attemptId]
  );
  return rows[0] || null;
}

/**
 * Bump the subject's integer paid columns after a verified settlement.
 * Uses the attempt's own quote for the due amounts so a later quote
 * revision can never rewrite already-posted money. Keeps the legacy
 * float columns in sync (rounded) for the existing read endpoints.
 */
async function bumpSubjectPaidCents(client, attempt) {
  const amountCents = Number(attempt.amount_cents);
  const column = attempt.installment === 'deposit' ? 'deposit_paid_cents' : 'final_paid_cents';
  const legacyColumn = attempt.installment === 'deposit' ? 'deposit_paid_usd' : 'final_paid_usd';
  const paidAtColumn = attempt.installment === 'deposit' ? 'deposit_paid_at' : 'final_paid_at';

  const { rows: quoteRows } = await client.query(
    `SELECT deposit_cents, final_cents FROM logistics_buyer_quotes WHERE id = $1`,
    [attempt.quote_id]
  );
  const quote = quoteRows[0];
  if (!quote) {
    throw new AppError(`Quote ${attempt.quote_id} for attempt ${attempt.id} no longer exists`, 500, 'quote_missing');
  }
  const dueCents = attempt.installment === 'deposit' ? Number(quote.deposit_cents) : Number(quote.final_cents);

  if (attempt.subject_type === 'purchase_order') {
    const { rows } = await client.query(
      `UPDATE purchase_orders
          SET ${column} = ${column} + $2,
              ${legacyColumn} = ROUND((${column} + $2)::numeric / 100, 2),
              ${paidAtColumn} = CASE
                WHEN ${column} + $2 >= $3 THEN COALESCE(${paidAtColumn}, NOW())
                ELSE ${paidAtColumn}
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING ${column} AS paid_cents`,
      [attempt.purchase_order_id, amountCents, dueCents]
    );
    return { paidCents: Number(rows[0]?.paid_cents || 0), dueCents };
  }
  const { rows } = await client.query(
    `UPDATE pooled_order_participants
        SET ${column} = ${column} + $2,
            ${paidAtColumn} = CASE
              WHEN ${column} + $2 >= $3 THEN COALESCE(${paidAtColumn}, NOW())
              ELSE ${paidAtColumn}
            END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${column} AS paid_cents`,
    [attempt.participant_id, amountCents, dueCents]
  );
  return { paidCents: Number(rows[0]?.paid_cents || 0), dueCents };
}

async function applyPaymentSucceeded(client, event, attempt) {
  const pi = event.data.object || {};
  const locked = await lockAttempt(client, attempt.id);
  if (!locked) {
    await enqueueReconciliation(client, {
      kind: 'unknown_attempt_webhook',
      referenceId: event.id,
      reason: `payment_intent.succeeded for logistics attempt ${attempt.id}, which no longer exists`,
      details: { stripe_event_id: event.id, payment_intent_id: pi.id || null },
    });
    return { handled: true, attemptId: attempt.id, outcome: 'unknown_attempt' };
  }

  // Idempotent: an already-settled attempt is a no-op, never a second
  // credit. Terminal failed/canceled attempts contradicted by a later
  // success go to staff, not to an automatic flip.
  if (locked.status === 'succeeded') {
    logger.info('[logistics-payments] succeeded replay on settled attempt; no-op', {
      attemptId: locked.id, stripeEventId: event.id,
    });
    return { handled: true, attemptId: locked.id, outcome: 'already_settled' };
  }
  if (locked.status === 'failed' || locked.status === 'canceled') {
    await enqueueReconciliation(client, {
      kind: 'late_success_after_terminal',
      referenceId: locked.id,
      reason: `payment_intent.succeeded arrived for attempt ${locked.id} already in terminal state '${locked.status}'`,
      details: { stripe_event_id: event.id, payment_intent_id: pi.id || null, prior_status: locked.status },
    });
    return { handled: true, attemptId: locked.id, outcome: 'late_success_reconcile' };
  }

  // Verify the processor's money matches our attempt before crediting.
  const eventAmountCents = Number(pi.amount);
  const eventCurrency = String(pi.currency || '').toLowerCase();
  const piMatches = !locked.stripe_payment_intent_id
    || locked.stripe_payment_intent_id === pi.id;
  if (!piMatches || !Number.isInteger(eventAmountCents)
      || eventAmountCents !== Number(locked.amount_cents)
      || eventCurrency !== 'usd') {
    await enqueueReconciliation(client, {
      kind: 'amount_mismatch',
      referenceId: locked.id,
      reason: `payment_intent.succeeded amount/identity does not match attempt ${locked.id}`,
      details: {
        stripe_event_id: event.id,
        payment_intent_id: pi.id || null,
        event_amount_cents: Number.isInteger(eventAmountCents) ? eventAmountCents : null,
        event_currency: eventCurrency || null,
        attempt_amount_cents: Number(locked.amount_cents),
        attempt_payment_intent_id: locked.stripe_payment_intent_id,
      },
    });
    return { handled: true, attemptId: locked.id, outcome: 'amount_mismatch' };
  }

  await client.query(
    `UPDATE logistics_payment_attempts
        SET status = 'succeeded',
            stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2),
            settled_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [locked.id, pi.id || null]
  );
  const { paidCents, dueCents } = await bumpSubjectPaidCents(client, locked);
  logger.info('[logistics-payments] attempt settled via signed webhook', {
    attemptId: locked.id, amountCents: locked.amount_cents,
    installment: locked.installment, paidCents, dueCents,
  });

  // Best-effort buyer notification, after the money is committed.
  setImmediate(() => {
    const { sendNotification } = require('./notificationService');
    sendNotification({
      userId: locked.buyer_user_id,
      type: 'logistics_payment_succeeded',
      data: {
        attempt_id: locked.id,
        installment: locked.installment,
        amount_cents: locked.amount_cents,
        currency: locked.currency,
      },
      action_url: '/logistics/finance/my-schedule',
      idempotencyKey: `logistics:payment:succeeded:${locked.id}`,
    }).catch((err) => logger.warn('[logistics-payments] payment notification failed', {
      attemptId: locked.id, error: err.message,
    }));
  });

  return { handled: true, attemptId: locked.id, outcome: 'settled' };
}

async function applyPaymentFailed(client, event, attempt) {
  const pi = event.data.object || {};
  const locked = await lockAttempt(client, attempt.id);
  if (!locked) return { handled: true, attemptId: attempt.id, outcome: 'unknown_attempt' };

  // Never downgrade money that already landed, and never resurrect a
  // terminal state from a stale event.
  if (locked.status !== 'pending' && locked.status !== 'processing') {
    logger.info('[logistics-payments] payment_failed for non-pending attempt; no state change', {
      attemptId: locked.id, status: locked.status, stripeEventId: event.id,
    });
    return { handled: true, attemptId: locked.id, outcome: 'terminal_noop' };
  }
  // A failure for a different payment intent than the attempt's must not
  // touch this attempt; reconcile the identity mismatch instead.
  if (locked.stripe_payment_intent_id && pi.id
      && locked.stripe_payment_intent_id !== pi.id) {
    await enqueueReconciliation(client, {
      kind: 'amount_mismatch',
      referenceId: locked.id,
      reason: `payment_intent.payment_failed names a different payment intent than attempt ${locked.id}`,
      details: {
        stripe_event_id: event.id,
        payment_intent_id: pi.id,
        attempt_payment_intent_id: locked.stripe_payment_intent_id,
      },
    });
    return { handled: true, attemptId: locked.id, outcome: 'intent_mismatch' };
  }
  const lastError = pi.last_payment_error || {};
  await client.query(
    `UPDATE logistics_payment_attempts
        SET status = 'failed',
            failure_code = $2,
            failure_message = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [
      locked.id,
      String(lastError.code || 'payment_failed').slice(0, 80),
      String(lastError.message || 'The payment failed at the processor.').slice(0, 500),
    ]
  );
  logger.info('[logistics-payments] attempt marked failed via signed webhook', {
    attemptId: locked.id, failureCode: lastError.code || 'payment_failed',
  });
  return { handled: true, attemptId: locked.id, outcome: 'failed' };
}

async function applyChargeRefunded(client, event, attempt) {
  const charge = event.data.object || {};
  // Refunds always require staff review (spec): a processor-side refund is
  // recorded as a reconciliation item, never auto-applied to the attempt.
  // The attempt stays 'succeeded' — money did move in — until staff
  // resolve the refund through the refund-approval flow.
  await enqueueReconciliation(client, {
    kind: 'external_refund_observed',
    referenceId: attempt.id,
    reason: `Stripe reported charge.refunded for attempt ${attempt.id}; staff review required before any ledger change`,
    details: {
      stripe_event_id: event.id,
      charge_id: charge.id || null,
      payment_intent_id: typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent && charge.payment_intent.id) || null,
      amount_refunded_cents: Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null,
      currency: charge.currency || null,
    },
  });
  return { handled: true, attemptId: attempt.id, outcome: 'refund_reconcile' };
}

/**
 * Integration seam for the parallel OxSteed Credit workstream: settle a
 * credit-method attempt after the Credit ledger commits. Same guards as
 * the Stripe path (lock, terminal-state check, amount verification).
 */
async function settleCreditAttempt(attemptId, { amountCents, creditReference } = {}) {
  return withTransaction(db, async (client) => {
    const locked = await lockAttempt(client, attemptId);
    if (!locked) throw new AppError('Payment attempt not found', 404, 'not_found');
    if (locked.method !== 'credit') {
      throw new AppError('Attempt is not a credit-method attempt', 409, 'method_mismatch');
    }
    if (locked.status === 'succeeded') return { attempt: publicAttempt(locked), replayed: true };
    if (locked.status === 'failed' || locked.status === 'canceled') {
      throw new AppError(`Attempt is already ${locked.status}`, 409, 'terminal_state');
    }
    if (!Number.isInteger(amountCents) || amountCents !== Number(locked.amount_cents)) {
      await enqueueReconciliation(client, {
        kind: 'amount_mismatch',
        referenceId: locked.id,
        reason: `Credit settlement amount ${amountCents} does not match attempt ${locked.id} (${locked.amount_cents}c)`,
        details: { credit_reference: creditReference || null },
      });
      throw new AppError('Credit settlement amount does not match the attempt', 422, 'amount_mismatch');
    }
    await client.query(
      `UPDATE logistics_payment_attempts
          SET status = 'succeeded', settled_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [locked.id]
    );
    await bumpSubjectPaidCents(client, locked);
    const { rows } = await client.query(
      `SELECT * FROM logistics_payment_attempts WHERE id = $1`, [locked.id]
    );
    return { attempt: publicAttempt(rows[0]), replayed: false };
  }, 'logistics_settle_credit_attempt');
}

module.exports = {
  isLogisticsPaymentsEnabled,
  isStaffRole,
  STAFF_ROLES,
  STUCK_TIMEOUT_MINUTES,
  createPaymentAttempt,
  getPaymentAttempt,
  publicAttempt,
  computeExpectedAmountCents,
  getCurrentQuote,
  handleStripeEvent,
  settleCreditAttempt,
  enqueueReconciliation,
  listReconciliation,
  resolveReconciliation,
  sweepStuckAttempts,
};
