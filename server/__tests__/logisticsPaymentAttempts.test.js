'use strict';
/**
 * Phase 3 logistics payments — attempt creation.
 *
 * Proves: server-computed amounts (client amounts never trusted),
 * idempotent creation on the client idempotency key (concurrent duplicate
 * submissions converge on one row), ownership checks, quote acceptance
 * checks, the disabled-flag 503 gate, and unauthorized access.
 */
const { mockQuery, resetMocks } = require('./setup');
const fakeDb = require('./helpers/logisticsPaymentFakeDb');

const mockSendNotification = jest.fn().mockResolvedValue({ id: 1 });
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));

const mockResolveLogisticsRole = jest.fn();
jest.mock('../middleware/requireLogisticsAccess', () => ({
  resolveLogisticsRole: (...args) => mockResolveLogisticsRole(...args),
}));

// Credit execution boundary: the checkout service must check availability
// first, then execute the debit in-transaction on the attempt's
// idempotency key. Mocked here so these HTTP tests stay hermetic; the
// DB-backed suite proves the real execution path.
const mockCreditAvailability = jest.fn();
const mockCreditPayInTransaction = jest.fn();
jest.mock('../services/logisticsCreditPayService', () => ({
  getLogisticsCreditPayAvailability: (...args) => mockCreditAvailability(...args),
  payLogisticsInstallmentInTransaction: (...args) => mockCreditPayInTransaction(...args),
}));

const stripe = require('stripe');
const stripeInstance = stripe.__mockInstance;

const express = require('express');
const request = require('supertest');
const paymentsService = require('../services/logisticsPaymentService');
const paymentsCtrl = require('../controllers/logisticsPaymentController');
const requireLogisticsPayments = require('../middleware/requireLogisticsPayments');

const BUYER = 'buyer-1';
const OTHER = 'buyer-2';
let store;

function buildApp(asUserId) {
  const app = express();
  app.use(express.json());
  if (asUserId) {
    app.use((req, _res, next) => { req.user = { id: asUserId }; next(); });
  }
  // Minimal stand-in for requireAuth: 401 when no user was injected.
  const fakeAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    return next();
  };
  app.post('/checkout/attempt', fakeAuth, requireLogisticsPayments, paymentsCtrl.createAttempt);
  app.get('/checkout/attempt/:id', fakeAuth, requireLogisticsPayments, paymentsCtrl.getAttempt);
  app.get('/checkout/reconciliation', fakeAuth, requireLogisticsPayments, paymentsCtrl.listReconciliation);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

const buyerApp = () => buildApp(BUYER);
const otherApp = () => buildApp(OTHER);
const guestApp = () => buildApp(null);

function seedPoFlow(overrides = {}) {
  const po = fakeDb.seedPurchaseOrder(store, { id: 101, buyer_user_id: BUYER, ...overrides.po });
  const quote = fakeDb.seedQuote(store, {
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    deposit_cents: 3000,
    final_cents: 7000,
    total_cents: 10000,
    ...overrides.quote,
  });
  return { po, quote };
}

const newKey = () => `11111111-2222-4333-8555-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  store = fakeDb.createStore();
  fakeDb.installRoutes(mockQuery, store);
  process.env.LOGISTICS_PAYMENTS_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  mockResolveLogisticsRole.mockResolvedValue('individual_buyer');
  stripeInstance.paymentIntents.create.mockResolvedValue({
    id: 'pi_test_123',
    client_secret: 'cs_test_secret_123',
  });
});

afterEach(() => {
  delete process.env.LOGISTICS_PAYMENTS_ENABLED;
});

describe('POST /checkout/attempt — happy path', () => {
  test('creates a stripe attempt with the server-computed amount and returns the client secret', async () => {
    const { po, quote } = seedPoFlow();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
        // amount omitted: the server computes it from the accepted quote
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.attempt.amount_cents).toBe(3000);
    expect(res.body.data.attempt.quote_id).toBe(quote.id);
    expect(res.body.data.attempt.status).toBe('processing');
    expect(res.body.data.client_secret).toBe('cs_test_secret_123');

    // Stripe got integer cents, USD, the attempt id in metadata, and a
    // namespaced idempotency key — no client amount ever reached Stripe.
    expect(stripeInstance.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [piParams, piOpts] = stripeInstance.paymentIntents.create.mock.calls[0];
    expect(piParams.amount).toBe(3000);
    expect(piParams.currency).toBe('usd');
    expect(piParams.metadata.logistics_payment_attempt_id).toBe(String(res.body.data.attempt.id));
    expect(piOpts.idempotencyKey).toContain('logistics_payment_attempt:');
    // Spec: no unattended saved-card charges — the intent must not store
    // the card for future off-session use.
    expect(piParams.setup_future_usage).toBeUndefined();
  });

  test('omitted client amount is fine; a matching client amount is accepted', async () => {
    const { po } = seedPoFlow();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
        amount_cents: 3000, // matches the server computation
      });
    expect(res.status).toBe(201);
    expect(res.body.data.attempt.amount_cents).toBe(3000);
  });

  test('credit-method checkout checks availability, then executes the debit (no pending limbo)', async () => {
    const { po } = seedPoFlow();
    const key = newKey();
    mockCreditAvailability.mockResolvedValue({ available: true, code: 'ok' });
    mockCreditPayInTransaction.mockImplementation(async (client, args) => {
      // Executed idempotently on the attempt's idempotency key, inside the
      // same transaction as the attempt insert.
      expect(String(args.idempotencyKey)).toBe(key);
      const row = store.attempts.find((a) => a.id === args.attemptId);
      expect(row).toBeDefined();
      row.status = 'succeeded';
      row.settled_at = new Date().toISOString();
      return {
        attemptId: row.id,
        status: 'succeeded',
        settledAt: row.settled_at,
        amountCents: Number(row.amount_cents),
        currency: 'USD',
        method: 'credit',
        installment: row.installment,
        replayed: false,
        creditTransactionId: 'ct-1',
      };
    });

    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: key,
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'credit',
      });

    expect(res.status).toBe(201);
    expect(mockCreditAvailability).toHaveBeenCalled();
    expect(mockCreditPayInTransaction).toHaveBeenCalledTimes(1);
    expect(res.body.data.attempt.method).toBe('credit');
    expect(res.body.data.attempt.status).toBe('succeeded');
    expect(res.body.data.credit.status).toBe('succeeded');
    expect(res.body.data.credit.creditTransactionId).toBe('ct-1');
    expect(res.body.data.client_secret).toBeNull();
    expect(stripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('credit checkout fails closed with the availability code when the rail is unavailable', async () => {
    const { po } = seedPoFlow();
    mockCreditAvailability.mockResolvedValue({
      available: false,
      code: 'credit_rail_suspended',
      message: 'OxSteed Credit is temporarily suspended',
    });

    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'credit',
      });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('credit_rail_suspended');
    expect(mockCreditPayInTransaction).not.toHaveBeenCalled();
    expect(stripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('pooled participant flow computes from the participant quote', async () => {
    const part = fakeDb.seedParticipant(store, { id: 201, user_id: BUYER });
    fakeDb.seedQuote(store, {
      subject_type: 'pooled_participant',
      participant_id: part.id,
      deposit_cents: 1500,
      final_cents: 3500,
      total_cents: 5000,
    });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'pooled_participant',
        participant_id: part.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.attempt.amount_cents).toBe(1500);
  });
});

describe('amount tampering is rejected, never adjusted', () => {
  test('client amount higher than expected → 422', async () => {
    const { po } = seedPoFlow();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
        amount_cents: 30000, // attacker inflates the charge
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('amount_mismatch');
    expect(store.attempts).toHaveLength(0);
    expect(stripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('client amount lower than expected → 422', async () => {
    const { po } = seedPoFlow();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
        amount_cents: 1, // attacker tries to pay a cent
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('amount_mismatch');
    expect(store.attempts).toHaveLength(0);
  });

  test('float / non-integer amounts are rejected', async () => {
    const { po } = seedPoFlow();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
        amount_cents: 30.5,
      });
    // Number(30.5) is not an integer → validation rejects before any money moves
    expect(res.status).toBe(400);
    expect(store.attempts).toHaveLength(0);
  });
});

describe('installment due checks', () => {
  test('fully-paid installment is not due → 409, no duplicate charge', async () => {
    const { po } = seedPoFlow({ po: { deposit_paid_cents: 3000 } });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('installment_not_due');
    expect(store.attempts).toHaveLength(0);
    expect(stripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('partially-paid installment charges only the remainder', async () => {
    const { po } = seedPoFlow({ po: { deposit_paid_cents: 1000 } });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.attempt.amount_cents).toBe(2000); // 3000 due − 1000 paid
  });

  test('card payments below the Stripe USD minimum are rejected', async () => {
    const { po } = seedPoFlow({ quote: { deposit_cents: 30, final_cents: 9970, total_cents: 10000 } });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('amount_below_minimum');
  });
});

describe('quote acceptance gates', () => {
  test('draft (unaccepted) latest quote blocks collection → 409', async () => {
    const { po, quote } = seedPoFlow();
    quote.status = 'draft';
    quote.accepted_at = null;
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_not_accepted');
    expect(store.attempts).toHaveLength(0);
  });

  test('a newer quote version supersedes the accepted one → collection blocked', async () => {
    const { po } = seedPoFlow();
    // Organizer issued v2 (still a draft): the accepted v1 is stale.
    fakeDb.seedQuote(store, {
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      version: 2,
      status: 'draft',
      accepted_at: null,
      deposit_cents: 4000,
      final_cents: 8000,
      total_cents: 12000,
    });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_not_accepted');
  });

  test('a newer ACCEPTED quote version is the one collected against', async () => {
    const { po } = seedPoFlow();
    fakeDb.seedQuote(store, {
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      version: 2,
      status: 'accepted',
      deposit_cents: 4000,
      final_cents: 8000,
      total_cents: 12000,
    });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.attempt.amount_cents).toBe(4000);
    expect(res.body.data.attempt.quote_id).toBe(2);
  });

  test('expired quote blocks collection → 409', async () => {
    const { po, quote } = seedPoFlow();
    quote.valid_until = new Date(Date.now() - 1000).toISOString();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_expired');
  });

  test('missing quote blocks collection → 409', async () => {
    const po = fakeDb.seedPurchaseOrder(store, { id: 102, buyer_user_id: BUYER });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_missing');
  });
});

describe('ownership and authorization', () => {
  test("another buyer's order → 403", async () => {
    const { po } = seedPoFlow();
    const res = await request(otherApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(403);
    expect(store.attempts).toHaveLength(0);
  });

  test("another buyer's participation → 403", async () => {
    const part = fakeDb.seedParticipant(store, { id: 202, user_id: BUYER });
    fakeDb.seedQuote(store, { subject_type: 'pooled_participant', participant_id: part.id });
    const res = await request(otherApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'pooled_participant',
        participant_id: part.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(403);
  });

  test('business member may pay for a business-owned order', async () => {
    const po = fakeDb.seedPurchaseOrder(store, {
      id: 103, buyer_user_id: 'someone-else', buyer_business_id: 55,
    });
    fakeDb.seedQuote(store, { subject_type: 'purchase_order', purchase_order_id: po.id });
    store.businessMembers.push({ business_id: 55, user_id: BUYER });
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: po.id,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(201);
  });

  test('missing order → 404', async () => {
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: newKey(),
        subject_type: 'purchase_order',
        purchase_order_id: 99999,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(404);
  });

  test('unauthenticated requests never reach the service', async () => {
    const res = await request(guestApp())
      .post('/checkout/attempt')
      .send({ idempotency_key: newKey() });
    expect(res.status).toBe(401);
  });
});

describe('idempotency: concurrent duplicate submissions create one attempt', () => {
  test('two concurrent requests with the same key converge on one row and one Stripe intent', async () => {
    seedPoFlow();
    const key = newKey();
    const payload = {
      idempotency_key: key,
      subject_type: 'purchase_order',
      purchase_order_id: 101,
      installment: 'deposit',
      method: 'stripe',
    };
    const app = buyerApp();
    const [r1, r2] = await Promise.all([
      request(app).post('/checkout/attempt').send(payload),
      request(app).post('/checkout/attempt').send(payload),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200); // replay
    expect(r2.body.idempotent_replay).toBe(true);
    expect(r1.body.data.attempt.id).toBe(r2.body.data.attempt.id);
    expect(store.attempts).toHaveLength(1);
    // Only one PaymentIntent was ever created at Stripe: no double charge.
    expect(stripeInstance.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  test('sequential retry with the same key returns the existing attempt', async () => {
    const { po } = seedPoFlow();
    const key = newKey();
    const payload = {
      idempotency_key: key,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      installment: 'deposit',
      method: 'stripe',
    };
    const first = await request(buyerApp()).post('/checkout/attempt').send(payload);
    const second = await request(buyerApp()).post('/checkout/attempt').send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.attempt.id).toBe(first.body.data.attempt.id);
    expect(store.attempts).toHaveLength(1);
    expect(stripeInstance.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  test('reusing a key for DIFFERENT payment params → 409, no new attempt', async () => {
    const { po } = seedPoFlow();
    const key = newKey();
    const base = {
      idempotency_key: key,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      installment: 'deposit',
      method: 'stripe',
    };
    const first = await request(buyerApp()).post('/checkout/attempt').send(base);
    expect(first.status).toBe(201);
    // Same key, but now for the final installment: must be rejected, not
    // silently attached to the deposit attempt.
    const second = await request(buyerApp())
      .post('/checkout/attempt')
      .send({ ...base, installment: 'final' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('idempotency_key_reused');
    expect(store.attempts).toHaveLength(1);
  });

  test('reusing another buyer\'s key → 409', async () => {
    const { po } = seedPoFlow();
    const key = newKey();
    const first = await request(buyerApp()).post('/checkout/attempt').send({
      idempotency_key: key,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      installment: 'deposit',
      method: 'stripe',
    });
    expect(first.status).toBe(201);
    // The other buyer cannot even get past ownership, which fails first.
    const second = await request(otherApp()).post('/checkout/attempt').send({
      idempotency_key: key,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      installment: 'deposit',
      method: 'stripe',
    });
    expect([403, 409]).toContain(second.status);
    expect(store.attempts).toHaveLength(1);
  });

  test('non-UUID idempotency key is rejected', async () => {
    seedPoFlow();
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({
        idempotency_key: 'not-a-uuid',
        subject_type: 'purchase_order',
        purchase_order_id: 101,
        installment: 'deposit',
        method: 'stripe',
      });
    expect(res.status).toBe(400);
    expect(store.attempts).toHaveLength(0);
  });
});

describe('GET /checkout/attempt/:id', () => {
  test('owner can read their attempt', async () => {
    const attempt = fakeDb.seedAttempt(store, { buyer_user_id: BUYER, status: 'succeeded' });
    const res = await request(buyerApp()).get(`/checkout/attempt/${attempt.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.attempt.id).toBe(attempt.id);
    // internal failure detail is not exposed
    expect(res.body.data.attempt.failure_message).toBeUndefined();
  });

  test('another buyer gets 404 (no existence leak)', async () => {
    const attempt = fakeDb.seedAttempt(store, { buyer_user_id: BUYER });
    const res = await request(otherApp()).get(`/checkout/attempt/${attempt.id}`);
    expect(res.status).toBe(404);
  });

  test('staff (admin) can read any attempt', async () => {
    mockResolveLogisticsRole.mockResolvedValue('admin');
    const attempt = fakeDb.seedAttempt(store, { buyer_user_id: BUYER });
    const res = await request(otherApp()).get(`/checkout/attempt/${attempt.id}`);
    expect(res.status).toBe(200);
  });

  test('non-staff non-owner gets 404 (no existence leak, no role oracle)', async () => {
    mockResolveLogisticsRole.mockResolvedValue('individual_buyer');
    const attempt = fakeDb.seedAttempt(store, { buyer_user_id: 'third-party' });
    const res = await request(otherApp()).get(`/checkout/attempt/${attempt.id}`);
    expect(res.status).toBe(404);
  });

  test('unknown id → 404', async () => {
    const res = await request(buyerApp()).get('/checkout/attempt/424242');
    expect(res.status).toBe(404);
  });
});

describe('feature flag gate', () => {
  test('all payment endpoints answer 503 while disabled', async () => {
    delete process.env.LOGISTICS_PAYMENTS_ENABLED;
    const post = await request(buyerApp())
      .post('/checkout/attempt')
      .send({ idempotency_key: newKey() });
    expect(post.status).toBe(503);
    expect(post.body.code).toBe('logistics_payments_disabled');

    const get = await request(buyerApp()).get('/checkout/attempt/1');
    expect(get.status).toBe(503);

    const recon = await request(buyerApp()).get('/checkout/reconciliation');
    expect(recon.status).toBe(503);

    expect(store.attempts).toHaveLength(0);
    expect(stripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('explicit false disables too', async () => {
    process.env.LOGISTICS_PAYMENTS_ENABLED = 'false';
    const res = await request(buyerApp())
      .post('/checkout/attempt')
      .send({ idempotency_key: newKey() });
    expect(res.status).toBe(503);
  });
});

describe('service-level guards', () => {
  test('createPaymentAttempt throws when Stripe is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    seedPoFlow();
    await expect(paymentsService.createPaymentAttempt(BUYER, {
      idempotencyKey: newKey(),
      subjectType: 'purchase_order',
      purchaseOrderId: 101,
      installment: 'deposit',
      method: 'stripe',
    })).rejects.toMatchObject({ code: 'stripe_not_configured' });
  });

  test('transient Stripe errors leave the attempt pending for retry', async () => {
    seedPoFlow();
    const err = new Error('socket hangup');
    err.statusCode = 0;
    stripeInstance.paymentIntents.create.mockRejectedValueOnce(err);
    await expect(paymentsService.createPaymentAttempt(BUYER, {
      idempotencyKey: newKey(),
      subjectType: 'purchase_order',
      purchaseOrderId: 101,
      installment: 'deposit',
      method: 'stripe',
    })).rejects.toMatchObject({ code: 'processor_unavailable' });
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0].status).toBe('pending');
    expect(store.attempts[0].stripe_payment_intent_id).toBeNull();
  });

  test('processor declines at creation mark the attempt failed', async () => {
    seedPoFlow();
    const err = new Error('Your card was declined.');
    err.code = 'card_declined';
    err.statusCode = 402;
    stripeInstance.paymentIntents.create.mockRejectedValueOnce(err);
    await expect(paymentsService.createPaymentAttempt(BUYER, {
      idempotencyKey: newKey(),
      subjectType: 'purchase_order',
      purchaseOrderId: 101,
      installment: 'deposit',
      method: 'stripe',
    })).rejects.toMatchObject({ code: 'processor_error' });
    expect(store.attempts[0].status).toBe('failed');
    expect(store.attempts[0].failure_code).toBe('card_declined');
  });
});
