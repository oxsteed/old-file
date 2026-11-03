'use strict';

/**
 * feeConfigController.test.js — FC1 + Nov 2 admin-ops audit item 12.
 *
 * Item 12 changed the write path: proposing a fee change (update or reset)
 * now only QUEUES a fee_config_change approval in money_movement_approvals;
 * nothing is applied until a different admin approves, and the checker
 * applies it through executeFeeConfigChange inside the decide transaction.
 * So these tests lock:
 * 1. updateFeeConfig queues (approval INSERT, no fee_change_log/fee_config
 *    write) and returns 202 queued; an identical pending proposal replays
 *    instead of queueing a duplicate; invalid values never queue.
 * 2. The executor applies atomically: the fee_change_log INSERT and the
 *    fee_config UPDATE run in order through the transaction client, and a
 *    failure in the UPDATE propagates instead of returning success.
 * 3. Stripe provider sync runs in the executor's afterCommit (outside the
 *    transaction): a failure is recorded as stripeSync 'failed' on the
 *    result, never as a silent success.
 * 4. previewFees honors explicit zero rates instead of replacing them with
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

const approvalRow = {
  id: 'appr-1',
  movement_type: 'fee_config_change',
  reference_key: 'fee_config:tier2_subscription_cents',
  status: 'pending',
  requested_by: 'admin-1',
};

// Route mockQuery by statement. `failOn` forces one statement to throw.
function routeQueries({ failOn = null } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
    if (text.includes('FROM fee_config WHERE key')) return { rows: [configRow] };
    if (text.includes('FROM money_movement_approvals')) return { rows: [] };
    if (text.includes('INSERT INTO money_movement_approvals')) return { rows: [approvalRow] };
    if (text.includes('INSERT INTO fee_change_log')) return { rows: [], rowCount: 1 };
    if (text.includes('UPDATE fee_config')) return { rows: [], rowCount: 1 };
    if (text.includes('FROM plans WHERE slug')) return { rows: [planRow] };
    if (text.includes('UPDATE plans')) return { rows: [], rowCount: 1 };
    if (text.includes('UPDATE money_movement_approvals SET result')) return { rows: [], rowCount: 1 };
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

describe('updateFeeConfig queues for dual approval (item 12)', () => {
  test('proposing queues an approval and applies nothing', async () => {
    routeQueries();
    const res = responseDouble();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 3000, reason: 'test' }),
      res,
      jest.fn()
    );

    const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes('INSERT INTO money_movement_approvals'))).toBe(true);
    expect(statements.some((s) => s.includes('INSERT INTO fee_change_log'))).toBe(false);
    expect(statements.some((s) => s.includes('UPDATE fee_config'))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      queued: true,
      key: 'tier2_subscription_cents',
      newValue: 3000,
      approvalId: 'appr-1',
    }));
  });

  test('an identical pending proposal replays instead of queueing a duplicate', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM fee_config WHERE key')) return { rows: [configRow] };
      if (text.includes('FROM money_movement_approvals')) {
        return {
          rows: [{
            ...approvalRow,
            payload: {
              kind: 'single', key: 'tier2_subscription_cents',
              oldValue: '2500', newValue: 3000, reason: 'test',
            },
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = responseDouble();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 3000, reason: 'test' }),
      res,
      jest.fn()
    );

    const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes('INSERT INTO money_movement_approvals'))).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ queued: true, replay: true }));
  });

  test('an invalid value never queues', async () => {
    routeQueries();
    const res = responseDouble();
    const next = jest.fn();

    await controller.updateFeeConfig(
      requestDouble({ key: 'tier2_subscription_cents', value: 'not-a-number' }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('valid number') }));
    expect(res.json).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.map(([sql]) => String(sql)).some(
      (s) => s.includes('INSERT INTO money_movement_approvals')
    )).toBe(false);
  });

  test('reset proposes a reset approval and applies nothing', async () => {
    routeQueries();
    const res = responseDouble();

    await controller.resetToDefaults(requestDouble({ reason: 'test' }), res, jest.fn());

    const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes('INSERT INTO money_movement_approvals'))).toBe(true);
    expect(statements.some((s) => s.includes('UPDATE fee_config'))).toBe(false);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, queued: true }));
  });
});

// Transaction-client double for the executor: routes by statement text.
function executorClient({ failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql) => {
      const text = String(sql);
      calls.push(text);
      if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
      if (text.includes('FROM fee_config WHERE key')) return { rows: [configRow] };
      if (text === 'SELECT * FROM fee_config') {
        return {
          rows: [
            { key: 'tier2_subscription_cents', value: '2500' },
            { key: 'trial_duration_days', value: '7' },
            { key: 'platform_fee_pct', value: '10' },
          ],
        };
      }
      if (text.includes('INSERT INTO fee_change_log')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE fee_config')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('executeFeeConfigChange applies atomically on approval (item 12)', () => {
  test('log INSERT and config UPDATE are issued in order inside the decide transaction', async () => {
    routeQueries();
    const client = executorClient();

    const result = await controller.executeFeeConfigChange({
      approval: { id: 'appr-1' },
      payload: {
        kind: 'single', key: 'tier2_subscription_cents',
        oldValue: '2500', newValue: 3000, reason: 'test', ipHash: null,
      },
      approverId: 'admin-2',
      client,
    });

    const insertIdx = client.calls.findIndex((s) => s.includes('INSERT INTO fee_change_log'));
    const updateIdx = client.calls.findIndex((s) => s.includes('UPDATE fee_config'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(insertIdx);
    expect(result).toMatchObject({ feeApplied: true, key: 'tier2_subscription_cents', newValue: 3000 });
  });

  test('a failing config UPDATE propagates instead of returning success', async () => {
    routeQueries();
    const client = executorClient({ failOn: 'UPDATE fee_config' });

    await expect(controller.executeFeeConfigChange({
      approval: { id: 'appr-1' },
      payload: {
        kind: 'single', key: 'tier2_subscription_cents',
        oldValue: '2500', newValue: 3000, reason: 'test', ipHash: null,
      },
      approverId: 'admin-2',
      client,
    })).rejects.toThrow('UPDATE fee_config');
  });

  test('reset executor logs and updates exactly the rows that differ from defaults', async () => {
    routeQueries();
    const client = executorClient();

    const result = await controller.executeFeeConfigChange({
      approval: { id: 'appr-2' },
      payload: { kind: 'reset', reason: 'test' },
      approverId: 'admin-2',
      client,
    });

    const logCount = client.calls.filter((s) => s.includes('INSERT INTO fee_change_log')).length;
    const updateCount = client.calls.filter((s) => s.includes('UPDATE fee_config')).length;
    // tier2_subscription_cents (2500->1499) and platform_fee_pct (10->0.071)
    // change; trial_duration_days is not in DEFAULTS.
    expect(logCount).toBe(2);
    expect(updateCount).toBe(2);
    expect(result.changedKeys).toEqual(['tier2_subscription_cents', 'platform_fee_pct']);
  });
});

describe('executeFeeConfigChange Stripe sync in afterCommit (item 12)', () => {
  test('provider failure records stripeSync failed, never a silent success', async () => {
    routeQueries();
    stripeMock.prices.create.mockRejectedValue(new Error('stripe exploded'));
    const client = executorClient();

    const result = await controller.executeFeeConfigChange({
      approval: { id: 'appr-1' },
      payload: {
        kind: 'single', key: 'tier2_subscription_cents',
        oldValue: '2500', newValue: 3000, reason: 'test', ipHash: null,
      },
      approverId: 'admin-2',
      client,
    });

    expect(result.stripeSync).toBe('pending');
    await result.afterCommit();
    expect(result.stripeSync).toBe('failed');
    expect(stripeMock.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 3000, currency: 'usd' })
    );
  });

  test('successful sync records stripeSync synced', async () => {
    routeQueries();
    const client = executorClient();

    const result = await controller.executeFeeConfigChange({
      approval: { id: 'appr-1' },
      payload: {
        kind: 'single', key: 'tier2_subscription_cents',
        oldValue: '2500', newValue: 3000, reason: 'test', ipHash: null,
      },
      approverId: 'admin-2',
      client,
    });

    await result.afterCommit();
    expect(result.stripeSync).toBe('synced');
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
