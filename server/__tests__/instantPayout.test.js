'use strict';

process.env.DIDIT_API_KEY = 'synthetic-didit-provider';

// Review P3-1-F16: instant payouts must create a local payout row BEFORE the
// Stripe call (failures are tracked), and payout.* webhook events must
// reconcile that row as Stripe settles.
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/localDeliveryPaymentService', () => ({
  handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const paymentRoutes = require('../routes/payments');
const webhookRoutes = require('../routes/webhook');
const paymentController = require('../controllers/paymentController');
const stripe = require('stripe')();

const HELPER = {
  id: 7, first_name: 'Rex', last_name: 'Helper', email: 'h@test.com',
  phone: null, role: 'helper', email_verified: true, is_verified: true, is_active: true,
  didit_status: 'verified', didit_verified_at: new Date(), didit_enforcement_required: false,
  onboarding_completed: true, w9_completed: true,
};
const TOKEN = jwt.sign({ id: 7, email: 'h@test.com', role: 'helper' }, process.env.JWT_SECRET);
const auth = r => r.set('Authorization', `Bearer ${TOKEN}`);

const CONNECT_ROW = {
  user_id: 7, stripe_account_id: 'acct_x', charges_enabled: true,
  payouts_enabled: true, onboarding_complete: true,
};

function buildPaymentsApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentRoutes);
  return app;
}

function buildWebhookApp() {
  const app = express();
  app.use('/api/webhooks', webhookRoutes);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  paymentController._clearConnectAccountStatusCache();
  stripe.accounts.retrieve.mockResolvedValue({
    id: 'acct_x', charges_enabled: true, payouts_enabled: true, details_submitted: true,
  });
  stripe.balance.retrieve.mockResolvedValue({ instant_available: [{ currency: 'usd', amount: 4200 }] });
});

// Route pool queries to canned results; records statement order for assertions.
function routeInstantPayoutQueries({ onInsert, onUpdate, existingRow = null, insertConflict = false, user = HELPER } = {}) {
  const calls = [];
  mockQuery.mockImplementation(async (sql, params) => {
    calls.push(sql);
    if (/FROM users/.test(sql)) return { rows: [user] };
    if (/SELECT \* FROM connect_accounts/.test(sql)) return { rows: [CONNECT_ROW] };
    if (/FROM instant_payouts WHERE idempotency_key/.test(sql)) return { rows: existingRow ? [existingRow] : [] };
    if (/INSERT INTO instant_payouts/.test(sql)) {
      if (insertConflict) return { rows: [] };
      const row = { id: 'rec-1', user_id: 7, stripe_account_id: 'acct_x', stripe_payout_id: null,
        amount_cents: 4200, currency: 'usd', status: 'requested', idempotency_key: params[3] };
      if (onInsert) onInsert(calls.length);
      return { rows: [row] };
    }
    if (/UPDATE instant_payouts/.test(sql)) {
      if (onUpdate) onUpdate(params);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return calls;
}

describe('POST /api/payments/payout/instant', () => {
  test.each([
    [{ onboarding_completed: false }, 'Onboarding incomplete'],
    [{ w9_completed: false }, 'tax_identity_required'],
    [{ didit_verified_at: '2020-01-01T00:00:00Z' }, 'DIDIT_REQUIRED'],
  ])('keeps incomplete onboarding and tax identity fail-closed (%s)', async (changes, error) => {
    routeInstantPayoutQueries({ user: { ...HELPER, ...changes } });
    const res = await auth(request(buildPaymentsApp()).post('/api/payments/payout/instant'));
    expect(res.status).toBe(403);
    expect(res.body.code || res.body.error).toBe(error);
    expect(stripe.payouts.create).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO instant_payouts/.test(sql))).toBe(false);
  });
  test('creates the local payout row before the Stripe call and updates it on success', async () => {
    const sequence = [];
    let updateParams = null;
    stripe.payouts.create.mockImplementation(async () => {
      sequence.push('stripe.payouts.create');
      return { id: 'po_123', status: 'paid' };
    });
    routeInstantPayoutQueries({
      onInsert: () => sequence.push('insert instant_payouts'),
      onUpdate: (params) => { updateParams = params; },
    });

    const res = await auth(request(buildPaymentsApp()).post('/api/payments/payout/instant'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ payout_id: 'po_123', amount_cents: 4200 });
    expect(stripe.payouts.create).toHaveBeenCalledTimes(1);
    expect(sequence.indexOf('insert instant_payouts')).toBeGreaterThanOrEqual(0);
    expect(sequence.indexOf('insert instant_payouts')).toBeLessThan(sequence.indexOf('stripe.payouts.create'));
    // Success update: stripe payout id + paid status on the local row.
    expect(updateParams).toEqual(['rec-1', 'po_123', 'paid']);
  });

  test('a Stripe-side failure marks the local row failed and returns 502', async () => {
    let updateSql = null;
    let updateParams = null;
    stripe.payouts.create.mockRejectedValueOnce(new Error('insufficient_funds'));
    const calls = routeInstantPayoutQueries({ onUpdate: (params) => { updateParams = params; } });
    const origImpl = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql, params) => {
      if (/UPDATE instant_payouts/.test(sql)) updateSql = sql;
      return origImpl(sql, params);
    });

    const res = await auth(request(buildPaymentsApp()).post('/api/payments/payout/instant'));
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('instant_payout_failed');
    expect(updateSql).toMatch(/status = 'failed'/);
    expect(updateParams[0]).toBe('rec-1');
    expect(String(updateParams[1])).toMatch(/insufficient_funds/);
  });

  test('a same-day retry returns the existing record instead of paying twice', async () => {
    routeInstantPayoutQueries({
      insertConflict: true,
      existingRow: { id: 'rec-1', status: 'paid', stripe_payout_id: 'po_123', amount_cents: 4200 },
    });
    const res = await auth(request(buildPaymentsApp()).post('/api/payments/payout/instant'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', payout_id: 'po_123' });
    expect(stripe.payouts.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/payments/payout/balance', () => {
  test('reports the tax-identity gate state for the proactive W-9 unlock path', async () => {
    routeInstantPayoutQueries();
    const res = await auth(request(buildPaymentsApp()).get('/api/payments/payout/balance'));
    expect(res.status).toBe(200);
    expect(res.body.tax_identity).toEqual({ w9_completed: true, ready: true });
  });

  test('reports tax_identity.ready false when the W-9 is missing', async () => {
    routeInstantPayoutQueries({ user: { ...HELPER, w9_completed: false } });
    const res = await auth(request(buildPaymentsApp()).get('/api/payments/payout/balance'));
    expect(res.status).toBe(200);
    expect(res.body.tax_identity).toEqual({ w9_completed: false, ready: false });
  });
});

describe('payout.* webhook events', () => {
  test('payout.paid on the connect destination reconciles the local row', async () => {
    const previous = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test_connect';
    try {
      stripe.webhooks.constructEvent.mockReturnValueOnce({
        id: 'evt_po_paid', account: 'acct_x', type: 'payout.paid',
        data: { object: { id: 'po_123', status: 'paid' } },
      });
      let updateParams = null;
      mockQuery.mockImplementation(async (sql, params) => {
        if (/INSERT INTO webhook_event_receipts/.test(sql)) return { rows: [{ id: 55 }] };
        if (/INSERT INTO webhook_event_watermarks/.test(sql)) return { rows: [{ event_id: 'evt_po_paid' }] };
        if (/UPDATE instant_payouts/.test(sql)) { updateParams = params; return { rows: [{ id: 'rec-1' }], rowCount: 1 }; }
        return { rows: [], rowCount: 0 };
      });
      const res = await request(buildWebhookApp()).post('/api/webhooks/stripe/connect')
        .set('stripe-signature', 'test-sig').set('Content-Type', 'application/json').send('{}');
      expect(res.status).toBe(200);
      expect(updateParams[0]).toBe('po_123');
      expect(updateParams[1]).toBe('paid');
    } finally {
      if (previous === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
      else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous;
    }
  });

  test('the connect webhook contract lists payout lifecycle events', () => {
    const contract = require('../config/stripeWebhookContract');
    for (const event of ['payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled']) {
      expect(contract.connect.events).toContain(event);
    }
  });
});
