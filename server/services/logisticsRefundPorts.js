'use strict';

/**
 * OxSteed Logistics — refund ports (Phase 3).
 *
 * Production implementations of the dependency-injected ports used by
 * logisticsRefundService. Each port documents the CONTRACT it expects from
 * the parallel workstream that owns it. When the owning workstream has not
 * landed yet, the port FAILS CLOSED with a named error instead of guessing.
 *
 * ── CONTRACT: logistics_payment_attempts (owned by Stripe/checkout workstream)
 *    Expected shape when the table lands (columns are read defensively;
 *    missing columns degrade to fail-closed):
 *      id                    text/uuid   PRIMARY KEY (the payment attempt ID)
 *      buyer_user_id         uuid        NOT NULL (buyer receiving the refund notice)
 *      amount_cents          integer     NOT NULL (captured amount, minor units)
 *      currency              char(3)     NOT NULL (must be 'USD' for refunds)
 *      method                text        NOT NULL ('stripe' | 'credit')
 *      status                text        NOT NULL (refundable when paid|captured|succeeded)
 *      stripe_payment_intent_id text     nullable (Stripe method)
 *      stripe_charge_id      text        nullable (Stripe method)
 *      dispute_status        text        nullable ('open' blocks execution)
 *    The foreign key logistics_refund_cases.original_payment_attempt_id ->
 *    logistics_payment_attempts.id should be added once this table lands.
 *
 * ── CONTRACT: disputes (owned by Stripe workstream)
 *    checkDispute returns { known, open }. Unknown dispute status BLOCKS
 *    execution (fail closed) until the workstream wires dispute linkage.
 *
 * ── CONTRACT: Credit reversal (owned by Credit workstream)
 *    Reverse via reverseCredit({ refundCaseId, amountCents, currency,
 *    idempotencyKey }) -> { ledgerEntryId }. Until the Credit workstream
 *    registers its adapter, credit refunds fail closed with
 *    credit_reversal_unavailable.
 */

const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

async function tableExists(query, tableName) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnNames(query, tableName) {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tableName]
  );
  return new Set(rows.map((r) => r.column_name));
}

// ─── Payment attempt port ────────────────────────────────────

const paymentPort = {
  async getPaymentAttempt(query, attemptId) {
    if (!(await tableExists(query, 'logistics_payment_attempts'))) {
      // Stripe/checkout workstream has not landed the table yet: fail closed.
      return null;
    }
    const cols = await columnNames(query, 'logistics_payment_attempts');
    const pick = (name) => (cols.has(name) ? name : null);
    const selectList = [
      'id',
      pick('buyer_user_id'), pick('amount_cents'), pick('currency'),
      pick('method'), pick('status'),
      pick('stripe_payment_intent_id'), pick('stripe_charge_id'),
    ].filter(Boolean).join(', ');
    const { rows } = await query(
      `SELECT ${selectList} FROM logistics_payment_attempts WHERE id::text = $1 LIMIT 1`,
      [String(attemptId)]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      buyerUserId: r.buyer_user_id || null,
      amountCents: r.amount_cents != null ? Number(r.amount_cents) : null,
      currency: r.currency || null,
      method: r.method || null,
      status: r.status || null,
      paymentIntentId: r.stripe_payment_intent_id || null,
      chargeId: r.stripe_charge_id || null,
    };
  },
};

// ─── Dispute port ────────────────────────────────────────────

const disputePort = {
  async checkDispute(query, attemptId) {
    // Prefer an explicit dispute_status column on the payment attempt.
    if (await tableExists(query, 'logistics_payment_attempts')) {
      const cols = await columnNames(query, 'logistics_payment_attempts');
      if (cols.has('dispute_status')) {
        const { rows } = await query(
          `SELECT dispute_status FROM logistics_payment_attempts WHERE id::text = $1 LIMIT 1`,
          [String(attemptId)]
        );
        const s = (rows[0]?.dispute_status || '').toLowerCase();
        if (['open', 'needs_response', 'under_review'].includes(s)) return { known: true, open: true };
        if (s === '' || s === 'none' || s === 'closed' || s === 'won' || s === 'lost') {
          return { known: true, open: false };
        }
        return { known: false, open: false };
      }
    }
    // Fall back to a disputes table if the workstream created one.
    if (await tableExists(query, 'logistics_disputes')) {
      const cols = await columnNames(query, 'logistics_disputes');
      if (cols.has('payment_attempt_id') && cols.has('status')) {
        const { rows } = await query(
          `SELECT COUNT(*)::int AS n FROM logistics_disputes
            WHERE payment_attempt_id::text = $1 AND status IN ('open','needs_response','under_review')`,
          [String(attemptId)]
        );
        return { known: true, open: (rows[0]?.n || 0) > 0 };
      }
    }
    // Dispute linkage not wired yet: unknown -> execution fails closed.
    return { known: false, open: false };
  },
};

// ─── Stripe port ─────────────────────────────────────────────

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

const stripePort = {
  async createRefund({ paymentIntentId, chargeId, amountCents, idempotencyKey, metadata }) {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new AppError('Stripe is not configured. Refund blocked.', 503, 'stripe_not_configured');
    }
    const params = {
      amount: amountCents,
      metadata: { source: 'oxsteed_logistics_refund', ...metadata },
    };
    if (chargeId) params.charge = chargeId;
    else if (paymentIntentId) params.payment_intent = paymentIntentId;
    else throw new AppError('No Stripe charge or payment intent on the original payment.', 400, 'refund_no_stripe_reference');

    const refund = await stripe.refunds.create(params, { idempotencyKey });
    return { id: refund.id, status: refund.status }; // succeeded | pending | failed | canceled
  },
};

// ─── Credit reversal port ────────────────────────────────────
// TODO (Credit workstream): register the real reversal adapter via
// setCreditReversalAdapter(async ({ refundCaseId, amountCents, currency, idempotencyKey }) => {
//   ... commit the ledger reversal ...
//   return { ledgerEntryId };
// });
// Until then, credit refunds fail closed with credit_reversal_unavailable.

let creditReversalAdapter = null;

function setCreditReversalAdapter(fn) {
  if (typeof fn !== 'function') throw new Error('Credit reversal adapter must be a function');
  creditReversalAdapter = fn;
}

const creditPort = {
  async reverseCredit({ refundCaseId, amountCents, currency, idempotencyKey }) {
    if (!creditReversalAdapter) {
      throw new AppError(
        'Credit reversal is not implemented yet (Credit workstream). Refund blocked.',
        503, 'credit_reversal_unavailable'
      );
    }
    return creditReversalAdapter({ refundCaseId, amountCents, currency, idempotencyKey });
  },
};

// ─── Admin user port ─────────────────────────────────────────

const userPort = {
  async getAdminUser(query, userId) {
    if (!userId) return null;
    const { rows } = await query(
      `SELECT id, role, COALESCE(is_banned, false) AS is_banned FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, role: r.role, isBanned: !!r.is_banned };
  },
};

// ─── Notify port ─────────────────────────────────────────────

const NOTIFY_EVENT_TYPES = {
  refund_proposed: 'logistics:refund_proposed',
  refund_approved: 'logistics:refund_approved',
  refund_rejected: 'logistics:refund_rejected',
  refund_processed: 'logistics:refund_processed',
  refund_failed: 'logistics:refund_failed',
  refund_expired: 'logistics:refund_expired',
};

function formatAmountCents(cents) {
  if (!Number.isInteger(cents)) return '';
  return `$${(cents / 100).toFixed(2)} USD`;
}

const notifyPort = {
  async notify(event, buyerUserId, vars = {}) {
    if (!buyerUserId) return;
    const type = NOTIFY_EVENT_TYPES[event];
    if (!type) return;
    try {
      const notificationService = require('./notificationService');
      const detail = [
        vars.reference ? `Ref ${vars.reference}` : null,
        vars.amountCents != null ? formatAmountCents(vars.amountCents) : null,
      ].filter(Boolean).join(' · ');
      await notificationService.sendNotification({
        userId: buyerUserId,
        type,
        body: detail,
        idempotencyKey: `logistics-refund-notif-${event}-${vars.reference || buyerUserId}`,
      });
    } catch (err) {
      // Notifications must never break the money path.
      // eslint-disable-next-line no-console
      console.error('logistics refund notification failed:', event, err.message);
    }
  },
};

function createDefaultDeps(query) {
  return { query, paymentPort, disputePort, stripePort, creditPort, userPort, notifyPort };
}

module.exports = {
  createDefaultDeps,
  paymentPort,
  disputePort,
  stripePort,
  creditPort,
  setCreditReversalAdapter,
  userPort,
  notifyPort,
  _internal: {
    tableExists,
    // Exposed for tests/workstream coordination.
    expectedPaymentAttemptColumns: [
      'id', 'buyer_user_id', 'amount_cents', 'currency', 'method', 'status',
      'stripe_payment_intent_id', 'stripe_charge_id', 'dispute_status',
    ],
    authHashFor: (userId) => crypto.createHash('sha256')
      .update(`${userId}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`).digest('hex'),
  },
};
