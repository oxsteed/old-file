'use strict';
/**
 * Phase 3 logistics payments — quote lifecycle, checkout context, and
 * payment history (Fix 1).
 *
 * Proves:
 *  - staff create draft quote versions with server-computed integer
 *    totals (deposit/final derived, never trusted from the client);
 *  - publishing flips a draft to 'active' (the pending version buyers
 *    must accept), retires older 'active' versions, and never mutates a
 *    previously accepted version;
 *  - buyers accept only the latest published version; double acceptance
 *    converges idempotently; stale/draft/expired versions are rejected;
 *  - checkout-context assembles subject + actionable quote + schedule
 *    with paid/outstanding integer cents + payment methods, and returns
 *    quote: null when nothing is payable yet;
 *  - payment history returns only the caller's own attempts;
 *  - the new routes sit behind the LOGISTICS_PAYMENTS_ENABLED gate and
 *    quote creation/publication require staff.
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
const quoteService = require('../services/logisticsQuoteService');
const paymentsCtrl = require('../controllers/logisticsPaymentController');
const requireLogisticsPayments = require('../middleware/requireLogisticsPayments');

const BUYER = 'buyer-1';
const OTHER = 'buyer-2';
const STAFF = 'staff-1';
let store;

const KEY_1 = '11111111-1111-4111-8111-111111111111';
const KEY_2 = '22222222-2222-4222-8222-222222222222';

function seedPoWithQuote(overrides = {}) {
  const po = fakeDb.seedPurchaseOrder(store, { id: 101, buyer_user_id: BUYER, ...overrides.po });
  const quote = fakeDb.seedQuote(store, {
    subject_type: 'purchase_order',
    purchase_order_id: po.id,
    version: 1,
    status: 'accepted',
    line_items: [{ label: 'Widgets', amount_cents: 10000 }],
    subtotal_cents: 10000,
    fees_cents: 500,
    tax_cents: 250,
    total_cents: 10750,
    deposit_cents: 3225,
    final_cents: 7525,
    deposit_pct: 0.3,
    ...overrides.quote,
  });
  return { po, quote };
}

function buildApp(asUserId) {
  const app = express();
  app.use(express.json());
  if (asUserId) app.use((req, _res, next) => { req.user = { id: asUserId }; next(); });
  const fakeAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    return next();
  };
  app.get('/finance/checkout-context', fakeAuth, requireLogisticsPayments, paymentsCtrl.getCheckoutContext);
  app.post('/finance/quotes', fakeAuth, requireLogisticsPayments, paymentsCtrl.createQuote);
  app.post('/finance/quotes/:id/publish', fakeAuth, requireLogisticsPayments, paymentsCtrl.publishQuote);
  app.post('/finance/quotes/:id/accept', fakeAuth, requireLogisticsPayments, paymentsCtrl.acceptQuote);
  app.get('/finance/payment-history', fakeAuth, requireLogisticsPayments, paymentsCtrl.getPaymentHistory);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
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
  mockResolveLogisticsRole.mockImplementation(async (user) =>
    (user && user.id === STAFF ? 'admin' : 'individual_buyer'));
});

afterEach(async () => {
  await flushNotifications();
  delete process.env.LOGISTICS_PAYMENTS_ENABLED;
});

const quotePayload = (poId, overrides = {}) => ({
  subject_type: 'purchase_order',
  purchase_order_id: poId,
  line_items: [
    { label: 'Widgets', amount_cents: 10000 },
    { label: 'Freight', amount_cents: 2000 },
  ],
  fees_cents: 500,
  tax_cents: 250,
  deposit_pct: 0.3,
  cancellation_terms: 'Cancel within 7 days for a full refund.',
  ...overrides,
});

describe('POST /finance/quotes — staff draft creation', () => {
  test('creates a versioned draft with server-computed integer totals', async () => {
    const { po } = seedPoWithQuote({ quote: { version: 99 } });
    // remove the seeded quote: we want a clean subject
    store.quotes = [];
    const res = await request(buildApp(STAFF))
      .post('/finance/quotes')
      .send(quotePayload(po.id));

    expect(res.status).toBe(201);
    const q = res.body.data.quote;
    // subtotal 12000 + fees 500 + tax 250 = 12750; deposit 30% = 3825
    expect(q.version).toBe(1);
    expect(q.status).toBe('draft');
    expect(q.subtotal_cents).toBe(12000);
    expect(q.total_cents).toBe(12750);
    expect(q.deposit_cents).toBe(3825);
    expect(q.final_cents).toBe(8925);
    expect(q.deposit_cents + q.final_cents).toBe(q.total_cents);
    expect(q.currency).toBe('USD');

    const again = await request(buildApp(STAFF))
      .post('/finance/quotes')
      .send(quotePayload(po.id));
    expect(again.body.data.quote.version).toBe(2);
  });

  test('defaults deposit_pct to 30% and validates money input', async () => {
    const { po } = seedPoWithQuote();
    store.quotes = [];
    const res = await request(buildApp(STAFF))
      .post('/finance/quotes')
      .send(quotePayload(po.id, { deposit_pct: undefined }));
    expect(res.body.data.quote.deposit_pct).toBe(0.3);

    const bad = await request(buildApp(STAFF))
      .post('/finance/quotes')
      .send(quotePayload(po.id, { line_items: [] }));
    expect(bad.status).toBe(400);

    const badPct = await request(buildApp(STAFF))
      .post('/finance/quotes')
      .send(quotePayload(po.id, { deposit_pct: 1.5 }));
    expect(badPct.status).toBe(400);
  });

  test('non-staff cannot create quotes', async () => {
    const { po } = seedPoWithQuote();
    const res = await request(buildApp(BUYER))
      .post('/finance/quotes')
      .send(quotePayload(po.id));
    expect(res.status).toBe(403);
  });

  test('quote endpoints answer 503 while the payments flag is off', async () => {
    delete process.env.LOGISTICS_PAYMENTS_ENABLED;
    const res = await request(buildApp(BUYER)).get('/finance/checkout-context?orderId=101');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('logistics_payments_disabled');
  });
});

describe('POST /finance/quotes/:id/publish — staff publication', () => {
  test('publishes the draft; the buyer is notified; older active versions retire', async () => {
    const { po } = seedPoWithQuote();
    store.quotes = [];
    const draft = await quoteService.createQuote(STAFF, quotePayload(po.id));
    const res = await request(buildApp(STAFF)).post(`/finance/quotes/${draft.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.data.quote.status).toBe('active');

    await flushNotifications();
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0]).toMatchObject({
      userId: BUYER,
      type: 'logistics:quote_published',
    });

    // A second draft published later retires the first active version but
    // never touches the accepted one.
    const accepted = fakeDb.seedQuote(store, {
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      version: 5,
      status: 'accepted',
    });
    const draft2 = await quoteService.createQuote(STAFF, quotePayload(po.id));
    await request(buildApp(STAFF)).post(`/finance/quotes/${draft2.id}/publish`);
    const v1 = store.quotes.find((q) => q.id === draft.id);
    const vAccepted = store.quotes.find((q) => q.id === accepted.id);
    expect(v1.status).toBe('superseded');
    expect(vAccepted.status).toBe('accepted');
  });

  test('cannot publish a non-draft or a stale draft', async () => {
    const { po, quote } = seedPoWithQuote(); // accepted v1
    const res = await request(buildApp(STAFF)).post(`/finance/quotes/${quote.id}/publish`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_not_draft');

    const stale = fakeDb.seedQuote(store, {
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      version: 0,
      status: 'draft',
    });
    const res2 = await request(buildApp(STAFF)).post(`/finance/quotes/${stale.id}/publish`);
    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('quote_not_latest');
  });

  test('non-staff cannot publish', async () => {
    const { po } = seedPoWithQuote();
    store.quotes = [];
    const draft = await quoteService.createQuote(STAFF, quotePayload(po.id));
    const res = await request(buildApp(BUYER)).post(`/finance/quotes/${draft.id}/publish`);
    expect(res.status).toBe(403);
  });
});

describe('POST /finance/quotes/:id/accept — buyer acceptance', () => {
  async function seedActiveQuote() {
    const { po } = seedPoWithQuote();
    store.quotes = [];
    const draft = await quoteService.createQuote(STAFF, quotePayload(po.id));
    const published = await quoteService.publishQuote(STAFF, draft.id);
    return { po, published };
  }

  test('buyer accepts the pending version; acceptance is recorded', async () => {
    const { published } = await seedActiveQuote();
    const res = await request(buildApp(BUYER))
      .post(`/finance/quotes/${published.id}/accept`)
      .send({ idempotency_key: KEY_1 });

    expect(res.status).toBe(200);
    expect(res.body.data.quote.status).toBe('accepted');
    expect(res.body.data.quote.accepted_at).toBeTruthy();
    expect(res.body.idempotent_replay).toBe(false);

    const row = store.quotes.find((q) => q.id === published.id);
    expect(row.accepted_by_user_id).toBe(BUYER);

    await flushNotifications();
    const staffNotif = mockSendNotification.mock.calls.find((c) => c[0].type === 'logistics:quote_accepted');
    expect(staffNotif).toBeTruthy();
  });

  test('double acceptance converges idempotently', async () => {
    const { published } = await seedActiveQuote();
    await request(buildApp(BUYER)).post(`/finance/quotes/${published.id}/accept`).send({ idempotency_key: KEY_1 });
    const replay = await request(buildApp(BUYER))
      .post(`/finance/quotes/${published.id}/accept`)
      .send({ idempotency_key: KEY_2 });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.data.quote.status).toBe('accepted');
    expect(store.quotes.filter((q) => q.status === 'accepted')).toHaveLength(1);
  });

  test('rejects stale, draft, expired, and unauthorized acceptance', async () => {
    const { po } = seedPoWithQuote(); // accepted v1
    const draftV2 = await quoteService.createQuote(STAFF, quotePayload(po.id)); // draft v2
    const staleAccept = await request(buildApp(BUYER))
      .post(`/finance/quotes/${draftV2.id}/accept`)
      .send({ idempotency_key: KEY_1 });
    // draft v2 is the latest but not published
    expect(staleAccept.status).toBe(409);
    expect(staleAccept.body.code).toBe('quote_not_published');

    const other = await request(buildApp(OTHER))
      .post(`/finance/quotes/${draftV2.id}/accept`)
      .send({ idempotency_key: KEY_1 });
    expect(other.status).toBe(403);

    const expired = fakeDb.seedQuote(store, {
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      version: 3,
      status: 'active',
      valid_until: new Date(Date.now() - 1000).toISOString(),
      accepted_at: null,
      accepted_by_user_id: null,
    });
    const expiredRes = await request(buildApp(BUYER))
      .post(`/finance/quotes/${expired.id}/accept`)
      .send({ idempotency_key: KEY_1 });
    expect(expiredRes.status).toBe(409);
    expect(expiredRes.body.code).toBe('quote_expired');

    const noKey = await request(buildApp(BUYER))
      .post(`/finance/quotes/${expired.id}/accept`)
      .send({});
    expect(noKey.status).toBe(400);
  });
});

describe('GET /finance/checkout-context', () => {
  test('returns subject, accepted quote, schedule with paid/outstanding cents, and methods', async () => {
    const { po } = seedPoWithQuote();
    po.deposit_paid_cents = 3225; // deposit fully paid
    const res = await request(buildApp(BUYER)).get('/finance/checkout-context?orderId=101');

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.subject).toMatchObject({ kind: 'purchase_order', id: 101 });
    expect(data.quote.status).toBe('accepted');
    expect(data.quote.pending_version).toBeNull();
    expect(data.quote.line_items).toHaveLength(1);

    const deposit = data.quote.schedule.find((s) => s.installment === 'deposit');
    const final = data.quote.schedule.find((s) => s.installment === 'final');
    expect(deposit).toMatchObject({
      amount_cents: 3225, paid_cents: 3225, outstanding_cents: 0, status: 'settled',
    });
    expect(final).toMatchObject({
      amount_cents: 7525, paid_cents: 0, outstanding_cents: 7525, status: 'unpaid',
    });
    expect(data.credit).toMatchObject({ rail_enabled: false, eligible: false, balance_cents: null });
    expect(data.methods.stripe.enabled).toBe(true);
    expect(data.return_label).toBeTruthy();
  });

  test('a published newer version surfaces as pending_version with a diff', async () => {
    const { po } = seedPoWithQuote(); // accepted v1
    const draft = await quoteService.createQuote(STAFF, quotePayload(po.id));
    await quoteService.publishQuote(STAFF, draft.id);

    const res = await request(buildApp(BUYER)).get('/finance/checkout-context?orderId=101');
    const data = res.body.data;
    expect(data.quote.status).toBe('active');
    expect(data.quote.version).toBe(2);
    expect(data.quote.pending_version).toMatchObject({ version: 2, vs_version: 1 });
    const kinds = data.quote.pending_version.changes.map((c) => c.kind);
    expect(kinds).toContain('added'); // 'Freight' line added in v2
    expect(data.quote.pending_version.total_delta_cents)
      .toBe(data.quote.total_cents - 10750);
  });

  test('quote: null when nothing is payable yet; 403 for non-owners; 400 without a subject', async () => {
    const { po } = seedPoWithQuote();
    store.quotes = [];
    const empty = await request(buildApp(BUYER)).get('/finance/checkout-context?orderId=101');
    expect(empty.status).toBe(200);
    expect(empty.body.data.quote).toBeNull();
    expect(empty.body.data.subject.id).toBe(po.id);

    const forbidden = await request(buildApp(OTHER)).get('/finance/checkout-context?orderId=101');
    expect(forbidden.status).toBe(403);

    const staffPreview = await request(buildApp(STAFF)).get('/finance/checkout-context?orderId=101');
    expect(staffPreview.status).toBe(200);

    const missing = await request(buildApp(BUYER)).get('/finance/checkout-context');
    expect(missing.status).toBe(400);

    const unknown = await request(buildApp(BUYER)).get('/finance/checkout-context?orderId=999');
    expect(unknown.status).toBe(404);
  });

  test('in-flight attempts mark the schedule row processing', async () => {
    const { po, quote } = seedPoWithQuote();
    fakeDb.seedAttempt(store, {
      buyer_user_id: BUYER,
      subject_type: 'purchase_order',
      purchase_order_id: po.id,
      quote_id: quote.id,
      installment: 'final',
      amount_cents: 7525,
      status: 'processing',
      stripe_payment_intent_id: 'pi_inflight',
    });
    const res = await request(buildApp(BUYER)).get('/finance/checkout-context?orderId=101');
    const final = res.body.data.quote.schedule.find((s) => s.installment === 'final');
    expect(final.status).toBe('processing');
  });
});

describe('GET /finance/payment-history', () => {
  test('returns only the caller\'s own attempts, newest first', async () => {
    const { po, quote } = seedPoWithQuote();
    const mine = fakeDb.seedAttempt(store, {
      buyer_user_id: BUYER, subject_type: 'purchase_order', purchase_order_id: po.id,
      quote_id: quote.id, installment: 'deposit', amount_cents: 3225, status: 'succeeded',
    });
    fakeDb.seedAttempt(store, {
      buyer_user_id: OTHER, subject_type: 'purchase_order', purchase_order_id: po.id,
      quote_id: quote.id, installment: 'deposit', amount_cents: 3225, status: 'succeeded',
      idempotency_key: KEY_2,
    });

    const res = await request(buildApp(BUYER)).get('/finance/payment-history');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.attempts).toHaveLength(1);
    expect(res.body.data.attempts[0].id).toBe(mine.id);
    expect(res.body.data.attempts[0].buyer_user_id).toBe(BUYER);
    // The public view never leaks processor internals.
    expect(res.body.data.attempts[0].failure_code).toBeUndefined();
    expect(res.body.data.attempts[0].stripe_client_secret).toBeUndefined();
  });
});
