'use strict';

/**
 * restaurantSideTrackCPayout.test.js
 *
 * Finding 2 reproduction tests: restaurant payout approval revalidates
 * the CURRENT Connect account, and never journals or transfers when the
 * destination changed since the payout was requested. Kept separate from
 * restaurantSideTrackC.test.js because the payout service suite mocks
 * ../db directly instead of the shared pg mock in __tests__/setup.
 */

jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../utils/transaction', () => ({
  withTransaction: jest.fn(async (fn) => {
    const client = { query: jest.fn(), release: jest.fn() };
    return fn(client);
  }),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  ensureAccount: jest.fn(),
  postJournalTransaction: jest.fn(),
  assertSupportedCreditCurrency: jest.fn((c) => String(c).toUpperCase()),
  assertCreditRailEnabled: jest.fn(),
}));
jest.mock('../services/oxsteedCreditSubBankService', () => ({
  ensureRestaurantSubBankAccount: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('stripe', () => {
  const instance = { transfers: { create: jest.fn(), retrieve: jest.fn() } };
  const factory = jest.fn(() => instance);
  factory.__instance = instance;
  return factory;
});

process.env.STRIPE_SECRET_KEY = 'sk_test_payout';
process.env.PAYOUT_PROCESSOR_ENABLED = 'true';

const { withTransaction } = require('../utils/transaction');
const pool = require('../db');
const creditService = require('../services/oxsteedCreditService');
const service = require('../services/restaurantPayoutService');

const PAYOUT = {
  id: 7, restaurant_id: 42, currency_code: 'USD', amount_cents: 2000,
  status: 'requested', stripe_account_id: 'acct_old', idempotency_key: 'key-1',
};

function mockApproveClient({ currentAccountRow }) {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE id')) return { rows: [PAYOUT] };
    if (sql.includes('FROM restaurant_connect_accounts')) {
      return { rows: currentAccountRow ? [currentAccountRow] : [] };
    }
    return { rows: [] };
  });
  withTransaction.mockReset();
  withTransaction.mockImplementation(async (transactionPool, operation) => {
    expect(transactionPool).toBe(pool);
    return operation(client);
  });
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('finding 2: payout destination revalidation at approve', () => {
  test('rejects when the current Connect account differs from the snapshot', async () => {
    const client = mockApproveClient({ currentAccountRow: { stripe_account_id: 'acct_new' } });
    await expect(service.approvePayout({ payoutId: 7, adminUserId: 'admin-1' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'payout_destination_changed' });
    expect(creditService.postJournalTransaction).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE restaurant_payouts'))).toBe(false);
  });

  test('rejects when the restaurant has no Connect account anymore', async () => {
    mockApproveClient({ currentAccountRow: null });
    await expect(service.approvePayout({ payoutId: 7, adminUserId: 'admin-1' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'payout_destination_changed' });
    expect(creditService.postJournalTransaction).not.toHaveBeenCalled();
  });
});
