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

describe('franchise currency: money-overview franchise channel is USD-headline only', () => {
  // Regression for the franchise residual: franchise_agreements.initial_fee_cents
  // was summed with no currency at all, so a EUR fee landed in the USD headline
  // and in summary.pipelineCents. Fixed behavior: the headline sums the
  // reporting currency (USD) only; every other currency appears solely in the
  // per-currency breakdown. No FX conversion anywhere.
  function installFranchiseDispatch({ currencyColumn = true } = {}) {
    mockQuery.mockImplementation((sql, params) => {
      const text = String(sql);
      if (text.startsWith('SHOW search_path')) {
        return Promise.resolve({ rows: [{ search_path: 'public' }] });
      }
      if (text.includes('information_schema.tables')) {
        const name = Array.isArray(params) ? params[1] : null;
        const exists = ['platform_ledger', 'franchise_programs', 'franchise_agreements', 'franchise_applications'].includes(name);
        return Promise.resolve({ rows: exists ? [{ '1': 1 }] : [] });
      }
      if (text.includes('information_schema.columns')) {
        const table = Array.isArray(params) ? params[1] : null;
        const column = Array.isArray(params) ? params[2] : null;
        const exists = currencyColumn && table === 'franchise_agreements' && column === 'currency';
        return Promise.resolve({ rows: exists ? [{ '1': 1 }] : [] });
      }
      if (text.includes('FROM franchise_programs')) {
        return Promise.resolve({ rows: [{ active_programs: '1' }] });
      }
      if (text.includes('FROM franchise_agreements') && text.includes('GROUP BY UPPER(currency)')) {
        return Promise.resolve({
          rows: [
            {
              currency: 'EUR', signed_initial_fees_cents: '2500000', pending_initial_fees_cents: '3000000',
              signed_agreements: '1', royalty_bps_sum: '600', royalty_bps_count: '1',
              marketing_fee_bps_sum: '200', marketing_fee_bps_count: '1',
            },
            {
              currency: 'USD', signed_initial_fees_cents: '2500000', pending_initial_fees_cents: '0',
              signed_agreements: '1', royalty_bps_sum: '600', royalty_bps_count: '1',
              marketing_fee_bps_sum: '200', marketing_fee_bps_count: '1',
            },
          ],
        });
      }
      if (text.includes('FROM franchise_agreements')) {
        return Promise.resolve({
          rows: [{
            signed_initial_fees_cents: '5000000', pending_initial_fees_cents: '3000000',
            signed_agreements: '2', average_royalty_bps: '600', average_marketing_fee_bps: '200',
          }],
        });
      }
      if (text.includes('FROM franchise_applications')) {
        return Promise.resolve({ rows: [{ pipeline_applications: '0', launched_stores: '0' }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  test('USD signed fee headlines alone; EUR fee lives only in byCurrency', async () => {
    installFranchiseDispatch({ currencyColumn: true });
    const res = makeRes();
    await controller.getMoneyOverview({ query: {} }, res);
    const payload = res.json.mock.calls[0][0];
    const franchise = (payload.channels || []).find((c) => c.key === 'franchise_program');
    expect(franchise).toBeDefined();
    // 2,500,000 USD + 2,500,000 EUR must not sum to 5,000,000.
    expect(franchise.lifetimeCents).toBe(2500000);
    expect(franchise.periodCents).toBe(2500000);
    expect(franchise.lifetimeCents).not.toBe(5000000);
    const eur = (franchise.byCurrency || []).find((row) => row.currency === 'EUR');
    expect(eur).toBeDefined();
    expect(eur.signedInitialFeesCents).toBe(2500000);
    expect(eur.pendingInitialFeesCents).toBe(3000000);
    const usd = (franchise.byCurrency || []).find((row) => row.currency === 'USD');
    expect(usd).toBeDefined();
    expect(usd.signedInitialFeesCents).toBe(2500000);
  });

  test('summary.pipelineCents excludes a non-USD pending fee', async () => {
    installFranchiseDispatch({ currencyColumn: true });
    const res = makeRes();
    await controller.getMoneyOverview({ query: {} }, res);
    const payload = res.json.mock.calls[0][0];
    const franchise = (payload.channels || []).find((c) => c.key === 'franchise_program');
    expect(franchise.pendingCents).toBe(0);
    // Consulting and marketplace pendings are 0 in this dispatch, so any
    // EUR pending leaking into the headline would show up here.
    expect(payload.summary.pipelineCents).toBe(0);
    expect(payload.summary.pipelineCents).not.toBe(3000000);
  });

  test('pre-migration table without a currency column keeps the old totals', async () => {
    installFranchiseDispatch({ currencyColumn: false });
    const res = makeRes();
    await controller.getMoneyOverview({ query: {} }, res);
    const payload = res.json.mock.calls[0][0];
    const franchise = (payload.channels || []).find((c) => c.key === 'franchise_program');
    expect(franchise).toBeDefined();
    expect(franchise.lifetimeCents).toBe(5000000);
    expect(franchise.pendingCents).toBe(3000000);
    expect(franchise.byCurrency).toEqual([]);
  });
});
