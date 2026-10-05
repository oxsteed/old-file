'use strict';

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
}));
jest.mock('../services/oxsteedCreditSubBankService', () => ({
  ensureRestaurantSubBankAccount: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('stripe', () => {
  const instance = { transfers: { create: jest.fn() } };
  const factory = jest.fn(() => instance);
  factory.__instance = instance;
  return factory;
});

process.env.STRIPE_SECRET_KEY = 'sk_test_payout';
process.env.PAYOUT_PROCESSOR_ENABLED = 'true';

const { withTransaction } = require('../utils/transaction');
const pool = require('../db');
const creditService = require('../services/oxsteedCreditService');
const subBankService = require('../services/oxsteedCreditSubBankService');
const { sendNotification } = require('../services/notificationService');
const stripeFactory = require('stripe');

const service = require('../services/restaurantPayoutService');

const RESTAURANT = {
  id: 42,
  display_name: 'Test Kitchen',
  currency_code: 'USD',
  stripe_account_id: 'acct_test123',
  stripe_payouts_enabled: true,
};

function mockClient({ restaurant = RESTAURANT, balanceCents = 5000, payout = null } = {}) {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT b.owner_user_id FROM')) return { rows: [{ owner_user_id: 'owner-1' }] };
    if (sql.includes('FROM food_restaurants')) return { rows: [restaurant] };
    if (sql.includes('INSERT INTO restaurant_payouts')) {
      if (payout === 'conflict') return { rows: [] };
      return {
        rows: [{
          id: 'payout-1',
          restaurant_id: 42,
          currency_code: 'USD',
          amount_cents: 2000,
          status: 'requested',
          stripe_account_id: 'acct_test123',
          idempotency_key: 'key-1',
          requested_by: 'user-1',
        }],
      };
    }
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE restaurant_id')) {
      return { rows: [payout] };
    }
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE id')) {
      // Return the latest state: completed after the UPDATE ran.
      const updated = client.__payoutStatus || (payout && payout.status);
      return { rows: [payout ? { ...payout, status: updated || 'requested' } : null].filter(Boolean) };
    }
    if (sql.includes('UPDATE restaurant_payouts')) {
      client.__payoutStatus = 'completed';
      return { rows: payout ? [{ ...payout, status: 'completed' }] : [] };
    }
    return { rows: [] };
  });
  withTransaction.mockReset();
  withTransaction.mockImplementation(async (transactionPool, operation) => {
    expect(transactionPool).toBe(pool);
    return operation(client);
  });
  subBankService.ensureRestaurantSubBankAccount.mockResolvedValue({
    id: 100,
    balance_cents: balanceCents,
  });
  creditService.ensureAccount.mockResolvedValue({ id: 200 });
  creditService.postJournalTransaction.mockResolvedValue({
    transaction: { id: 300 },
    replayed: false,
  });
  stripeFactory.__instance.transfers.create.mockResolvedValue({ id: 'tr_test123' });
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('rejects payout below the minimum', async () => {
  mockClient();
  await expect(service.requestPayout({
    restaurantId: 42,
    userId: 'user-1',
    amountCents: 500,
    currencyCode: 'USD',
    idempotencyKey: 'key-1',
  })).rejects.toMatchObject({ code: 'payout_below_minimum' });
});

test('rejects payout exceeding the balance', async () => {
  mockClient({ balanceCents: 1000 });
  await expect(service.requestPayout({
    restaurantId: 42,
    userId: 'user-1',
    amountCents: 2000,
    currencyCode: 'USD',
    idempotencyKey: 'key-1',
  })).rejects.toMatchObject({ code: 'payout_exceeds_balance' });
});

test('rejects payout without a connected Stripe account', async () => {
  mockClient({ restaurant: { ...RESTAURANT, stripe_account_id: null } });
  await expect(service.requestPayout({
    restaurantId: 42,
    userId: 'user-1',
    amountCents: 2000,
    currencyCode: 'USD',
    idempotencyKey: 'key-1',
  })).rejects.toMatchObject({ code: 'payout_account_not_connected' });
});

test('idempotent request returns the existing payout', async () => {
  const existing = {
    id: 'payout-9',
    restaurant_id: 42,
    status: 'requested',
    amount_cents: 2000,
  };
  mockClient({ payout: 'conflict' });
  // Second query (the fallback select) returns the existing row.
  const client = withTransaction.mock.calls;
  void client;
  const { withTransaction: wt } = require('../utils/transaction');
  wt.mockReset();
  const c = { query: jest.fn(), release: jest.fn() };
  c.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM food_restaurants')) return { rows: [RESTAURANT] };
    if (sql.includes('INSERT INTO restaurant_payouts')) return { rows: [] };
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE restaurant_id')) {
      return { rows: [existing] };
    }
    return { rows: [] };
  });
  wt.mockImplementationOnce(async (transactionPool, operation) => {
    expect(transactionPool).toBe(pool);
    return operation(c);
  });
  subBankService.ensureRestaurantSubBankAccount.mockResolvedValue({ id: 100, balance_cents: 5000 });

  const payout = await service.requestPayout({
    restaurantId: 42,
    userId: 'user-1',
    amountCents: 2000,
    currencyCode: 'USD',
    idempotencyKey: 'key-1',
  });
  expect(payout.id).toBe('payout-9');
});

test('approve executes the Stripe transfer and posts the journal', async () => {
  const payout = {
    id: 'payout-1',
    restaurant_id: 42,
    currency_code: 'USD',
    amount_cents: 2000,
    status: 'requested',
    stripe_account_id: 'acct_test123',
  };
  mockClient({ payout, balanceCents: 5000 });

  const done = await service.approvePayout({
    payoutId: 'payout-1',
    adminUserId: 'admin-1',
    reviewNote: 'looks good',
  });

  expect(done.status).toBe('completed');
  const stripe = stripeFactory.__instance;
  expect(stripe.transfers.create).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: 2000,
      currency: 'usd',
      destination: 'acct_test123',
    }),
    expect.objectContaining({ idempotencyKey: 'restaurant-payout-transfer:payout-1' })
  );
  expect(creditService.postJournalTransaction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      transactionType: 'sub_bank_payout',
      debitAccountId: 100,
      creditAccountId: 200,
      amountCents: 2000,
      idempotencyKey: 'restaurant-payout:payout-1',
    })
  );
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'payout_released' }));
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'payout_deposited' }));
});

test('approve fails closed when the processor is disabled', async () => {
  process.env.PAYOUT_PROCESSOR_ENABLED = 'false';
  const payout = {
    id: 'payout-1',
    restaurant_id: 42,
    currency_code: 'USD',
    amount_cents: 2000,
    status: 'requested',
    stripe_account_id: 'acct_test123',
  };
  mockClient({ payout, balanceCents: 5000 });
  await expect(service.approvePayout({
    payoutId: 'payout-1',
    adminUserId: 'admin-1',
  })).rejects.toMatchObject({ code: 'payout_processor_disabled' });
  process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
});

test('reject moves a requested payout to rejected', async () => {
  const payout = { id: 'payout-1', restaurant_id: 42, status: 'requested' };
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE id')) return { rows: [payout] };
    if (sql.includes('UPDATE restaurant_payouts')) {
      return { rows: [{ ...payout, status: 'rejected' }] };
    }
    return { rows: [] };
  });
  withTransaction.mockReset();
  withTransaction.mockImplementation(async (transactionPool, operation) => {
    expect(transactionPool).toBe(pool);
    return operation(client);
  });

  const done = await service.rejectPayout({
    payoutId: 'payout-1',
    adminUserId: 'admin-1',
    reviewNote: 'duplicate',
  });
  expect(done.status).toBe('rejected');
});
