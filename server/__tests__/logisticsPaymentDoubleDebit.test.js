'use strict';
/**
 * Phase 3 logistics payments — double-debit guards (Fix 2).
 *
 * Proves:
 *  - two concurrent different-key attempts for the same (subject,
 *    installment): the first settlement wins; the second is marked
 *    'superseded' and never credited twice (the installment's paid cents
 *    bump exactly once), with a 'duplicate_charge_superseded'
 *    reconciliation item so staff can refund the duplicate processor
 *    charge through the dual-admin refund flow;
 *  - the true settlement race (partial unique index violation on the
 *    settlement UPDATE) is converted to the same superseded path instead
 *    of 500ing the webhook (which Stripe would retry into the same 500);
 *  - idempotent replay of a stripe attempt returns the persisted client
 *    secret so an interrupted checkout can recover card confirmation;
 *  - duplicate and out-of-order webhooks stay idempotent (no double
 *    credit, no resurrection of terminal states).
 */
const { mockQuery, resetMocks } = require('./setup');
const fakeDb = require('./helpers/logisticsPaymentFakeDb');

const mockSendNotification = jest.fn().mockResolvedValue({ id: 1 });
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));

const stripe = require('stripe');
const stripeInstance = stripe.__mockInstance;

const paymentsService = require('../services/logisticsPaymentService');

const BUYER = 'buyer-1';
let store;

const KEY_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const KEY_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const KEY_C = 'cccccccc-3333-4333-8333-cccccccccccc';

function seedTwoKeyFlow() {
  const po = fakeDb.seedPurchaseOrder(store, { id: 101, buyer_user_id: BUYER });
  const quote = fakeDb.seedQuote(store, {
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    deposit_cents: 3000,
    final_cents: 7000,
    total_cents: 10000,
  });
  const attemptA = fakeDb.seedAttempt(store, {
    buyer_user_id: BUYER,
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    quote_id: quote.id,
    installment: 'deposit',
    amount_cents: 3000,
    method: 'stripe',
    status: 'processing',
    idempotency_key: KEY_A,
    stripe_payment_intent_id: 'pi_key_a',
  });
  const attemptB = fakeDb.seedAttempt(store, {
    buyer_user_id: BUYER,
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    quote_id: quote.id,
    installment: 'deposit',
    amount_cents: 3000,
    method: 'stripe',
    status: 'processing',
    idempotency_key: KEY_B,
    stripe_payment_intent_id: 'pi_key_b',
  });
  return { po, quote, attemptA, attemptB };
}

function succeededEvent(attempt, eventId) {
  return {
    id: eventId || `evt_succeeded_${attempt.id}_${Math.floor(Math.random() * 1e9)}`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: attempt.stripe_payment_intent_id,
        amount: attempt.amount_cents,
        currency: 'usd',
        metadata: { logistics_payment_attempt_id: String(attempt.id) },
      },
    },
  };
}

function failedEvent(attempt, eventId) {
  return {
    id: eventId || `evt_failed_${attempt.id}_${Math.floor(Math.random() * 1e9)}`,
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: attempt.stripe_payment_intent_id,
        metadata: { logistics_payment_attempt_id: String(attempt.id) },
        last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
      },
    },
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  store = fakeDb.createStore();
  fakeDb.installRoutes(mockQuery, store);
  process.env.LOGISTICS_PAYMENTS_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  stripeInstance.paymentIntents.create.mockResolvedValue({
    id: 'pi_test_123',
    client_secret: 'secret_test_123',
  });
});

async function flushNotifications() {
  await new Promise((resolve) => { setImmediate(resolve); });
  await new Promise((resolve) => { setImmediate(resolve); });
}

afterEach(async () => {
  // Drain best-effort notification immediates before teardown.
  await flushNotifications();
  delete process.env.LOGISTICS_PAYMENTS_ENABLED;
});

describe('concurrent different-key attempts on one installment', () => {
  test('the second settlement is superseded; the installment is credited exactly once', async () => {
    const { po, attemptA, attemptB } = seedTwoKeyFlow();

    const first = await paymentsService.handleStripeEvent(succeededEvent(attemptA));
    expect(first.outcome).toBe('settled');
    expect(po.deposit_paid_cents).toBe(3000);

    const second = await paymentsService.handleStripeEvent(succeededEvent(attemptB));
    expect(second.handled).toBe(true);
    expect(second.outcome).toBe('superseded_duplicate');

    const rowB = store.attempts.find((a) => a.id === attemptB.id);
    expect(rowB.status).toBe('superseded');
    // Exactly one credit, even though the processor charged twice.
    expect(po.deposit_paid_cents).toBe(3000);

    const succeeded = store.attempts.filter((a) => a.status === 'succeeded');
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].id).toBe(attemptA.id);

    // Staff get a reconciliation item to refund the duplicate charge.
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('duplicate_charge_superseded');
    expect(store.recon[0].entity_id).toBe(attemptB.id);
    expect(store.recon[0].payload.superseding_attempt_id).toBe(attemptA.id);
    expect(store.recon[0].payload.amount_cents).toBe(3000);
  });

  test('a true settlement race (unique-index violation) converts to superseded instead of 500ing', async () => {
    const { attemptB } = seedTwoKeyFlow();
    const event = succeededEvent(attemptB, 'evt_race_1');
    // Simulate the interleaving: the concurrent winner commits between
    // our sibling recheck and our settlement UPDATE.
    store.failSettledUpdateOnce = { plantSucceededSibling: true, unclaimEventId: event.id };

    const result = await paymentsService.handleStripeEvent(event);

    expect(result.handled).toBe(true);
    expect(result.outcome).toBe('superseded_duplicate');
    const rowB = store.attempts.find((a) => a.id === attemptB.id);
    expect(rowB.status).toBe('superseded');
    // The event was claimed exactly once overall (the aborted attempt's
    // claim rolled back with its transaction).
    const claims = store.webhookEvents.filter((e) => e.stripe_event_id === event.id);
    expect(claims).toHaveLength(1);
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('duplicate_charge_superseded');
    expect(store.recon[0].payload.concurrent_race).toBe(true);
  });

  test('different installments are unaffected by the guard', async () => {
    const { po, quote, attemptA } = seedTwoKeyFlow();
    const attemptFinal = fakeDb.seedAttempt(store, {
      buyer_user_id: BUYER,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      quote_id: quote.id,
      installment: 'final',
      amount_cents: 7000,
      method: 'stripe',
      status: 'processing',
      idempotency_key: KEY_C,
      stripe_payment_intent_id: 'pi_key_final',
    });

    expect((await paymentsService.handleStripeEvent(succeededEvent(attemptA))).outcome).toBe('settled');
    expect((await paymentsService.handleStripeEvent(succeededEvent(attemptFinal))).outcome).toBe('settled');
    expect(po.deposit_paid_cents).toBe(3000);
    expect(po.final_paid_cents).toBe(7000);
    expect(store.recon).toHaveLength(0);
  });
});

describe('settleCreditAttempt honors the same guard', () => {
  test('a credit settlement loses to an already-succeeded stripe attempt', async () => {
    const { po, quote } = seedTwoKeyFlow();
    const stripeAttempt = store.attempts.find((a) => a.idempotency_key === KEY_A);
    stripeAttempt.status = 'succeeded';
    stripeAttempt.settled_at = new Date().toISOString();
    po.deposit_paid_cents = 3000;

    const creditAttempt = fakeDb.seedAttempt(store, {
      buyer_user_id: BUYER,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      quote_id: quote.id,
      installment: 'deposit',
      amount_cents: 3000,
      method: 'credit',
      status: 'processing',
      idempotency_key: KEY_C,
      stripe_payment_intent_id: null,
      stripe_client_secret: null,
    });

    const result = await paymentsService.settleCreditAttempt(creditAttempt.id, {
      amountCents: 3000,
      creditReference: 'cr_test_1',
    });

    expect(result.superseded).toBe(true);
    expect(result.attempt.status).toBe('superseded');
    // No second credit to the installment.
    expect(po.deposit_paid_cents).toBe(3000);
    // Staff must reverse the duplicate credit debit (it already committed
    // upstream in the credit ledger).
    expect(store.recon).toHaveLength(1);
    expect(store.recon[0].payload.kind).toBe('duplicate_charge_superseded');
    expect(store.recon[0].payload.method).toBe('credit');
    expect(store.recon[0].payload.credit_reference).toBe('cr_test_1');
  });

  test('a credit settlement with no sibling settles normally', async () => {
    const { po, quote } = seedTwoKeyFlow();
    const creditAttempt = fakeDb.seedAttempt(store, {
      buyer_user_id: BUYER,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      quote_id: quote.id,
      installment: 'deposit',
      amount_cents: 3000,
      method: 'credit',
      status: 'processing',
      idempotency_key: KEY_C,
      stripe_payment_intent_id: null,
      stripe_client_secret: null,
    });

    const result = await paymentsService.settleCreditAttempt(creditAttempt.id, { amountCents: 3000 });
    expect(result.superseded).toBeFalsy();
    expect(result.attempt.status).toBe('succeeded');
    expect(po.deposit_paid_cents).toBe(3000);
    expect(store.recon).toHaveLength(0);
  });
});

describe('idempotent replay returns the persisted client secret', () => {
  function seedPoFlow() {
    const po = fakeDb.seedPurchaseOrder(store, { id: 201, buyer_user_id: BUYER });
    const quote = fakeDb.seedQuote(store, {
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      deposit_cents: 3000,
      final_cents: 7000,
      total_cents: 10000,
    });
    return { po, quote };
  }

  test('stripe replay returns the stored secret so an interrupted checkout can recover', async () => {
    seedPoFlow();
    const input = {
      idempotencyKey: KEY_A,
      subjectType: 'purchase_order',
      purchaseOrderId: 201,
      installment: 'deposit',
      method: 'stripe',
    };
    const first = await paymentsService.createPaymentAttempt(BUYER, input);
    expect(first.idempotentReplay).toBe(false);
    expect(first.clientSecret).toBe('secret_test_123');

    const replay = await paymentsService.createPaymentAttempt(BUYER, input);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.attempt.id).toBe(first.attempt.id);
    // The secret is persisted at intent creation and returned on replay
    // (previously null), so stripe.js can resume confirmation.
    expect(replay.clientSecret).toBe('secret_test_123');

    const row = store.attempts.find((a) => a.id === first.attempt.id);
    expect(row.stripe_client_secret).toBe('secret_test_123');
  });

  test('credit replay returns no client secret', async () => {
    // Seed the credit attempt directly: the replay path converges on the
    // existing row before the (separately owned) credit-execution branch.
    const { po, quote } = seedPoFlow();
    fakeDb.seedAttempt(store, {
      buyer_user_id: BUYER,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      quote_id: quote.id,
      installment: 'deposit',
      amount_cents: 3000,
      method: 'credit',
      status: 'succeeded',
      idempotency_key: KEY_B,
      stripe_payment_intent_id: null,
      stripe_client_secret: null,
    });
    const replay = await paymentsService.createPaymentAttempt(BUYER, {
      idempotencyKey: KEY_B,
      subjectType: 'purchase_order',
      purchaseOrderId: po.id,
      installment: 'deposit',
      method: 'credit',
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.clientSecret).toBeNull();
  });
});

describe('duplicate and out-of-order webhooks stay idempotent', () => {
  test('duplicate delivery of one succeeded event credits once', async () => {
    const { po, attemptA } = seedTwoKeyFlow();
    const event = succeededEvent(attemptA, 'evt_dup_1');
    const first = await paymentsService.handleStripeEvent(event);
    const second = await paymentsService.handleStripeEvent(event);
    expect(first.outcome).toBe('settled');
    expect(second.duplicate).toBe(true);
    expect(po.deposit_paid_cents).toBe(3000);
  });

  test('a second succeeded event for the settled attempt is a no-op', async () => {
    const { po, attemptA } = seedTwoKeyFlow();
    await paymentsService.handleStripeEvent(succeededEvent(attemptA, 'evt_s1'));
    const replay = await paymentsService.handleStripeEvent(succeededEvent(attemptA, 'evt_s2'));
    expect(replay.outcome).toBe('already_settled');
    expect(po.deposit_paid_cents).toBe(3000);
  });

  test('payment_failed after succeeded never downgrades the settlement', async () => {
    const { po, attemptA } = seedTwoKeyFlow();
    await paymentsService.handleStripeEvent(succeededEvent(attemptA));
    const result = await paymentsService.handleStripeEvent(failedEvent(attemptA));
    expect(result.outcome).toBe('terminal_noop');
    expect(store.attempts.find((a) => a.id === attemptA.id).status).toBe('succeeded');
    expect(po.deposit_paid_cents).toBe(3000);
  });
});
