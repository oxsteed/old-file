'use strict';

/**
 * Tests for OxSteed Credit Stripe top-ups (fiat money IN).
 *
 * The Stripe SDK is never hit: the top-up service takes an injectable
 * `getStripe` and the webhook route tests drive the verified-event envelope
 * with the shared `stripe` mock. The database is the suite's pg mock.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/localDeliveryPaymentService', () => ({
  handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }),
}));
jest.mock('../controllers/verificationController', () => ({
  recalculateBadges: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn(),
}));
jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  issueStepupChallenge: jest.fn(),
  verifyStepupChallenge: jest.fn(),
}));
jest.mock('../services/oxsteedCreditAdminService', () => ({
  confirmSettlementPayoutFromTransfer: jest.fn(),
  failSettlementPayoutFromTransfer: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const stripe = require('stripe')();
const { AppError, errorHandler } = require('../middleware/errorHandler');
const topupService = require('../services/oxsteedCreditTopupService');
const topupController = require('../controllers/oxsteedCreditTopupController');
const webhookRoutes = require('../routes/webhook');
const complianceService = require('../services/fiatComplianceService');
const stepupService = require('../services/stepupChallengeService');
const adminService = require('../services/oxsteedCreditAdminService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const TOPUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const baseTopupRow = {
  id: TOPUP_ID,
  customer_id: CUSTOMER_ID,
  account_id: null,
  amount_cents: 5000,
  currency_code: 'USD',
  status: 'pending',
  stripe_payment_intent_id: null,
  idempotency_key: 'idem-key-1',
  journal_transaction_id: null,
  expires_at: '2031-10-01T14:30:00.000Z',
  created_at: '2026-10-01T14:00:00.000Z',
  updated_at: '2026-10-01T14:00:00.000Z',
};

const walletRow = {
  id: 101,
  account_type: 'customer_wallet',
  customer_id: CUSTOMER_ID,
  partner_id: null,
  restaurant_id: null,
  currency_code: 'USD',
  balance_cents: 0,
  reserved_cents: 0,
  status: 'active',
  ledger_version: 0,
  last_entry_hash: null,
  last_posted_at: null,
};

const treasuryRow = {
  id: 202,
  account_type: 'platform_treasury',
  customer_id: null,
  partner_id: null,
  restaurant_id: null,
  currency_code: 'USD',
  balance_cents: 1000000,
  reserved_cents: 0,
  status: 'active',
  ledger_version: 4,
  last_entry_hash: 'prevhash',
  last_posted_at: '2026-10-01T13:00:00.000Z',
};

const txRow = {
  id: 'tx-uuid-1',
  transaction_type: 'load',
  status: 'posted',
  debit_account_id: 202,
  credit_account_id: 101,
  amount_cents: 5000,
  currency_code: 'USD',
  partner_id: null,
  agreement_id: null,
  idempotency_key: `credit-topup:${TOPUP_ID}`,
  correlation_id: null,
  reference_type: 'stripe_topup',
  reference_id: 'pi_topup_1',
  description: 'Stripe top-up',
  reason: 'Stripe top-up',
  actor_type: 'system',
  actor_user_id: null,
  metadata: { source: 'stripe_topup', stripePaymentIntentId: 'pi_topup_1' },
  posted_at: '2026-10-01T14:01:00.000Z',
  created_at: '2026-10-01T14:01:00.000Z',
};

// Route query stubs by SQL fragment; anything unmatched falls back to the
// suite default empty result (BEGIN/COMMIT, incidental lookups).
function stubQueries(handlers) {
  const queue = handlers.map((h) => ({ ...h, used: false }));
  mockQuery.mockImplementation((sql) => {
    if (typeof sql === 'string') {
      const hit = queue.find((h) => !h.used
        && (typeof h.match === 'string' ? sql.includes(h.match) : h.match.test(sql)));
      if (hit) {
        hit.used = true;
        if (hit.fail) return Promise.reject(hit.fail);
        return Promise.resolve({ rows: hit.rows || [], rowCount: (hit.rows || []).length });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function railEnabledHandlers(enabled = true) {
  return [
    { match: 'pg_advisory_xact_lock', rows: [] },
    { match: 'FROM feature_flags', rows: [{ is_enabled: enabled }] },
  ];
}

function makeFakeStripe(overrides = {}) {
  return {
    paymentIntents: {
      create: jest.fn().mockResolvedValue({ id: 'pi_topup_1', client_secret: 'cs_topup_1' }),
      retrieve: jest.fn().mockResolvedValue({ id: 'pi_topup_1', client_secret: 'cs_topup_1' }),
      ...overrides,
    },
  };
}

function buildTopupApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, role: 'customer' };
    req.correlationId = 'corr-test-1';
    next();
  });
  app.post('/topups', topupController.createTopup);
  app.get('/topups/:id', topupController.getTopup);
  app.use(errorHandler);
  return app;
}

function buildWebhookApp() {
  const app = express();
  app.use('/api/webhooks', webhookRoutes);
  return app;
}

function sendStripeEvent(app, eventObj) {
  stripe.webhooks.constructEvent.mockReturnValueOnce(eventObj);
  return request(app)
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'test-sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(eventObj));
}

function receiptHandlers(receiptId = 88, eventId = 'evt_test') {
  return [
    { match: 'INSERT INTO webhook_event_receipts', rows: [{ id: receiptId }] },
    { match: 'INSERT INTO webhook_event_watermarks', rows: [{ event_id: eventId }] },
    { match: "SET status = 'processed'", rows: [] },
  ];
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  complianceService.evaluateFundingCompliance.mockResolvedValue({ allowed: true, checkedAt: '2026-10-01T14:00:00.000Z' });
  stepupService.verifyStepupChallenge.mockResolvedValue({ verified: true });
  adminService.confirmSettlementPayoutFromTransfer.mockResolvedValue({ confirmed: true });
  adminService.failSettlementPayoutFromTransfer.mockResolvedValue({ failed: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── createTopup: validation ──────────────────────────────────────────────
describe('createTopup validation', () => {
  test.each([
    ['zero', 0, 'credit_topup_amount_invalid', 400],
    ['negative', -100, 'credit_topup_amount_invalid', 400],
    ['non-integer', 10.5, 'credit_topup_amount_invalid', 400],
    ['non-numeric', 'abc', 'credit_topup_amount_invalid', 400],
    ['below minimum', 50, 'credit_topup_amount_too_small', 400],
    ['above maximum', 250001, 'credit_topup_amount_too_large', 402],
  ])('rejects %s amounts', async (_label, amountCents, code, status) => {
    await expect(topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents, currencyCode: 'USD', idempotencyKey: 'k1',
    })).rejects.toMatchObject({ code, statusCode: status });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a missing idempotency key', async () => {
    await expect(topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: '  ',
    })).rejects.toMatchObject({ code: 'credit_topup_idempotency_key_required', statusCode: 400 });
  });

  test('rejects an unsupported currency', async () => {
    await expect(topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'XXX', idempotencyKey: 'k1',
    })).rejects.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('fails closed with 503 when the credit rail is suspended', async () => {
    stubQueries(railEnabledHandlers(false));
    await expect(topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'k1',
    })).rejects.toMatchObject({ code: 'credit_rail_suspended', statusCode: 503 });
  });
});

// ── createTopup: Stripe intent lifecycle ─────────────────────────────────
describe('createTopup Stripe intent', () => {
  test('creates a pending top-up and a PaymentIntent with the deterministic idempotency key', async () => {
    const fakeStripe = makeFakeStripe();
    stubQueries([
      ...railEnabledHandlers(true),
      { match: 'INSERT INTO oxsteed_credit_topups', rows: [{ ...baseTopupRow }] },
      { match: 'SET stripe_payment_intent_id', rows: [] },
      { match: 'SELECT * FROM oxsteed_credit_topups WHERE id = $1', rows: [{ ...baseTopupRow, stripe_payment_intent_id: 'pi_topup_1' }] },
    ]);
    const result = await topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-key-1',
      getStripe: () => fakeStripe,
    });
    expect(result.clientSecret).toBe('cs_topup_1');
    expect(result.replayed).toBe(false);
    expect(result.topup.stripe_payment_intent_id).toBe('pi_topup_1');
    expect(fakeStripe.paymentIntents.create).toHaveBeenCalledWith(
      { amount: 5000, currency: 'usd', metadata: { oxsteed_credit_topup_id: TOPUP_ID } },
      { idempotencyKey: `stripe-topup-intent:${TOPUP_ID}` }
    );
  });

  test('replays an existing row on idempotency-key conflict and retrieves the Stripe secret', async () => {
    const fakeStripe = makeFakeStripe({
      retrieve: jest.fn().mockResolvedValue({ id: 'pi_existing', client_secret: 'cs_existing' }),
    });
    stubQueries([
      ...railEnabledHandlers(true),
      { match: 'INSERT INTO oxsteed_credit_topups', rows: [] },
      {
        match: 'SELECT * FROM oxsteed_credit_topups WHERE idempotency_key',
        rows: [{ ...baseTopupRow, stripe_payment_intent_id: 'pi_existing' }],
      },
      {
        match: 'SELECT * FROM oxsteed_credit_topups WHERE id = $1',
        rows: [{ ...baseTopupRow, stripe_payment_intent_id: 'pi_existing' }],
      },
    ]);
    const result = await topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-key-1',
      getStripe: () => fakeStripe,
    });
    expect(result.replayed).toBe(true);
    expect(result.clientSecret).toBe('cs_existing');
    expect(fakeStripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(fakeStripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_existing');
  });

  test('409s when the idempotency key is reused with different parameters', async () => {
    stubQueries([
      ...railEnabledHandlers(true),
      { match: 'INSERT INTO oxsteed_credit_topups', rows: [] },
      {
        match: 'SELECT * FROM oxsteed_credit_topups WHERE idempotency_key',
        rows: [{ ...baseTopupRow, amount_cents: 6000 }],
      },
    ]);
    const fakeStripe = makeFakeStripe();
    await expect(topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-key-1',
      getStripe: () => fakeStripe,
    })).rejects.toMatchObject({ code: 'credit_topup_idempotency_conflict', statusCode: 409 });
    expect(fakeStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  test('marks the top-up failed and throws 502 when Stripe rejects the intent', async () => {
    const fakeStripe = makeFakeStripe({
      create: jest.fn().mockRejectedValue(new Error('stripe is down')),
    });
    stubQueries([
      ...railEnabledHandlers(true),
      { match: 'INSERT INTO oxsteed_credit_topups', rows: [{ ...baseTopupRow }] },
      { match: "SET status = 'failed'", rows: [] },
    ]);
    await expect(topupService.createTopup({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-key-1',
      getStripe: () => fakeStripe,
    })).rejects.toMatchObject({ code: 'credit_topup_stripe_failed', statusCode: 502 });
    const failedUpdate = mockQuery.mock.calls.find((c) => c[0].includes("SET status = 'failed'"));
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate[1]).toEqual([TOPUP_ID]);
  });

  test('throws 503 credit_stripe_unavailable when no Stripe key is configured', async () => {
    stubQueries([
      ...railEnabledHandlers(true),
      { match: 'INSERT INTO oxsteed_credit_topups', rows: [{ ...baseTopupRow }] },
    ]);
    const previous = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      await expect(topupService.createTopup({
        customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-key-1',
      })).rejects.toMatchObject({ code: 'credit_stripe_unavailable', statusCode: 503 });
    } finally {
      if (previous !== undefined) process.env.STRIPE_SECRET_KEY = previous;
    }
  });
});

// ── Webhook completion: balanced journal posting ─────────────────────────
describe('completeCreditTopupFromWebhook', () => {
  function completionHandlers({ topupOverrides = {}, txInsert = null } = {}) {
    return [
      {
        match: 'FROM oxsteed_credit_topups WHERE stripe_payment_intent_id',
        rows: [{ ...baseTopupRow, stripe_payment_intent_id: 'pi_topup_1', ...topupOverrides }],
      },
      ...railEnabledHandlers(true),
      { match: 'pg_advisory_xact_lock', rows: [] },
      { match: 'COALESCE(SUM(balance_cents)', rows: [{ total_cents: 0 }] },
      { match: 'COALESCE(SUM(t.amount_cents)', rows: [{ total_cents: 0 }] },
      { match: 'INSERT INTO oxsteed_credit_accounts', rows: [] },
      { match: 'INSERT INTO oxsteed_credit_accounts', rows: [] },
      { match: 'SELECT a.* FROM oxsteed_credit_accounts', rows: [{ ...walletRow }] },
      { match: 'SELECT a.* FROM oxsteed_credit_accounts', rows: [{ ...treasuryRow }] },
      { match: 'SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key', rows: [] },
      { match: 'id = ANY', rows: [{ ...walletRow }, { ...treasuryRow }] },
      txInsert || { match: 'INSERT INTO oxsteed_credit_transactions', rows: [{ ...txRow }] },
      { match: 'WITH ledger_write AS', rows: [{ ...treasuryRow, balance_cents: 995000, ledger_version: 5 }] },
      { match: 'WITH ledger_write AS', rows: [{ ...walletRow, balance_cents: 5000, ledger_version: 1 }] },
      { match: 'INSERT INTO oxsteed_credit_transaction_entries', rows: [{ id: 'entry-1' }] },
      { match: 'INSERT INTO oxsteed_credit_transaction_entries', rows: [{ id: 'entry-2' }] },
      { match: "SET status = 'completed'", rows: [] },
    ];
  }

  test('pending -> completed posts exactly one balanced journal entry (debit treasury / credit wallet)', async () => {
    stubQueries(completionHandlers());
    const result = await topupService.completeCreditTopupFromWebhook({ paymentIntentId: 'pi_topup_1' });
    expect(result.outcome).toBe('completed');
    expect(result.transactionId).toBe('tx-uuid-1');

    const entryCalls = mockQuery.mock.calls.filter((c) => c[0].includes('INSERT INTO oxsteed_credit_transaction_entries'));
    expect(entryCalls).toHaveLength(2);
    const bySide = Object.fromEntries(entryCalls.map((c) => [c[1][2], c[1]]));
    expect(bySide.debit[1]).toBe(202);
    expect(bySide.debit[3]).toBe(5000);
    expect(bySide.credit[1]).toBe(101);
    expect(bySide.credit[3]).toBe(5000);
    expect(bySide.debit[0]).toBe(bySide.credit[0]);

    const txCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO oxsteed_credit_transactions'));
    expect(txCall[1][0]).toBe('load');
    expect(txCall[1][1]).toBe(202);
    expect(txCall[1][2]).toBe(101);
    expect(txCall[1][3]).toBe(5000);
    expect(txCall[1][4]).toBe('USD');
    expect(txCall[1][7]).toBe(`credit-topup:${TOPUP_ID}`);
    expect(txCall[1][9]).toBe('stripe_topup');
    expect(txCall[1][10]).toBe('pi_topup_1');

    const doneCall = mockQuery.mock.calls.find((c) => c[0].includes("SET status = 'completed'"));
    expect(doneCall[1]).toEqual([TOPUP_ID, 101, 'tx-uuid-1']);
  });

  test('a completed top-up is a duplicate no-op that never touches the journal', async () => {
    stubQueries(completionHandlers({ topupOverrides: { status: 'completed' } }));
    const result = await topupService.completeCreditTopupFromWebhook({ paymentIntentId: 'pi_topup_1' });
    expect(result.outcome).toBe('duplicate');
    expect(mockQuery.mock.calls.some((c) => c[0].includes('INSERT INTO oxsteed_credit_transactions'))).toBe(false);
  });

  test('an unknown payment intent is ignored', async () => {
    stubQueries([{
      match: 'FROM oxsteed_credit_topups WHERE stripe_payment_intent_id',
      rows: [],
    }]);
    const result = await topupService.completeCreditTopupFromWebhook({ paymentIntentId: 'pi_unknown' });
    expect(result.outcome).toBe('ignored');
  });

  test('journal-post failure parks requires_attention, records a critical incident, and rethrows', async () => {
    stubQueries([
      ...completionHandlers({ txInsert: { match: 'INSERT INTO oxsteed_credit_transactions', fail: new Error('journal boom') } })
        .filter((h) => !h.match.includes("SET status = 'completed'")),
      { match: "SET status = 'requires_attention'", rows: [] },
      {
        match: 'INSERT INTO incident_log',
        rows: [{ id: 9, type: 'oxsteed_credit_topup_uncredited' }],
      },
    ]);
    await expect(topupService.completeCreditTopupFromWebhook({ paymentIntentId: 'pi_topup_1' }))
      .rejects.toThrow('journal boom');

    const parked = mockQuery.mock.calls.find((c) => c[0].includes("SET status = 'requires_attention'"));
    expect(parked).toBeDefined();
    expect(parked[1]).toEqual([TOPUP_ID]);

    const incident = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO incident_log'));
    expect(incident).toBeDefined();
    expect(incident[1][0]).toBe('oxsteed_credit_topup_uncredited');
    expect(incident[1][1]).toBe('critical');
    expect(incident[1][2]).toBe('Stripe payment received but credit not posted');
    expect(incident[1][4]).toBe(`credit-topup-uncredited:${TOPUP_ID}`);
  });
});

describe('failCreditTopupFromWebhook', () => {
  test('marks a pending top-up failed', async () => {
    stubQueries([
      {
        match: 'FROM oxsteed_credit_topups WHERE stripe_payment_intent_id',
        rows: [{ id: TOPUP_ID, status: 'pending' }],
      },
      { match: "SET status = 'failed'", rows: [] },
    ]);
    const result = await topupService.failCreditTopupFromWebhook({ paymentIntentId: 'pi_topup_1' });
    expect(result.outcome).toBe('failed');
  });

  test('leaves completed and requires_attention rows untouched', async () => {
    for (const status of ['completed', 'requires_attention']) {
      resetMocks();
      stubQueries([{
        match: 'FROM oxsteed_credit_topups WHERE stripe_payment_intent_id',
        rows: [{ id: TOPUP_ID, status }],
      }]);
      const result = await topupService.failCreditTopupFromWebhook({ paymentIntentId: 'pi_topup_1' });
      expect(result.outcome).toBe('ignored');
      expect(mockQuery.mock.calls.some((c) => c[0].includes("SET status = 'failed'"))).toBe(false);
    }
  });
});

describe('applyCreditTopupWebhookEvent routing', () => {
  test('returns false (not ours) when our metadata is absent', async () => {
    expect(await topupService.applyCreditTopupWebhookEvent({
      type: 'payment_intent.succeeded', object: { id: 'pi_x', metadata: {} },
    })).toBe(false);
    expect(await topupService.applyCreditTopupWebhookEvent({
      type: 'transfer.created', object: { id: 'tr_x', metadata: {} },
    })).toBe(false);
    expect(await topupService.applyCreditTopupWebhookEvent({
      type: 'charge.refunded', object: { id: 'ch_x', metadata: { oxsteed_credit_topup_id: TOPUP_ID } },
    })).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── Controller ───────────────────────────────────────────────────────────
describe('top-up controller', () => {
  test('POST requires an idempotency key and runs no compliance check without one', async () => {
    const res = await request(buildTopupApp())
      .post('/topups')
      .send({ amountCents: 5000, currencyCode: 'USD' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credit_topup_idempotency_key_required');
    expect(complianceService.evaluateFundingCompliance).not.toHaveBeenCalled();
  });

  test('POST runs the fiat compliance gate before the service and returns 201', async () => {
    const createSpy = jest.spyOn(topupService, 'createTopup')
      .mockResolvedValue({ topup: { ...baseTopupRow }, clientSecret: 'cs_x', replayed: false });
    const res = await request(buildTopupApp())
      .post('/topups')
      .set('Idempotency-Key', 'idem-key-1')
      .send({ amountCents: 5000, currencyCode: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.topup.id).toBe(TOPUP_ID);
    expect(res.body.topup.amountCents).toBe(5000);
    expect(res.body.clientSecret).toBe('cs_x');
    expect(res.body.replayed).toBe(false);
    expect(complianceService.evaluateFundingCompliance).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      amountCents: 5000,
      currencyCode: 'USD',
      fundingMethod: 'stripe_topup',
      actorUserId: CUSTOMER_ID,
    }));
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-key-1',
    }));
    expect(createSpy.mock.invocationCallOrder[0])
      .toBeGreaterThan(complianceService.evaluateFundingCompliance.mock.invocationCallOrder[0]);
  });

  test('POST verifies a step-up challenge for large top-ups before the compliance gate', async () => {
    const createSpy = jest.spyOn(topupService, 'createTopup')
      .mockResolvedValue({ topup: { ...baseTopupRow, amount_cents: 150000 }, clientSecret: 'cs_big', replayed: false });
    const res = await request(buildTopupApp())
      .post('/topups')
      .set('Idempotency-Key', 'idem-big-1')
      .send({ amountCents: 150000, currencyCode: 'USD', stepupChallengeId: 'chal-1', stepupCode: '123456' });
    expect(res.status).toBe(201);
    expect(stepupService.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'chal-1',
      actorUserId: CUSTOMER_ID,
      actionType: 'topup',
      code: '123456',
    }));
    expect(stepupService.verifyStepupChallenge.mock.invocationCallOrder[0])
      .toBeLessThan(complianceService.evaluateFundingCompliance.mock.invocationCallOrder[0]);
    expect(createSpy).toHaveBeenCalled();
  });

  test('POST rejects a large top-up when step-up verification fails', async () => {
    stepupService.verifyStepupChallenge.mockRejectedValueOnce(new AppError('Verification code is incorrect', 403, 'credit_stepup_challenge_invalid'));
    const createSpy = jest.spyOn(topupService, 'createTopup');
    const res = await request(buildTopupApp())
      .post('/topups')
      .set('Idempotency-Key', 'idem-big-2')
      .send({ amountCents: 150000, currencyCode: 'USD', stepupChallengeId: 'chal-2', stepupCode: '000000' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_stepup_challenge_invalid');
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('POST returns 200 on idempotent replay', async () => {
    jest.spyOn(topupService, 'createTopup')
      .mockResolvedValue({ topup: { ...baseTopupRow }, clientSecret: null, replayed: true });
    const res = await request(buildTopupApp())
      .post('/topups')
      .set('Idempotency-Key', 'idem-key-1')
      .send({ amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'body-key-also-accepted' });
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
  });

  test('POST accepts the idempotency key from the body', async () => {
    const createSpy = jest.spyOn(topupService, 'createTopup')
      .mockResolvedValue({ topup: { ...baseTopupRow }, clientSecret: 'cs_x', replayed: false });
    const res = await request(buildTopupApp())
      .post('/topups')
      .send({ amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'body-key-1' });
    expect(res.status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'body-key-1' }));
  });

  test('POST does not create a top-up when compliance rejects', async () => {
    complianceService.evaluateFundingCompliance
      .mockRejectedValueOnce(new AppError('Top-up amount exceeds the maximum transaction size', 402, 'fiat_compliance_amount_limit'));
    const createSpy = jest.spyOn(topupService, 'createTopup');
    const res = await request(buildTopupApp())
      .post('/topups')
      .set('Idempotency-Key', 'idem-key-1')
      .send({ amountCents: 999999999, currencyCode: 'USD' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('fiat_compliance_amount_limit');
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('GET returns the top-up for its owner and 404s otherwise', async () => {
    const getSpy = jest.spyOn(topupService, 'getCustomerTopup')
      .mockResolvedValueOnce({ ...baseTopupRow, status: 'completed' })
      .mockResolvedValueOnce(null);
    const ok = await request(buildTopupApp()).get(`/topups/${TOPUP_ID}`);
    expect(ok.status).toBe(200);
    expect(ok.body.topup.status).toBe('completed');
    expect(getSpy).toHaveBeenNthCalledWith(1, { customerId: CUSTOMER_ID, topupId: TOPUP_ID });

    const missing = await request(buildTopupApp()).get('/topups/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('credit_topup_not_found');
  });
});

// ── Webhook branches ─────────────────────────────────────────────────────
describe('webhook branches', () => {
  test('replay of the same event id is a no-op', async () => {
    const applySpy = jest.spyOn(topupService, 'applyCreditTopupWebhookEvent').mockResolvedValue(true);
    const app = buildWebhookApp();
    const event = {
      id: 'evt_dup_1', type: 'payment_intent.succeeded', created: 1700000000,
      data: { object: { id: 'pi_dup', metadata: { oxsteed_credit_topup_id: TOPUP_ID } } },
    };
    stubQueries(receiptHandlers(88, 'evt_dup_1'));
    const first = await sendStripeEvent(app, event);
    expect(first.status).toBe(200);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith({
      type: 'payment_intent.succeeded',
      object: event.data.object,
    });

    stubQueries([{ match: 'INSERT INTO webhook_event_receipts', rows: [] }]);
    const second = await sendStripeEvent(app, event);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  test('a top-up payment_intent.succeeded does not fall through to other payment flows', async () => {
    jest.spyOn(topupService, 'applyCreditTopupWebhookEvent').mockResolvedValue(true);
    stubQueries(receiptHandlers(89, 'evt_topup_ok'));
    const res = await sendStripeEvent(buildWebhookApp(), {
      id: 'evt_topup_ok', type: 'payment_intent.succeeded', created: 1700000000,
      data: { object: { id: 'pi_topup_1', metadata: { oxsteed_credit_topup_id: TOPUP_ID } } },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mockQuery.mock.calls.some((c) => c[0].includes('UPDATE payments SET status'))).toBe(false);
  });

  test('a non-top-up payment_intent.succeeded still runs the existing flows', async () => {
    const applySpy = jest.spyOn(topupService, 'applyCreditTopupWebhookEvent').mockResolvedValue(false);
    stubQueries(receiptHandlers(90, 'evt_plain_pi'));
    const res = await sendStripeEvent(buildWebhookApp(), {
      id: 'evt_plain_pi', type: 'payment_intent.succeeded', created: 1700000000,
      data: { object: { id: 'pi_plain', status: 'succeeded', metadata: {} } },
    });
    expect(res.status).toBe(200);
    expect(applySpy).toHaveBeenCalledWith({
      type: 'payment_intent.succeeded',
      object: expect.objectContaining({ id: 'pi_plain' }),
    });
    expect(mockQuery.mock.calls.some((c) => c[0].includes('UPDATE restaurant_pos_payments'))).toBe(true);
  });

  test('transfer.created with settlement metadata confirms the payout via Builder B', async () => {
    stubQueries(receiptHandlers(91, 'evt_tr_created'));
    const res = await sendStripeEvent(buildWebhookApp(), {
      id: 'evt_tr_created', type: 'transfer.created', created: 1700000000,
      data: { object: { id: 'tr_123', metadata: { oxsteed_credit_settlement_id: 'sett-1' } } },
    });
    expect(res.status).toBe(200);
    expect(adminService.confirmSettlementPayoutFromTransfer).toHaveBeenCalledWith('tr_123');
    expect(adminService.failSettlementPayoutFromTransfer).not.toHaveBeenCalled();
  });

  test('transfer.reversed with settlement metadata fails the payout via Builder B', async () => {
    stubQueries(receiptHandlers(92, 'evt_tr_reversed'));
    const res = await sendStripeEvent(buildWebhookApp(), {
      id: 'evt_tr_reversed', type: 'transfer.reversed', created: 1700000000,
      data: { object: { id: 'tr_456', metadata: { oxsteed_credit_settlement_id: 'sett-2' } } },
    });
    expect(res.status).toBe(200);
    expect(adminService.failSettlementPayoutFromTransfer).toHaveBeenCalledWith('tr_456', 'transfer_reversed');
    expect(adminService.confirmSettlementPayoutFromTransfer).not.toHaveBeenCalled();
  });

  test('transfer events without settlement metadata are ignored', async () => {
    stubQueries(receiptHandlers(93, 'evt_tr_plain'));
    const res = await sendStripeEvent(buildWebhookApp(), {
      id: 'evt_tr_plain', type: 'transfer.created', created: 1700000000,
      data: { object: { id: 'tr_789', metadata: {} } },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(adminService.confirmSettlementPayoutFromTransfer).not.toHaveBeenCalled();
    expect(adminService.failSettlementPayoutFromTransfer).not.toHaveBeenCalled();
  });

  test('a Builder B failure marks the webhook failed so Stripe retries', async () => {
    adminService.confirmSettlementPayoutFromTransfer.mockRejectedValueOnce(new Error('settlement db locked'));
    stubQueries([
      ...receiptHandlers(94, 'evt_tr_retry'),
      { match: "SET status = 'failed'", rows: [] },
    ]);
    const res = await sendStripeEvent(buildWebhookApp(), {
      id: 'evt_tr_retry', type: 'transfer.updated', created: 1700000000,
      data: { object: { id: 'tr_999', metadata: { oxsteed_credit_settlement_id: 'sett-9' } } },
    });
    expect(res.status).toBe(500);
    expect(mockQuery.mock.calls.some((c) => c[0].includes("SET status = 'failed'"))).toBe(true);
  });
});
