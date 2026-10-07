// server/routes/qrPayments.js
// Scan-to-pay QR codes: helpers and business owners create payment codes,
// customers scan them and pay through Stripe Checkout on the owner's
// connected Stripe account (destination charge with application fee).
//
// POST   /api/qr-payments/codes              → create a payment code (auth)
// GET    /api/qr-payments/codes              → list my codes with totals (auth)
// PATCH  /api/qr-payments/codes/:id          → update a code (auth, owner)
// DELETE /api/qr-payments/codes/:id          → deactivate a code (auth, owner)
// GET    /api/qr-payments/pay/:code          → public pay-page data
// GET    /api/qr-payments/public/user/:userId/pay-code → public active pay link
// POST   /api/qr-payments/pay/:code/checkout → create Stripe Checkout Session
// GET    /api/qr-payments/pay/:code/receipt  → receipt data for success page

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { paymentsLimiter, strictLimiter, generalLimiter } = require('../middleware/rateLimiter');
const pool = require('../db');
const logger = require('../utils/logger');
const { calculateTier3Fees } = require('../utils/feeCalculator');
const { envFlagEnabled } = require('../middleware/featureFlags');

// Phase 5 — Credit Everywhere: QR Credit payments stay behind this flag
// (locked decision #10: wire behind flags before un-hide). Fail-closed.
function qrCreditEnabled() {
  return envFlagEnabled('QR_CREDIT_ENABLED', false);
}

// Route-local Redis store option, mirroring server/middleware/rateLimiter.js.
// Falls back to in-memory when Redis is unavailable.
const redisClient = require('../utils/redis');
let RedisStore = null;
if (redisClient) {
  try {
    RedisStore = require('rate-limit-redis').default;
  } catch (err) {
    logger.warn('qrPayments: rate-limit-redis unavailable - using in-memory rate limits', { message: err.message });
  }
}

function createQrStoreOption(prefix) {
  if (redisClient && RedisStore) {
    return {
      store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix,
      }),
    };
  }
  return {};
}

// Public checkout limiter: POST /pay/:code/checkout has no authenticate
// middleware (shoppers are unauthenticated), so the shared paymentsLimiter
// never applies to it (its `skip: (req) => !req.user` skips every
// unauthenticated request). 20 checkouts per hour per IP.
const qrCheckoutLimiter = rateLimit({
  ...createQrStoreOption('rl:qr_checkout:'),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many payment attempts. Please try again later.',
    retryAfter: '1 hour',
  },
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const MIN_AMOUNT_CENTS = 600;        // $6.00 (must exceed the $5.00 minimum platform fee)
const MAX_AMOUNT_CENTS = 10_000_000; // $100,000.00
const CODE_BYTES = 9;                // 9 bytes -> 12 base64url chars

function publicBaseUrl() {
  const base = process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.CLIENT_URL || '';
  return base.replace(/\/+$/, '');
}

function parseAmountCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function recipientName(user) {
  const first = (user.first_name || '').trim();
  const lastInitial = (user.last_name || '').trim().charAt(0);
  if (!first) return 'OxSteed provider';
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

async function getConnectAccount(userId) {
  const { rows } = await pool.query(
    'SELECT user_id, stripe_account_id, charges_enabled FROM connect_accounts WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

function connectRequired(res) {
  return res.status(409).json({
    error: 'Connect your Stripe account before creating payment codes.',
    code: 'connect_required',
  });
}

async function getActiveCode(code) {
  const { rows } = await pool.query(
    `SELECT c.id, c.owner_user_id, c.code, c.label, c.amount_cents, c.currency,
            u.first_name, u.last_name
       FROM qr_payment_codes c
       JOIN users u ON u.id = c.owner_user_id
      WHERE c.code = $1 AND c.is_active = TRUE`,
    [code]
  );
  return rows[0] || null;
}

function codeNotFound(res) {
  // Unknown and inactive codes share one response so scanners
  // cannot distinguish deactivated codes from mistyped ones.
  return res.status(404).json({
    error: 'This payment link is not available.',
    code: 'not_found',
  });
}

// ── Create a payment code ────────────────────────────────────────
router.post('/codes', authenticate, paymentsLimiter, async (req, res, next) => {
  try {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label) {
      return res.status(400).json({ error: 'A label is required.', code: 'label_required' });
    }
    if (label.length > 80) {
      return res.status(400).json({
        error: 'The label must be 80 characters or fewer.',
        code: 'label_too_long',
      });
    }

    const amountCents = parseAmountCents(req.body?.amount_cents);
    if (req.body?.amount_cents !== undefined && req.body?.amount_cents !== null && req.body?.amount_cents !== '') {
      if (amountCents === null || amountCents < MIN_AMOUNT_CENTS) {
        return res.status(400).json({
          error: `A fixed amount must be at least $${(MIN_AMOUNT_CENTS / 100).toFixed(2)}. Leave it empty for an open amount.`,
          code: 'invalid_amount',
        });
      }
    }

    const connect = await getConnectAccount(req.user.id);
    if (!connect || !connect.charges_enabled) return connectRequired(res);

    // Short URL-safe code; retry on the (unlikely) unique collision.
    let row = null;
    for (let attempt = 0; attempt < 3 && !row; attempt += 1) {
      const code = crypto.randomBytes(CODE_BYTES).toString('base64url');
      try {
        const { rows } = await pool.query(
          `INSERT INTO qr_payment_codes (owner_user_id, code, label, amount_cents)
           VALUES ($1, $2, $3, $4)
           RETURNING id, code, label, amount_cents, currency, is_active, created_at`,
          [req.user.id, code, label, amountCents]
        );
        row = rows[0];
      } catch (err) {
        if (err.code !== '23505' || attempt === 2) throw err;
      }
    }

    // Return the full code object (same shape as the list endpoint) so the
    // setup page can render and toggle the new card without a refetch.
    return res.status(201).json({
      code: {
        ...row,
        pay_url: `${publicBaseUrl()}/pay/${row.code}`,
        total_received_cents: 0,
        succeeded_count: 0,
      },
    });
  } catch (err) {
    logger.error('qrPayments: create code failed', { userId: req.user?.id, error: err.message });
    return next(err);
  }
});

// ── List my codes with succeeded totals ──────────────────────────
router.get('/codes', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.label, c.amount_cents, c.currency, c.is_active,
              c.created_at, c.deactivated_at,
              COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'succeeded'), 0)::int
                AS total_received_cents,
              COUNT(p.id) FILTER (WHERE p.status = 'succeeded')::int AS succeeded_count
         FROM qr_payment_codes c
         LEFT JOIN qr_payments p ON p.qr_code_id = c.id
        WHERE c.owner_user_id = $1
        GROUP BY c.id
        ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    return res.json({
      codes: rows.map((r) => ({
        ...r,
        pay_url: `${publicBaseUrl()}/pay/${r.code}`,
      })),
    });
  } catch (err) {
    logger.error('qrPayments: list codes failed', { userId: req.user?.id, error: err.message });
    return next(err);
  }
});

// ── Update a code (owner only) ────────────────────────────────────
router.patch('/codes/:id', authenticate, paymentsLimiter, async (req, res, next) => {
  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM qr_payment_codes WHERE id = $1 AND owner_user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!existing[0]) {
      return res.status(404).json({ error: 'Payment code not found.', code: 'not_found' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (req.body?.label !== undefined) {
      const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
      if (!label || label.length > 80) {
        return res.status(400).json({
          error: 'The label must be between 1 and 80 characters.',
          code: 'invalid_label',
        });
      }
      updates.push(`label = $${idx++}`);
      values.push(label);
    }

    if (req.body?.amount_cents !== undefined) {
      const amountCents = parseAmountCents(req.body.amount_cents);
      if (req.body.amount_cents !== null && req.body.amount_cents !== '' && (amountCents === null || amountCents < MIN_AMOUNT_CENTS)) {
        return res.status(400).json({
          error: `A fixed amount must be at least $${(MIN_AMOUNT_CENTS / 100).toFixed(2)}. Use null for an open amount.`,
          code: 'invalid_amount',
        });
      }
      updates.push(`amount_cents = $${idx++}`);
      values.push(amountCents);
    }

    if (req.body?.is_active !== undefined) {
      const isActive = req.body.is_active === true;
      updates.push(`is_active = $${idx++}`);
      values.push(isActive);
      updates.push(isActive ? 'deactivated_at = NULL' : 'deactivated_at = NOW()');
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'Nothing to update.', code: 'no_changes' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id, req.user.id);
    const { rows } = await pool.query(
      `UPDATE qr_payment_codes
          SET ${updates.join(', ')}
        WHERE id = $${idx++} AND owner_user_id = $${idx++}
        RETURNING id, code, label, amount_cents, currency, is_active, updated_at`,
      values
    );
    const row = rows[0];
    // Same { code: {...} } envelope as create/list so the client's
    // `data?.code || data` picks up the object (with is_active) every time.
    return res.json({ code: { ...row, pay_url: `${publicBaseUrl()}/pay/${row.code}` } });
  } catch (err) {
    logger.error('qrPayments: update code failed', { userId: req.user?.id, error: err.message });
    return next(err);
  }
});

// ── Deactivate a code (owner only, soft delete) ──────────────────
router.delete('/codes/:id', authenticate, paymentsLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE qr_payment_codes
          SET is_active = FALSE, deactivated_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Payment code not found.', code: 'not_found' });
    }
    return res.json({ id: rows[0].id, is_active: false });
  } catch (err) {
    logger.error('qrPayments: deactivate code failed', { userId: req.user?.id, error: err.message });
    return next(err);
  }
});

// ── Public: a user's active pay link (powers "Pay now" on bookings/profiles)
// Returns the most recently created active code, or { pay_url: null }.
// Pay links are public shareable URLs, so revealing that a user accepts
// QR payments exposes nothing beyond what the link itself shows.
router.get('/public/user/:userId/pay-code', strictLimiter, async (req, res, next) => {
  try {
    const userId = String(req.params.userId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return res.status(400).json({ error: 'Invalid user id.', code: 'invalid_user_id' });
    }
    const { rows } = await pool.query(
      `SELECT code, label
         FROM qr_payment_codes
        WHERE owner_user_id = $1 AND is_active = TRUE
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    if (!rows[0]) return res.json({ pay_url: null });
    return res.json({
      pay_url: `${publicBaseUrl()}/pay/${rows[0].code}`,
      code: rows[0].code,
      label: rows[0].label,
    });
  } catch (err) {
    logger.error('qrPayments: public pay-code lookup failed', { error: err.message });
    return next(err);
  }
});

// ── Public pay-page data ─────────────────────────────────────────
router.get('/pay/:code', strictLimiter, async (req, res, next) => {
  try {
    const code = await getActiveCode(req.params.code);
    if (!code) return codeNotFound(res);
    return res.json({
      label: code.label,
      amount_cents: code.amount_cents,
      currency: code.currency,
      recipient_name: recipientName(code),
      ready: true,
    });
  } catch (err) {
    logger.error('qrPayments: pay lookup failed', { error: err.message });
    return next(err);
  }
});

// ── Create a Stripe Checkout Session for a code ──────────────────
router.post('/pay/:code/checkout', qrCheckoutLimiter, async (req, res, next) => {
  try {
    const clientRequestId = String(
      req.get('Idempotency-Key') || req.body?.client_request_id || ''
    ).trim();
    if (!/^[A-Za-z0-9:._-]{8,120}$/.test(clientRequestId)) {
      return res.status(400).json({
        error: 'A valid checkout request ID is required. Please try again.',
        code: 'idempotency_key_required',
      });
    }

    const code = await getActiveCode(req.params.code);
    if (!code) return codeNotFound(res);

    let amountCents = code.amount_cents;
    if (amountCents === null || amountCents === undefined) {
      amountCents = parseAmountCents(req.body?.amount_cents);
    }
    if (amountCents === null || amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
      return res.status(400).json({
        error: `Enter an amount between $${(MIN_AMOUNT_CENTS / 100).toFixed(2)} and $${(MAX_AMOUNT_CENTS / 100).toFixed(2)}.`,
        code: 'invalid_amount',
      });
    }

    let payerEmail = null;
    if (req.body?.payer_email !== undefined && req.body?.payer_email !== null && req.body?.payer_email !== '') {
      if (!isValidEmail(req.body.payer_email)) {
        return res.status(400).json({ error: 'Enter a valid email address.', code: 'invalid_email' });
      }
      payerEmail = req.body.payer_email.trim();
    }

    // Phase 5 — Credit Everywhere: pay with OxSteed Credit instead of card.
    // The QR merchant must be an enrolled Credit participant
    // (type=qr_merchant, subject=code owner).
    if (String(req.body?.payment_method || '').toLowerCase() === 'credit') {
      if (!qrCreditEnabled()) {
        return res.status(503).json({
          error: 'Paying with OxSteed Credit is not available yet.',
          code: 'feature_disabled',
        });
      }
      return payQrWithCredit(req, res, next, code, { amountCents, payerEmail, clientRequestId });
    }

    const connect = await getConnectAccount(code.owner_user_id);
    if (!connect || !connect.charges_enabled) return connectRequired(res);

    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ amount_cents: amountCents, payer_email: payerEmail, currency: code.currency || 'usd' }))
      .digest('hex');

    const { rows: previousAttempts } = await pool.query(
      `SELECT stripe_checkout_session_id, checkout_url, status, request_fingerprint
         FROM qr_payments
        WHERE qr_code_id = $1 AND client_request_id = $2
        LIMIT 1`,
      [code.id, clientRequestId],
    );
    if (previousAttempts[0]) {
      if (previousAttempts[0].request_fingerprint && previousAttempts[0].request_fingerprint !== requestFingerprint) {
        return res.status(409).json({
          error: 'This checkout request ID was already used for different payment details.',
          code: 'idempotency_key_conflict',
        });
      }
      return res.json({
        url: previousAttempts[0].checkout_url || null,
        session_id: previousAttempts[0].stripe_checkout_session_id,
        status: previousAttempts[0].status,
        idempotent: true,
      });
    }

    const fees = calculateTier3Fees(amountCents);
    const baseUrl = publicBaseUrl();

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: code.currency || 'usd',
              product_data: { name: code.label },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: fees.application_fee_cents,
          metadata: {
            qr_payment: 'true',
            qr_code_id: code.id,
          },
        },
        customer_email: payerEmail || undefined,
        success_url: `${baseUrl}/pay/${code.code}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pay/${code.code}`,
        metadata: {
          qr_payment: 'true',
          qr_code_id: code.id,
          amount_cents: String(amountCents),
        },
      },
      {
        stripeAccount: connect.stripe_account_id,
        idempotencyKey: `qr-checkout:${code.id}:${clientRequestId}`,
      }
    );

    const { rows: inserted } = await pool.query(
      `INSERT INTO qr_payments
         (qr_code_id, stripe_checkout_session_id, amount_cents, platform_fee_cents, status, payer_email, client_request_id, checkout_url, request_fingerprint)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
       ON CONFLICT (qr_code_id, client_request_id) DO NOTHING
       RETURNING stripe_checkout_session_id, checkout_url, status`,
      [code.id, session.id, amountCents, fees.application_fee_cents, payerEmail, clientRequestId, session.url, requestFingerprint]
    );

    if (inserted[0]) return res.json({ url: inserted[0].checkout_url, session_id: inserted[0].stripe_checkout_session_id });

    // Another request with the same key won the insert race. Replay the
    // durable result instead of returning a second checkout attempt.
    const { rows: raced } = await pool.query(
      `SELECT stripe_checkout_session_id, checkout_url, status, request_fingerprint
         FROM qr_payments
        WHERE qr_code_id = $1 AND client_request_id = $2
        LIMIT 1`,
      [code.id, clientRequestId],
    );
    if (!raced[0]) {
      return res.status(503).json({ error: 'Checkout is still being prepared. Please retry.', code: 'checkout_reconciliation_required' });
    }
    if (raced[0].request_fingerprint && raced[0].request_fingerprint !== requestFingerprint) {
      return res.status(409).json({
        error: 'This checkout request ID was already used for different payment details.',
        code: 'idempotency_key_conflict',
      });
    }
    return res.json({
      url: raced[0].checkout_url || session.url,
      session_id: raced[0].stripe_checkout_session_id,
      status: raced[0].status,
      idempotent: true,
    });
  } catch (err) {
    logger.error('qrPayments: checkout failed', { code: req.params.code, error: err.message });
    return next(err);
  }
});

// ── Receipt data for the success page ────────────────────────────
router.get('/pay/:code/receipt', generalLimiter, async (req, res, next) => {
  try {
    const sessionId = typeof req.query?.session_id === 'string' ? req.query.session_id.trim() : '';
    if (!sessionId) {
      return res.status(400).json({ error: 'A session id is required.', code: 'session_required' });
    }
    const { rows } = await pool.query(
      `SELECT p.status, p.amount_cents, c.label, c.currency
         FROM qr_payments p
         JOIN qr_payment_codes c ON c.id = p.qr_code_id
        WHERE p.stripe_checkout_session_id = $1 AND c.code = $2`,
      [sessionId, req.params.code]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Receipt not found.', code: 'not_found' });
    }
    return res.json({
      status: rows[0].status,
      amount_cents: rows[0].amount_cents,
      currency: rows[0].currency || 'USD',
      label: rows[0].label,
    });
  } catch (err) {
    logger.error('qrPayments: receipt lookup failed', { error: err.message });
    return next(err);
  }
});

/**
 * Phase 5 — Credit Everywhere: pay a QR code with OxSteed Credit.
 *
 * The QR merchant (code owner) must be an enrolled Credit participant
 * (type=qr_merchant). Uses the shared spend adapter (surface=qr,
 * mode=debit). Supports authenticated users and guests (guest cap applies).
 */
async function payQrWithCredit(req, res, next, code, { amountCents, payerEmail, clientRequestId }) {
  try {
    const { spendWithCredit } = require('../services/creditSpendAdapter');
    // QR checkout is public; req.user is set only when the caller is signed
    // in (no auth middleware on this route, so guests have req.user undefined).
    const customerId = req.user?.id || null;

    const result = await spendWithCredit({
      participantRef: { type: 'qr_merchant', subjectId: String(code.owner_user_id) },
      customerId,
      guestSessionId: customerId ? null : `qr:${code.id}:${clientRequestId}`,
      amountCents,
      currency: code.currency || 'USD',
      surface: 'qr',
      mode: 'debit',
      referenceType: 'qr_payment',
      referenceId: `${code.id}:${clientRequestId}`,
      idempotencyKey: `qr-credit:${code.id}:${clientRequestId}`,
      isImpersonated: Boolean(req.impersonated),
      metadata: { qrCode: code.code, label: code.label, payerEmail: payerEmail || null },
    });

    // Record the Credit payment alongside Stripe rows for unified receipts.
    await pool.query(
      `INSERT INTO qr_payments
         (qr_code_id, amount_cents, platform_fee_cents, status, payer_email,
          client_request_id, checkout_url, request_fingerprint, payment_method)
       VALUES ($1, $2, 0, 'paid', $3, $4, $5, $6, 'oxsteed_credit')
       ON CONFLICT (qr_code_id, client_request_id) DO NOTHING`,
      [code.id, amountCents, payerEmail, clientRequestId, null,
       crypto.createHash('sha256').update(`credit:${code.id}:${amountCents}`).digest('hex')]
    );

    return res.json({
      ok: true,
      payment_method: 'oxsteed_credit',
      status: 'paid',
      idempotencyKey: result.idempotencyKey,
    });
  } catch (err) {
    logger.error('qrPayments: credit payment failed', { error: err.message, code: code.code });
    return res.status(err.statusCode || 500).json({ error: err.message || 'Credit payment failed', code: err.code });
  }
}

module.exports = router;
