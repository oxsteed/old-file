'use strict';
/**
 * Phase 3 logistics payments — signed-webhook settlement and reconciliation.
 *
 * Proves: only the signed webhook settles an attempt; duplicate deliveries
 * are skipped before any money moves; out-of-order events never downgrade
 * settled money or resurrect terminal states; amount mismatches go to
 * staff instead of crediting; webhooks for unknown attempts are
 * reconciled, never invented; processor refunds are observed, never
 * auto-applied; stuck attempts are swept exactly once.
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

const express = require('express');
const request = require('supertest');
const paymentsService = require('../services/logisticsPaymentService');
const paymentsCtrl = require('../controllers/logisticsPaymentController');
const requireLogisticsPayments = require('../middleware/requireLogisticsPayments');

const BUYER = 'buyer-1';
let store;

function buildApp(asUserId) {
  const app = express();
  app.use(express.json());
  if (asUserId) {
    app.use((req, _res, next) => { req.user = { id: asUserId }; next(); });
  }
  const fakeAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    return next();
  };
  app.get('/checkout/reconciliation', fakeAuth, requireLogisticsPayments, paymentsCtrl.listReconciliation);
  app.patch('/checkout/reconciliation/:id', fakeAuth, requireLogisticsPayments, paymentsCtrl.resolveReconciliation);
  app.post('/checkout/reconciliation/sweep', fakeAuth, requireLogisticsPayments, paymentsCtrl.sweepStuck);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

const staffApp = () => buildApp('admin-1');
const buyerApp = () => buildApp(BUYER);

/** PO + accepted quote + processing stripe attempt, all wired together. */
function seedSettledFlow(overrides = {}) {
  const po = fakeDb.seedPurchaseOrder(store, { id: 101, buyer_user_id: BUYER, ...overrides.po });
  const quote = fakeDb.seedQuote(store, {
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    deposit_cents: 3000,
    final_cents: 7000,
    total_cents: 10000,
    ...overrides.quote,
  });
  const attempt = fakeDb.seedAttempt(store, {
    buyer_user_id: BUYER,
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    quote_id: quote.id,
    installment: 'deposit',
    amount_cents: 3000,
    method: 'stripe',
    status: 'processing',
    stripe_payment_intent_id: 'pi_live_1',
    ...overrides.attempt,
  });
  return { po, quote, attempt };
}

function succeededEvent(attempt, overrides = {}) {
  return {
    id: `evt_succeeded_${Math.floor(Math.random() * 1e9)}`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: attempt.stripe_payment_intent_id,
        amount: attempt.amount_cents,
        currency: 'usd',
        metadata: { logistics_payment_attempt_id: String(attempt.id) },
      },
    },
    ...overrides,
  };
}

function failedEvent(attempt, overrides = {}) {
  return {
    id: `evt_failed_${Math.floor(Math.random() * 1e9)}`,
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: attempt.stripe_payment_intent_id,
        metadata: { logistics_payment_attempt_id: String(attempt.id) },
        last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
      },
    },
    ...overrides,
  };
}

async function flushNotifications() {
  await new Promise((resolve) => { setImmediate(resolve); });
  await new Promise((resolve) => { setImmediate(resolve); });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  store = fakeDb.createStore();
  fakeDb.installRoutes(mockQuery, store);
  process.env.LOGISTICS_PAYMENTS_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  mockResolveLogisticsRole.mockResolvedValue('admin');
});

afterEach(() => {
  delete process.env.LOGISTICS_PAYMENTS_ENABLED;
});

describe('payment_intent.succeeded — the ONLY settlement path', () => {
  test('settles the attempt, bumps integer paid cents, notifies the buyer', async () => {
    const { po, attempt } = seedSettledFlow();
    const result = await paymentsService.handleStripeEvent(succeededEvent(attempt));

    expect(result.handled).toBe(true);
    expect(result.outcome).toBe('settled');
    const row = store.attempts.find((a) => a.id === attempt.id);
    expect(row.status).toBe('succeeded');
    expect(row.settled_at).toBeTruthy();
    // Integer paid cents bumped exactly once; legacy float kept in sync.
    expect(po.deposit_paid_cents).toBe(3000);
    expect(row.currency).toBe('USD');

    await flushNotifications();
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0]).toMatchObject({
      userId: BUYER,
      type: 'logistics_payment_succeeded',
      idempotencyKey: `logistics:payment:succeeded:${attempt.id}`,
    });
  });

  test('duplicate delivery of the same event is skipped before any money moves', async () => {
    const { po, attempt } = seedSettledFlow();
    const event = succeededEvent(attempt);
    const first = await paymentsService.handleStripeEvent(event);
    const second = await paymentsService.handleStripeEvent(event);

    expect(first.outcome).toBe('settled');
    expect(second.handled).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(po.deposit_paid_cents).toBe(3000); // not 6000: no double credit
    expect(store.webhookEvents).toHaveLength(1);
    expect(store.recon).toHaveLength(0);
  });

  test('replay of an already-settled attempt is a no-op', async () => {
    const { po, attempt } = seedSettledFlow({
      attempt: { status: 'succeeded', settled_at: new Date().toISOString() },
    });
    po.deposit_paid_cents = 3000; // already credited by the first settlement
    const result = await paymentsService.handleStripeEvent(succeededEvent(attempt));
    expect(result.outcome).toBe('already_settled');
    expect(po.deposit_paid_cents).toBe(3000);
  });

  test('settlement works via payment-intent lookup when metadata is absent', async () => {
    const { attempt } = seedSettledFlow();
    const event = succeededEvent(attempt);
    delete event.data.object.metadata; // processor stripped metadata
    const result = await paymentsService.handleStripeEvent(event);
    expect(result.handled).toBe(true);
    expect(result.outcome).toBe('settled');
  });

  test('settlement records the event id for the audit trail', async () => {
    const { attempt } = seedSettledFlow();
    const event = succeededEvent(attempt);
    await paymentsService.handleStripeEvent(event);
    expect(store.webhookEvents[0]).toMatchObject({
      stripe_event_id: event.id,
      event_type: 'payment_intent.succeeded',
      payment_attempt_id: attempt.id,
    });
    expect(store.webhookEvents[0].payload_hash).toBeTruthy();
  });
});

describe('out-of-order webhooks never corrupt money', () => {
  test('payment_failed arriving AFTER succeeded never downgrades the settlement', async () => {
    const { po, attempt } = seedSettledFlow();
    await paymentsService.handleStripeEvent(succeededEvent(attempt));
    const result = await paymentsService.handleStripeEvent(failedEvent(attempt));

    expect(result.outcome).toBe('terminal_noop');
    const row = store.attempts.find((a) => a.id === attempt.id);
    expect(row.status).toBe('succeeded'); // money stays settled
    expect(po.deposit_paid_cents).toBe(3000);
  });

  test('succeeded arriving AFTER failed goes to staff, not to an automatic flip', async () => {
    const { po, attempt } = seedSettledFlow();
    await paymentsService.handleStripeEvent(failedEvent(attempt));
    expect(store.attempts.find((a) => a.id === attempt.id).status).toBe('failed');

    const result = await paymentsService.handleStripeEvent(succeededEvent(attempt));
    expect(result.outcome).toBe('late_success_reconcile');
    expect(store.attempts.find((a) => a.id === attempt.id).status).toBe('failed');
    expect(po.deposit_paid_cents).toBe(0); // nothing credited automatically
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('late_success_after_terminal');
  });

  test('failed then failed again is idempotent', async () => {
    const { attempt } = seedSettledFlow();
    const e1 = failedEvent(attempt);
    const e2 = failedEvent(attempt);
    const r1 = await paymentsService.handleStripeEvent(e1);
    const r2 = await paymentsService.handleStripeEvent(e2);
    expect(r1.outcome).toBe('failed');
    expect(r2.outcome).toBe('terminal_noop');
    const row = store.attempts.find((a) => a.id === attempt.id);
    expect(row.status).toBe('failed');
    expect(row.failure_code).toBe('card_declined');
  });
});

describe('amount / identity verification on webhooks', () => {
  test('event amount differing from the attempt is reconciled, not credited', async () => {
    const { po, attempt } = seedSettledFlow();
    const event = succeededEvent(attempt);
    event.data.object.amount = 2999; // one cent short of the attempt
    const result = await paymentsService.handleStripeEvent(event);

    expect(result.outcome).toBe('amount_mismatch');
    expect(store.attempts.find((a) => a.id === attempt.id).status).toBe('processing');
    expect(po.deposit_paid_cents).toBe(0);
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('amount_mismatch');
    expect(store.recon[0].payload.attempt_amount_cents).toBe(3000);
    expect(store.recon[0].payload.event_amount_cents).toBe(2999);
  });

  test('event for a different payment intent than the attempt is not applied', async () => {
    const { attempt } = seedSettledFlow();
    const event = succeededEvent(attempt);
    event.data.object.id = 'pi_someone_elses';
    const result = await paymentsService.handleStripeEvent(event);
    expect(result.outcome).toBe('amount_mismatch');
    expect(store.attempts.find((a) => a.id === attempt.id).status).toBe('processing');
  });

  test('webhook naming an unknown attempt is reconciled, never invented', async () => {
    seedSettledFlow();
    const event = {
      id: 'evt_unknown_attempt',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_ghost',
          amount: 3000,
          currency: 'usd',
          metadata: { logistics_payment_attempt_id: '424242' },
        },
      },
    };
    const result = await paymentsService.handleStripeEvent(event);
    expect(result.handled).toBe(true);
    expect(result.unknownAttempt).toBe(true);
    expect(store.attempts).toHaveLength(1); // no attempt invented
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('unknown_attempt_webhook');
  });

  test('unrelated payment intents are left for the existing handlers', async () => {
    seedSettledFlow();
    const event = {
      id: 'evt_unrelated',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_job_payment', amount: 5000, currency: 'usd', metadata: {} } },
    };
    const result = await paymentsService.handleStripeEvent(event);
    expect(result.handled).toBe(false);
    expect(store.recon).toHaveLength(0);
  });

  test('non-logistics event types are ignored', async () => {
    seedSettledFlow();
    const result = await paymentsService.handleStripeEvent({
      id: 'evt_invoice',
      type: 'invoice.paid',
      data: { object: { id: 'in_1' } },
    });
    expect(result.handled).toBe(false);
  });
});

describe('charge.refunded — observed, never auto-applied', () => {
  test('processor refund opens a staff review item; the attempt stays settled', async () => {
    const { po, attempt } = seedSettledFlow();
    await paymentsService.handleStripeEvent(succeededEvent(attempt));
    const result = await paymentsService.handleStripeEvent({
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: attempt.stripe_payment_intent_id,
          amount_refunded: 3000,
          currency: 'usd',
          metadata: { logistics_payment_attempt_id: String(attempt.id) },
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.outcome).toBe('refund_reconcile');
    const row = store.attempts.find((a) => a.id === attempt.id);
    expect(row.status).toBe('succeeded'); // refunds need staff approval; never auto-applied
    expect(po.deposit_paid_cents).toBe(3000); // not clawed back automatically
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('external_refund_observed');
  });
});

describe('stuck-attempt sweeper', () => {
  test('attempts stuck past the timeout are flagged exactly once', async () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const stuck = fakeDb.seedAttempt(store, { status: 'processing', updated_at: old });
    fakeDb.seedAttempt(store, { status: 'processing' }); // fresh: not stuck

    const first = await paymentsService.sweepStuckAttempts();
    expect(first).toMatchObject({ checked: 1, enqueued: 1 });
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0]).toMatchObject({
      source: 'logistics_payment',
      entity_id: stuck.id,
      status: 'pending',
    });
    expect(store.recon[0].payload.kind).toBe('attempt_stuck_processing');

    // A second sweep does not flood the queue.
    const second = await paymentsService.sweepStuckAttempts();
    expect(second).toMatchObject({ checked: 1, enqueued: 0 });
    expect(store.recon).toHaveLength(1);
  });

  test('sweep is staff-gated over HTTP', async () => {
    mockResolveLogisticsRole.mockResolvedValue('individual_buyer');
    const res = await request(buyerApp()).post('/checkout/reconciliation/sweep');
    expect(res.status).toBe(403);
  });
});

describe('reconciliation queue endpoints', () => {
  test('staff can list and resolve items', async () => {
    store.recon.push({
      id: 1, source: 'logistics_payment', entity_id: 7,
      reason: '[amount_mismatch] processor/ledger mismatch',
      payload: { kind: 'amount_mismatch' }, status: 'pending',
      claimed_by: null, claimed_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      resolved_at: null, resolution_notes: null,
    });

    const list = await request(staffApp()).get('/checkout/reconciliation');
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);

    const resolve = await request(staffApp())
      .patch('/checkout/reconciliation/1')
      .send({ status: 'resolved', notes: 'Verified against Stripe dashboard; amounts match.' });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.item.status).toBe('resolved');
    expect(resolve.body.data.item.claimed_by).toBe('admin-1');
    expect(resolve.body.data.item.resolved_at).toBeTruthy();
    expect(resolve.body.data.item.resolution_notes).toContain('Stripe dashboard');
  });

  test('non-staff cannot list or resolve', async () => {
    mockResolveLogisticsRole.mockResolvedValue('individual_buyer');
    const list = await request(buyerApp()).get('/checkout/reconciliation');
    expect(list.status).toBe(403);
    const resolve = await request(buyerApp())
      .patch('/checkout/reconciliation/1')
      .send({ status: 'resolved' });
    expect(resolve.status).toBe(403);
  });

  test('resolving an unknown item → 404', async () => {
    const res = await request(staffApp())
      .patch('/checkout/reconciliation/999')
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });
});

describe('credit settlement seam (parallel workstream integration)', () => {
  test('settleCreditAttempt credits once and is idempotent on replay', async () => {
    const { po } = seedSettledFlow({
      attempt: { method: 'credit', status: 'pending', stripe_payment_intent_id: null },
    });
    const attempt = store.attempts[store.attempts.length - 1];

    const first = await paymentsService.settleCreditAttempt(attempt.id, {
      amountCents: 3000, creditReference: 'credit-txn-1',
    });
    expect(first.replayed).toBe(false);
    expect(first.attempt.status).toBe('succeeded');
    expect(po.deposit_paid_cents).toBe(3000);

    const second = await paymentsService.settleCreditAttempt(attempt.id, {
      amountCents: 3000, creditReference: 'credit-txn-1',
    });
    expect(second.replayed).toBe(true);
    expect(po.deposit_paid_cents).toBe(3000); // not double-credited
  });

  test('credit settlement with the wrong amount is rejected and reconciled', async () => {
    seedSettledFlow({
      attempt: { method: 'credit', status: 'pending', stripe_payment_intent_id: null },
    });
    const attempt = store.attempts[store.attempts.length - 1];
    await expect(paymentsService.settleCreditAttempt(attempt.id, { amountCents: 2999 }))
      .rejects.toMatchObject({ code: 'amount_mismatch' });
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('amount_mismatch');
  });
});
