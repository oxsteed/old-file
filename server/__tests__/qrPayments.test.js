'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'owner-1', role: 'helper' };
    next();
  },
}));

const stripeFactory = require('stripe');
const mockStripe = stripeFactory.__mockInstance;

const qrPaymentsRoutes = require('../routes/qrPayments');
const webhookController = require('../controllers/webhookController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/qr-payments', qrPaymentsRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const CONNECT_ROW = {
  user_id: 'owner-1',
  stripe_account_id: 'acct_123',
  charges_enabled: true,
};

const CODE_ROW = {
  id: 'qr-code-1',
  owner_user_id: 'owner-1',
  code: 'AbCdEfGhIjKl',
  label: 'Lawn mowing',
  amount_cents: 2500,
  currency: 'usd',
  first_name: 'Emile',
  last_name: 'Laurent',
};

beforeEach(() => {
  resetMocks();
  mockStripe.checkout.sessions.create.mockReset();
  mockStripe.checkout.sessions.create.mockResolvedValue({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/pay/cs_test_1',
  });
});

describe('POST /api/qr-payments/codes', () => {
  test('rejects missing label without touching the database', async () => {
    const res = await request(buildApp()).post('/api/qr-payments/codes').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('label_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects labels longer than 80 characters', async () => {
    const res = await request(buildApp())
      .post('/api/qr-payments/codes')
      .send({ label: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('label_too_long');
  });

  test('rejects fixed amounts below $1.00', async () => {
    const res = await request(buildApp())
      .post('/api/qr-payments/codes')
      .send({ label: 'Mowing', amount_cents: 50 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_amount');
  });

  test('returns 409 connect_required when the owner has no Connect account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // connect lookup
    const res = await request(buildApp())
      .post('/api/qr-payments/codes')
      .send({ label: 'Mowing' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('connect_required');
  });

  test('returns 409 connect_required when charges are not enabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...CONNECT_ROW, charges_enabled: false }],
      rowCount: 1,
    });
    const res = await request(buildApp())
      .post('/api/qr-payments/codes')
      .send({ label: 'Mowing' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('connect_required');
  });

  test('creates an open-amount code and returns the pay URL', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CONNECT_ROW], rowCount: 1 }) // connect lookup
      .mockResolvedValueOnce({
        rows: [{
          id: 'qr-1', code: 'AbCdEfGhIjKl', label: 'Lawn mowing',
          amount_cents: null, currency: 'usd', is_active: true,
          created_at: '2026-09-29T10:00:00.000Z',
        }],
        rowCount: 1,
      }); // insert
    const res = await request(buildApp())
      .post('/api/qr-payments/codes')
      .send({ label: 'Lawn mowing' });
    expect(res.status).toBe(201);
    // The setup page reads `data.code` as the created code object.
    expect(res.body.code.id).toBe('qr-1');
    expect(res.body.code.code).toHaveLength(12);
    expect(res.body.code.label).toBe('Lawn mowing');
    expect(res.body.code.is_active).toBe(true);
    expect(res.body.code.total_received_cents).toBe(0);
    expect(res.body.code.pay_url).toMatch(/\/pay\/AbCdEfGhIjKl$/);
    const insertCall = mockQuery.mock.calls[1][0];
    expect(insertCall).toMatch(/INSERT INTO qr_payment_codes/);
    expect(mockQuery.mock.calls[1][1][3]).toBeNull(); // open amount
  });
});

describe('GET /api/qr-payments/pay/:code', () => {
  test('unknown code returns the generic 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(buildApp()).get('/api/qr-payments/pay/nope12345678');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('inactive code returns the same generic 404', async () => {
    // getActiveCode filters is_active in SQL, so an inactive code looks unknown.
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(buildApp()).get('/api/qr-payments/pay/AbCdEfGhIjKl');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('active code exposes label, amount, and first name plus last initial only', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [CODE_ROW], rowCount: 1 });
    const res = await request(buildApp()).get('/api/qr-payments/pay/AbCdEfGhIjKl');
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Lawn mowing');
    expect(res.body.amount_cents).toBe(2500);
    expect(res.body.currency).toBe('usd');
    expect(res.body.recipient_name).toBe('Emile L.');
    expect(res.body.ready).toBe(true);
    expect(res.body.user_id).toBeUndefined();
    expect(res.body.email).toBeUndefined();
    expect(res.body.stripe_account_id).toBeUndefined();
  });
});

describe('POST /api/qr-payments/pay/:code/checkout', () => {
  test('requires an idempotency key before creating a checkout session', async () => {
    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .send({ payer_email: 'payer@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('idempotency_key_required');
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('open-amount code requires an amount in the body', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...CODE_ROW, amount_cents: null }],
      rowCount: 1,
    });
    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-invalid-amount-1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_amount');
  });

  test('rejects amounts below the minimum and above the maximum', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...CODE_ROW, amount_cents: null }], rowCount: 1 });
    const low = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-invalid-amount-2')
      .send({ amount_cents: 50 });
    expect(low.status).toBe(400);
    expect(low.body.code).toBe('invalid_amount');

    mockQuery.mockResolvedValueOnce({ rows: [{ ...CODE_ROW, amount_cents: null }], rowCount: 1 });
    const high = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-invalid-amount-3')
      .send({ amount_cents: 10_000_001 });
    expect(high.status).toBe(400);
    expect(high.body.code).toBe('invalid_amount');
  });

  test('rejects an invalid payer email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [CODE_ROW], rowCount: 1 });
    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-invalid-email-1')
      .send({ payer_email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_email');
  });

  test('creates a Checkout Session on the connected account and records a pending payment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CODE_ROW], rowCount: 1 }) // code lookup
      .mockResolvedValueOnce({ rows: [CONNECT_ROW], rowCount: 1 }) // connect lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // prior request lookup
      .mockResolvedValueOnce({ rows: [{ stripe_checkout_session_id: 'cs_test_1', checkout_url: 'https://checkout.stripe.com/pay/cs_test_1', status: 'pending' }], rowCount: 1 }); // qr_payments insert
    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-test-request-1')
      .send({ payer_email: 'payer@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/pay/cs_test_1');

    const [params, opts] = mockStripe.checkout.sessions.create.mock.calls[0];
    expect(opts.stripeAccount).toBe('acct_123');
    expect(params.mode).toBe('payment');
    expect(params.line_items[0].price_data.unit_amount).toBe(2500);
    expect(params.payment_intent_data.metadata.qr_payment).toBe('true');
    expect(params.payment_intent_data.metadata.qr_code_id).toBe('qr-code-1');
    expect(params.payment_intent_data.application_fee_amount).toBeGreaterThan(0);
    expect(params.success_url).toContain('/pay/AbCdEfGhIjKl/success');

    const insertCall = mockQuery.mock.calls[3][0];
    expect(insertCall).toMatch(/INSERT INTO qr_payments/);
    expect(mockQuery.mock.calls[3][1]).toEqual(
      expect.arrayContaining(['qr-code-1', 'cs_test_1', 2500, 500, 'payer@example.com'])
    );
  });

  test('replays a previously recorded checkout without calling Stripe again', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CODE_ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [CONNECT_ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        stripe_checkout_session_id: 'cs_existing',
        checkout_url: 'https://checkout.stripe.com/pay/cs_existing',
        status: 'pending',
      }], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-replay-request-1')
      .send({ payer_email: 'payer@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      url: 'https://checkout.stripe.com/pay/cs_existing',
      session_id: 'cs_existing',
      idempotent: true,
    }));
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('rejects reuse of a request key for different payment details', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CODE_ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [CONNECT_ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        stripe_checkout_session_id: 'cs_existing',
        checkout_url: 'https://checkout.stripe.com/pay/cs_existing',
        status: 'pending',
        request_fingerprint: 'different-request-details',
      }], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-conflict-request-1')
      .send({ payer_email: 'different@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('idempotency_key_conflict');
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('409 when the payee disconnected Stripe after code creation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [CODE_ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(buildApp())
      .post('/api/qr-payments/pay/AbCdEfGhIjKl/checkout')
      .set('Idempotency-Key', 'qr-connect-required-1')
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('connect_required');
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/qr-payments/pay/:code/receipt', () => {
  test('requires a session id', async () => {
    const res = await request(buildApp()).get('/api/qr-payments/pay/AbCdEfGhIjKl/receipt');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('session_required');
  });

  test('404 when the session does not belong to the code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(buildApp()).get(
      '/api/qr-payments/pay/AbCdEfGhIjKl/receipt?session_id=cs_other'
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('returns status, amount, currency, and label for a matching session', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: 'succeeded', amount_cents: 2500, currency: 'usd', label: 'Lawn mowing' }],
      rowCount: 1,
    });
    const res = await request(buildApp()).get(
      '/api/qr-payments/pay/AbCdEfGhIjKl/receipt?session_id=cs_test_1'
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'succeeded', amount_cents: 2500, currency: 'usd', label: 'Lawn mowing' });
  });

  test('defaults receipt currency to USD when the code has none', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ status: 'succeeded', amount_cents: 2500, currency: null, label: 'Lawn mowing' }],
      rowCount: 1,
    });
    const res = await request(buildApp()).get(
      '/api/qr-payments/pay/AbCdEfGhIjKl/receipt?session_id=cs_test_1'
    );
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
  });
});

describe('PATCH and DELETE /api/qr-payments/codes/:id', () => {
  test('PATCH rejects codes owned by someone else', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ownership check
    const res = await request(buildApp())
      .patch('/api/qr-payments/codes/qr-other')
      .send({ label: 'New label' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('PATCH toggle returns the code object so the UI updates without a refetch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'qr-1' }], rowCount: 1 }) // ownership check
      .mockResolvedValueOnce({
        rows: [{
          id: 'qr-1', code: 'AbCdEfGhIjKl', label: 'Lawn mowing',
          amount_cents: null, currency: 'usd', is_active: false,
          updated_at: '2026-09-29T10:00:00.000Z',
        }],
        rowCount: 1,
      }); // update
    const res = await request(buildApp())
      .patch('/api/qr-payments/codes/qr-1')
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.code.is_active).toBe(false);
    expect(res.body.code.pay_url).toMatch(/\/pay\/AbCdEfGhIjKl$/);
  });

  test('DELETE soft-deactivates an owned code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'qr-1' }], rowCount: 1 });
    const res = await request(buildApp()).delete('/api/qr-payments/codes/qr-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'qr-1', is_active: false });
    expect(mockQuery.mock.calls[0][0]).toMatch(/SET is_active = FALSE, deactivated_at = NOW\(\)/);
  });
});

describe('QR payment webhook completion', () => {
  const session = {
    id: 'cs_test_1',
    payment_intent: 'pi_test_1',
    metadata: { qr_payment: 'true', qr_code_id: 'qr-code-1' },
  };

  test('first delivery flips the payment to succeeded', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const updated = await webhookController.applyQrPaymentSucceeded(session);
    expect(updated).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE qr_payments/);
    expect(sql).toMatch(/status <> 'succeeded'/);
    expect(params).toEqual(['cs_test_1', 'pi_test_1']);
  });

  test('duplicate delivery is a no-op (idempotent)', async () => {
    // Row already succeeded: the guarded UPDATE touches nothing.
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const updated = await webhookController.applyQrPaymentSucceeded(session);
    expect(updated).toBe(0);
  });
});
