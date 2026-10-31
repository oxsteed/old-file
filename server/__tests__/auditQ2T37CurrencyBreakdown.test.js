'use strict';

/**
 * auditQ2T37CurrencyBreakdown.test.js — Audit queue Q2, T37-F01.
 *
 * Original defect (Oct 2 audit): the restaurant-credit overview summed
 * balance, reserved, and available amounts without currency grouping, so
 * finance could not inspect each currency's aggregate liability from the
 * overview cards; the scalar totals are unqualified when more than one
 * currency is present.
 *
 * The fix: getOverview returns a per-currency breakdown (grouped native
 * balances) alongside the scalar totals. This test locks it: with wallets in
 * two currencies, the response must carry the grouped breakdown with the
 * correct per-currency sums, not just the mixed scalar total.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn().mockResolvedValue({ allowed: true }),
}));
jest.mock('../services/foodWalletService', () => ({
  ...jest.requireActual('../services/foodWalletService'),
  creditFoodWallet: jest.fn().mockResolvedValue({ entry: { id: 'ledger-1' }, account: { id: 9001 }, replayed: false }),
}));
jest.mock('../services/foodWalletAuditService', () => ({
  ...jest.requireActual('../services/foodWalletAuditService'),
  logFoodWalletOperatorAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/auditService', () => ({
  ...jest.requireActual('../services/auditService'),
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const controller = require('../controllers/restaurantCreditAdminController');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '22222222-2222-4222-8222-222222222222', role: 'super_admin' };
    next();
  });
  app.get('/overview', controller.getOverview);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('total_wallets')) {
      // Mixed-currency scalar totals: unqualified on their own.
      return {
        rows: [{
          total_wallets: 3,
          total_restaurants: 2,
          active_wallets: 3,
          suspended_wallets: 0,
          closed_wallets: 0,
          currency_count: 2,
          total_balance_cents: 100000,
          total_reserved_cents: 10000,
          total_available_cents: 90000,
        }],
      };
    }
    if (sql.includes('UPPER(a.currency_code)')) {
      return {
        rows: [
          { currency: 'EUR', wallet_count: 1, balance_cents: 40000, reserved_cents: 5000, available_cents: 35000 },
          { currency: 'USD', wallet_count: 2, balance_cents: 60000, reserved_cents: 5000, available_cents: 55000 },
        ],
      };
    }
    return { rows: [] };
  });
});

describe('T37-F01 currency breakdown', () => {
  test('mixed-currency overview carries grouped native balances per currency', async () => {
    const res = await request(createApp()).get('/overview');

    expect(res.status).toBe(200);
    const summary = res.body.summary;
    expect(summary.currencyCount).toBe(2);
    // The scalar total is still present but must not be the only figure.
    expect(summary.totalBalanceCents).toBe(100000);
    expect(summary.currencyBreakdown).toHaveLength(2);

    const byCurrency = Object.fromEntries(summary.currencyBreakdown.map((r) => [r.currency, r]));
    expect(byCurrency.USD).toMatchObject({ walletCount: 2, balanceCents: 60000, reservedCents: 5000, availableCents: 55000 });
    expect(byCurrency.EUR).toMatchObject({ walletCount: 1, balanceCents: 40000, reservedCents: 5000, availableCents: 35000 });
    // The breakdown must actually disambiguate the mixed total.
    expect(byCurrency.USD.balanceCents + byCurrency.EUR.balanceCents).toBe(summary.totalBalanceCents);
    expect(byCurrency.USD.balanceCents).not.toBe(summary.totalBalanceCents);
  });
});
