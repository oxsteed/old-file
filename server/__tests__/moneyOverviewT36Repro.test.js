'use strict';

/**
 * Regression test for the T36-F01 follow-up integration bug.
 *
 * Commit 841afe0f re-keyed the money-overview ledger map from bare
 * `source_type` keys to `source_type:currency` keys, but the subscriptions
 * revenue channel still read `ledgerMap.subscription` (the old key). With the
 * new keys that lookup is always undefined, so the "Premium subscriptions"
 * channel silently reports 0 cents even when subscription ledger rows exist.
 *
 * Failing assertion (pre-fix): subscriptions channel periodCents is 0.
 * Fixed behavior: the channel reflects the USD subscription ledger row, and
 * non-USD rows stay out of the USD reporting headline.
 */

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/superAdminController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function installLedgerDispatch() {
  mockQuery.mockImplementation((sql, params) => {
    const text = String(sql);
    if (text.startsWith('SHOW search_path')) {
      return Promise.resolve({ rows: [{ search_path: 'public' }] });
    }
    if (text.includes('information_schema.tables')) {
      const name = Array.isArray(params) ? params[1] : null;
      const exists = ['platform_ledger', 'subscriptions'].includes(name);
      return Promise.resolve({ rows: exists ? [{ '1': 1 }] : [] });
    }
    if (text.includes('GROUP BY source_type, UPPER(currency)')) {
      return Promise.resolve({
        rows: [
          {
            source_type: 'subscription', currency: 'USD',
            period_count: '5', lifetime_count: '40',
            period_positive_cents: '5000', period_negative_cents: '100',
            lifetime_positive_cents: '40000', lifetime_negative_cents: '200',
          },
          {
            source_type: 'subscription', currency: 'EUR',
            period_count: '1', lifetime_count: '3',
            period_positive_cents: '900', period_negative_cents: '0',
            lifetime_positive_cents: '2700', lifetime_negative_cents: '0',
          },
          {
            source_type: 'job_fee', currency: 'USD',
            period_count: '2', lifetime_count: '10',
            period_positive_cents: '1000', period_negative_cents: '0',
            lifetime_positive_cents: '8000', lifetime_negative_cents: '0',
          },
        ],
      });
    }
    if (text.includes('FROM subscriptions') && text.includes("status = 'active'")) {
      return Promise.resolve({ rows: [{ count: '3' }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('T36 follow-up: subscriptions revenue channel uses the (source, currency) ledger key', () => {
  test('USD subscription ledger rows reach the subscriptions channel', async () => {
    installLedgerDispatch();
    const res = makeRes();
    await controller.getMoneyOverview({ query: {} }, res);
    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    const subscriptions = (payload.channels || []).find((c) => c.key === 'subscriptions');
    expect(subscriptions).toBeDefined();
    expect(subscriptions.periodCents).toBe(5000);
    expect(subscriptions.lifetimeCents).toBe(40000);
    expect(subscriptions.refundsCents).toBe(100);
    expect(subscriptions.count).toBe(3);
  });

  test('non-USD subscription rows stay out of the USD headline channel', async () => {
    installLedgerDispatch();
    const res = makeRes();
    await controller.getMoneyOverview({ query: {} }, res);
    const payload = res.json.mock.calls[0][0];
    const subscriptions = (payload.channels || []).find((c) => c.key === 'subscriptions');
    // 5000 USD + 900 EUR must not be mixed into the USD channel.
    expect(subscriptions.periodCents).not.toBe(5900);
  });
});
