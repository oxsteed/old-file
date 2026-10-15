'use strict';

/**
 * statementCenter.test.js — focused tests for the Statement Center endpoint.
 *
 * Route tests mock the service (auth + shape). Service tests use the real
 * service against the shared pg mock (mockQuery) and exercise the read-only
 * aggregation: positive, empty, and partial-failure cases. Money assertions
 * check that unlike currencies are never combined and missing data surfaces
 * as null, never zero.
 */

jest.mock('../services/statementCenterService', () => ({ getStatementCenter: jest.fn() }));

const { mockQuery, resetMocks } = require('./setup');
const { getStatementCenter: mockedGetStatementCenter } = require('../services/statementCenterService');
const { getStatementCenter: realGetStatementCenter } = jest.requireActual('../services/statementCenterService');

const CUSTOMER = '22222222-2222-4222-8222-222222222222';

function emptyProduct() {
  return {
    hasAccount: false,
    setupState: 'unavailable',
    latestPeriod: null,
    statementStatus: 'none',
    summary: null,
    scopes: [],
  };
}

describe('getStatementCenter service', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
    // Default: every query returns no rows (user with no accounts anywhere).
    mockQuery.mockImplementation(async () => ({ rows: [] }));
  });

  test('user with no accounts gets setup prompts, never reassuring zeros', async () => {
    const result = await realGetStatementCenter(CUSTOMER);
    expect(result.generatedAt).toBeTruthy();
    expect(Object.keys(result.products).sort()).toEqual(
      ['business', 'helperEarnings', 'oxsteedCredit', 'restaurantCredit', 'restaurantSettlement'].sort(),
    );
    // Rail flag query returns no rows -> creditRailEnabled() false -> unavailable.
    expect(result.products.oxsteedCredit.setupState).toBe('unavailable');
    expect(result.products.oxsteedCredit.hasAccount).toBe(false);
    // Any customer can fund a restaurant wallet.
    expect(result.products.restaurantCredit.setupState).toBe('setup_needed');
    expect(result.products.restaurantSettlement.setupState).toBe('unavailable');
    expect(result.products.helperEarnings.setupState).toBe('unavailable');
    expect(result.products.business.setupState).toBe('unavailable');
    for (const product of Object.values(result.products)) {
      expect(product.latestPeriod).toBeNull();
      expect(product.statementStatus).toBe('none');
      expect(product.summary).toBeNull();
      expect(product.scopes).toEqual([]);
      expect(product.loadError).toBeUndefined();
    }
  });

  test('oxsteed credit account with an issued document reports ready with balance and last-period figures', async () => {
    const document = {
      totalCreditsCents: 2000,
      totalDebitsCents: 500,
      openingBalanceCents: 3500,
      closingBalanceCents: 5000,
    };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('oxsteed_credit_accounts')) {
        return { rows: [{ id: 7, currency_code: 'USD', balance_cents: 5000, status: 'active' }] };
      }
      if (sql.includes("key = 'oxsteed_credit_enabled'")) {
        return { rows: [{ is_enabled: true }] };
      }
      if (sql.includes('credit_statement_documents')) {
        return { rows: [{ id: 'doc-1', currency_code: 'USD', period_from: '2026-09-01', period_to: '2026-09-30', document }] };
      }
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    const credit = result.products.oxsteedCredit;
    expect(credit.hasAccount).toBe(true);
    expect(credit.setupState).toBe('ready');
    expect(credit.latestPeriod).toBe('2026-09');
    expect(credit.statementStatus).toBe('ready');
    expect(credit.summary.balance).toEqual({ currency: 'USD', amountCents: 5000 });
    expect(credit.summary.lastPeriodCredits).toEqual({ currency: 'USD', amountCents: 2000 });
    expect(credit.summary.lastPeriodDebits).toEqual({ currency: 'USD', amountCents: 500 });
    expect(credit.scopes).toHaveLength(1);
    expect(credit.scopes[0].latestDocumentId).toBe('doc-1');
    expect(credit.scopes[0].accountId).toBe('7');
  });

  test('multi-currency accounts keep currencies separate', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('oxsteed_credit_accounts')) {
        return { rows: [
          { id: 7, currency_code: 'EUR', balance_cents: 1000, status: 'active' },
          { id: 8, currency_code: 'USD', balance_cents: 5000, status: 'active' },
        ] };
      }
      if (sql.includes("key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    const credit = result.products.oxsteedCredit;
    expect(credit.scopes).toHaveLength(2);
    // Product-level summary stays null so the UI iterates scopes per currency.
    expect(credit.summary).toBeNull();
    const currencies = credit.scopes.map((scope) => scope.summary.balance.currency).sort();
    expect(currencies).toEqual(['EUR', 'USD']);
  });

  test('preparing issuance job surfaces as preparing, not ready', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('oxsteed_credit_accounts')) {
        return { rows: [{ id: 7, currency_code: 'USD', balance_cents: 0, status: 'active' }] };
      }
      if (sql.includes("key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
      if (sql.includes('statement_account_jobs')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    expect(result.products.oxsteedCredit.statementStatus).toBe('preparing');
    expect(result.products.oxsteedCredit.scopes[0].statementStatus).toBe('preparing');
  });

  test('helper with an issued document reports payable/earned/settled', async () => {
    const document = {
      closingPayableCents: 12000,
      postedEarningsCents: 15000,
      settledPayoutsCents: 3000,
      statusRemovalsCents: 0,
    };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes("role = 'helper'")) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('helper_earnings')) {
        return { rows: [{ currency_code: 'USD', period_to: '2026-08-31', id: 'doc-h', document }] };
      }
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    const helper = result.products.helperEarnings;
    expect(helper.hasAccount).toBe(true);
    expect(helper.setupState).toBe('ready');
    expect(helper.latestPeriod).toBe('2026-08');
    expect(helper.summary.payable).toEqual({ currency: 'USD', amountCents: 12000 });
    expect(helper.summary.earned).toEqual({ currency: 'USD', amountCents: 15000 });
    expect(helper.summary.settled).toEqual({ currency: 'USD', amountCents: 3000 });
  });

  test('business document maps receivables terminology; adjusted stays explicitly null', async () => {
    const document = {
      receivables: {
        closingOutstandingCents: 9000,
        invoicedCents: 12000,
        collectedOrAdjustedCents: 3000,
        cancelledCents: 0,
      },
    };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM businesses b')) {
        return { rows: [{ id: 42, name: 'Acme Co' }] };
      }
      if (sql.includes("product = 'business'")) {
        return { rows: [{ scope_business_id: 42, currency_code: 'USD', period_to: '2026-09-30', id: 'doc-b', document }] };
      }
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    const business = result.products.business;
    expect(business.hasAccount).toBe(true);
    expect(business.summary.outstanding).toEqual({ currency: 'USD', amountCents: 9000 });
    expect(business.summary.invoiced).toEqual({ currency: 'USD', amountCents: 12000 });
    expect(business.summary.collected).toEqual({ currency: 'USD', amountCents: 3000 });
    expect(business.summary.adjusted).toBeNull();
  });

  test('restaurant settlement maps journal closing to outstanding; invoiced/collected from the document', async () => {
    const document = {
      closingBalanceCents: 7500,
      orders: [{ totalCents: 10000 }, { totalCents: 2000 }],
      payouts: [
        { amountCents: 5000, outcome: 'verified' },
        { amountCents: 999, outcome: 'in_transit' },
      ],
    };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM food_restaurants fr')) {
        return { rows: [{ id: 9, display_name: 'Bistro', business_id: 42 }] };
      }
      if (sql.includes("account_type = 'restaurant_sub_bank'")) {
        return { rows: [{ restaurant_id: 9, currency_code: 'USD', balance_cents: 7600 }] };
      }
      if (sql.includes("product = 'restaurant_settlement'")) {
        return { rows: [{ scope_restaurant_id: 9, currency_code: 'USD', period_to: '2026-09-30', id: 'doc-rs', document }] };
      }
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    const settlement = result.products.restaurantSettlement;
    expect(settlement.hasAccount).toBe(true);
    expect(settlement.setupState).toBe('ready');
    expect(settlement.scopes[0]).toMatchObject({ restaurantId: '9', businessId: '42' });
    expect(settlement.latestPeriod).toBe('2026-09');
    expect(settlement.summary.outstanding).toEqual({ currency: 'USD', amountCents: 7500 });
    expect(settlement.summary.invoiced).toEqual({ currency: 'USD', amountCents: 12000 });
    // Only verified (completed) payouts count as collected.
    expect(settlement.summary.collected).toEqual({ currency: 'USD', amountCents: 5000 });
    expect(settlement.summary.adjusted).toBeNull();
  });

  test('a failing product degrades to unavailable without breaking the others', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('food_customer_wallet_accounts')) throw new Error('synthetic db failure');
      return { rows: [] };
    });
    const result = await realGetStatementCenter(CUSTOMER);
    expect(result.products.restaurantCredit.loadError).toBe(true);
    expect(result.products.restaurantCredit.setupState).toBe('unavailable');
    // Other products still resolve.
    expect(result.products.oxsteedCredit.loadError).toBeUndefined();
    expect(result.products.business.setupState).toBe('unavailable');
  });
});

describe('GET /api/statements/center route', () => {
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const revocations = require('../services/tokenRevocationService');

  const app = express();
  app.use('/api', require('../routes/statementCenter'));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));

  const user = {
    id: CUSTOMER, role: 'customer', default_mode: 'customer', email: 'synthetic@example.invalid',
    is_active: true, email_verified: true, id_verified: true, totp_enabled: true,
  };

  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
    mockQuery.mockImplementation(async () => ({ rows: [user] }));
    revocations.isRevoked.mockResolvedValue(false);
    mockedGetStatementCenter.mockResolvedValue({ generatedAt: new Date().toISOString(), products: {
      oxsteedCredit: emptyProduct(),
      restaurantCredit: emptyProduct(),
      restaurantSettlement: emptyProduct(),
      helperEarnings: emptyProduct(),
      business: emptyProduct(),
    } });
  });

  function bearer(claims = {}) {
    return `Bearer ${jwt.sign({ id: CUSTOMER, role: 'customer', ...claims }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
  }

  test('anonymous requests are rejected and the service is not called', async () => {
    await request(app).get('/api/statements/center').expect(401);
    expect(mockedGetStatementCenter).not.toHaveBeenCalled();
  });

  test('refresh tokens are rejected', async () => {
    await request(app).get('/api/statements/center').set('Authorization', bearer({ type: 'refresh' })).expect(401);
    expect(mockedGetStatementCenter).not.toHaveBeenCalled();
  });

  test('authenticated user receives their own center payload with no-store headers', async () => {
    const res = await request(app).get('/api/statements/center').set('Authorization', bearer()).expect(200);
    expect(mockedGetStatementCenter).toHaveBeenCalledWith(CUSTOMER);
    expect(Object.keys(res.body.products)).toHaveLength(5);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('service failure propagates as 500 without leaking internals', async () => {
    mockedGetStatementCenter.mockRejectedValue(new Error('synthetic failure'));
    const res = await request(app).get('/api/statements/center').set('Authorization', bearer()).expect(500);
    expect(res.body.code).toBeUndefined();
  });
});
