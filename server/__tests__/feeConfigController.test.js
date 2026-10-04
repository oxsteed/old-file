'use strict';

/**
 * feeConfigController.test.js — FC1: fee config atomicity + surfaced sync failures.
 *
 * 1. The fee_change_log INSERT and fee_config UPDATE run as one transaction:
 *    they are issued in order through the transaction client, and a failure
 *    in the UPDATE propagates to `next` instead of returning success
 *    (production withTransaction rolls the log INSERT back with it).
 * 2. A Stripe provider sync failure is surfaced as 202 with an explicit
 *    pending-sync state, never a silent success.
 * 3. previewFees honors explicit zero rates instead of replacing them with
 *    defaults.
 */

const { mockQuery, resetMocks } = require('./setup');
const stripe = require('stripe');
const controller = require('../controllers/feeConfigController');

const stripeMock = stripe.__mockInstance;

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function requestDouble(body) {
  return { body, user: { id: 'admin-1' }, ip: '127.0.0.1' };
}

const configRow = {
  key: 'tier2_subscription_cents',
  value: '2500',
  min_value: null,
  max_value: null,
};

const planRow = {
  slug: 'pro',
  stripe_product_id: 'prod_test',
  stripe_price_id: null,
  amount_cents: 2500,
};

// Route mockQuery by statement. `failOn` forces one statement to throw.
function routeQueries({ failOn = null } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
    if (text.includes('FROM fee_config WHERE key')) return { rows: [configRow] };
    if (text.includes('INSERT INTO fee_change_log')) return { rows: [], rowCount: 1 };
    if (text.includes('UPDATE fee_config')) return { rows: [], rowCount: 1 };
    if (text.includes('FROM plans WHERE slug')) return { rows: [planRow] };
    if (text.includes('UPDATE plans')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
  stripeMock.prices.create.mockReset();
  stripeMock.prices.update.mockReset();
  stripeMock.prices.create.mockResolvedValue({ id: 'price_new' });
  stripeMock.prices.update.mockResolvedValue({ id: 'price_old', active: false });
});

describe('updateFeeConfig atomicity (FC1)', () => {
  test('log INSERT and config UPDATE are issued in order inside one transaction', async () => {
    routeQueries();
    const res = responseDouble();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 3000, reason: 'test' }),
      res,
      jest.fn()
    );

    const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
    const insertIdx = statements.findIndex((s) => s.includes('INSERT INTO fee_change_log'));
    const updateIdx = statements.findIndex((s) => s.includes('UPDATE fee_config'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(insertIdx);
    expect(res.json).toHaveBeenCalledWith({ success: true, key: 'tier2_subscription_cents', newValue: 3000 });
  });

  test('a failing config UPDATE propagates to next() instead of returning success', async () => {
    routeQueries({ failOn: 'UPDATE fee_config' });
    const res = responseDouble();
    const next = jest.fn();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 3000 }),
      res,
      next
    );

    // The log INSERT ran, then the UPDATE threw: the whole unit fails and
    // the caller is told, so no silent partial write is reported as success.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('UPDATE fee_config') }));
    expect(res.json).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('updateFeeConfig Stripe sync failures (FC1)', () => {
  test('provider failure returns 202 with explicit pending-sync state, never success', async () => {
    routeQueries();
    stripeMock.prices.create.mockRejectedValue(new Error('stripe exploded'));
    const res = responseDouble();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 3000 }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(202);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      success: false,
      key: 'tier2_subscription_cents',
      newValue: 3000,
      stripe_sync: 'failed',
    }));
    expect(payload.message).toMatch(/Stripe/i);
    // Never a silent success.
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('successful sync still returns success', async () => {
    routeQueries();
    const res = responseDouble();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 3000 }),
      res,
      jest.fn()
    );

    expect(res.status).not.toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ success: true, key: 'tier2_subscription_cents', newValue: 3000 });
    expect(stripeMock.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 3000, currency: 'usd' })
    );
  });
});

describe('previewFees zero rates (FC1)', () => {
  test('explicit zero rates are honored, not replaced by defaults', async () => {
    const res = responseDouble();

    await controller.previewFees(
      requestDouble({
        jobValueDollars: 100,
        platformFeePct: 0,
        protectionFeePct: 0,
        brokerCutPct: 0,
        platformFeeMinCents: 0,
      }),
      res,
      jest.fn()
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      platformFeeDollars: '0.00',
      protectionFeeDollars: '0.00',
      brokerCutDollars: '0.00',
      totalFeeDollars: '0.00',
      helperPayoutDollars: '100.00',
    }));
  });

  test('omitted rates still fall back to defaults', async () => {
    const res = responseDouble();

    await controller.previewFees(requestDouble({ jobValueDollars: 100 }), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.platformFeeDollars).toBe('10.00');
    expect(payload.protectionFeeDollars).toBe('2.00');
    expect(payload.brokerCutDollars).toBe('5.00');
  });
});
