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
    if (sql.includes('SELECT funds_settled FROM restaurant_payouts')) return { rows: [{ funds_settled: false }] };
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
      const status = sql.match(/status\s*=\s*'([^']+)'/)?.[1] || client.__payoutStatus || 'approved';
      client.__payoutStatus = status;
      return { rows: payout ? [{ ...payout, status }] : [] };
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

test('approve journals and queues the transfer without calling Stripe in the transaction', async () => {
  const payout = {
    id: 'payout-1',
    restaurant_id: 42,
    currency_code: 'USD',
    amount_cents: 2000,
    status: 'requested',
    stripe_account_id: 'acct_test123',
  };
  const client = mockClient({ payout, balanceCents: 5000 });

  const done = await service.approvePayout({
    payoutId: 'payout-1',
    adminUserId: 'admin-1',
    reviewNote: 'looks good',
  });

  expect(done.status).toBe('approved');
  const stripe = stripeFactory.__instance;
  expect(stripe.transfers.create).not.toHaveBeenCalled();
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
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO restaurant_payout_outbox'),
    ['payout-1']
  );
  expect(sendNotification).not.toHaveBeenCalled();
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

test('worker creates Stripe transfer only for a journaled outbox item', async () => {
  const payout = {
    id: 'payout-1',
    payout_id: 'payout-1',
    restaurant_id: 42,
    currency_code: 'USD',
    amount_cents: 2000,
    stripe_account_id: 'acct_test123',
    payout_status: 'approved',
    ledger_transaction_id: 300,
    attempts: 1,
    lease_token: 'lease-1',
  };
  const claimClient = { query: jest.fn(), release: jest.fn() };
  claimClient.query
    .mockResolvedValueOnce({ rows: [payout] })
    .mockResolvedValueOnce({ rows: [{ ...payout, status: 'processing', lease_token: 'lease-1' }] });
  const persistClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  withTransaction.mockImplementation(async (transactionPool, operation, label) => {
    expect(transactionPool).toBe(pool);
    return operation(label === 'restaurant_payout_outbox_claim' ? claimClient : persistClient);
  });

  const result = await service.processNextTransfer();

  expect(result).toMatchObject({ processed: true, payoutId: 'payout-1', awaitingWebhook: true });
  expect(stripeFactory.__instance.transfers.create).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: 2000,
      currency: 'usd',
      destination: 'acct_test123',
      metadata: expect.objectContaining({ restaurant_payout_id: 'payout-1' }),
    }),
    { idempotencyKey: 'restaurant-payout-transfer:payout-1' },
  );
  expect(persistClient.query).toHaveBeenCalledWith(
    expect.stringContaining("SET status = 'processing'"),
    expect.arrayContaining(['payout-1', 'tr_test123']),
  );
});

test('transfer.created webhook completes the payout and is idempotent', async () => {
  const payout = {
    id: 'payout-1',
    restaurant_id: 42,
    currency_code: 'USD',
    amount_cents: 2000,
    stripe_account_id: 'acct_test123',
    status: 'processing',
    stripe_transfer_id: 'tr_test123',
  };
  const client = { query: jest.fn(), release: jest.fn() };
  let current = { ...payout };
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE id = $1 OR stripe_transfer_id = $2')) {
      return { rows: [current] };
    }
    if (sql.includes("SET status = 'completed'")) current = { ...current, status: 'completed' };
    return { rows: [] };
  });
  withTransaction.mockImplementation(async (transactionPool, operation) => operation(client));
  pool.query.mockResolvedValue({ rows: [{ owner_user_id: 'owner-1' }] });

  const transfer = {
    id: 'tr_test123',
    amount: 2000,
    currency: 'usd',
    destination: 'acct_test123',
    metadata: { restaurant_payout_id: 'payout-1' },
  };
  const first = await service.applyTransferWebhookEvent({ eventType: 'transfer.created', transfer });
  const second = await service.applyTransferWebhookEvent({ eventType: 'transfer.created', transfer });

  expect(first).toMatchObject({ status: 'completed', transferId: 'tr_test123', transitioned: true });
  expect(second).toMatchObject({ status: 'completed', transitioned: false });
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining("SET status = 'completed'"),
    expect.arrayContaining(['payout-1', 'tr_test123', 'transfer.created']),
  );
});

test('transfer.reversed webhook posts one compensating journal entry', async () => {
  const payout = {
    id: 'payout-1',
    restaurant_id: 42,
    currency_code: 'USD',
    amount_cents: 2000,
    stripe_account_id: 'acct_test123',
    status: 'completed',
    stripe_transfer_id: 'tr_test123',
    reversal_ledger_transaction_id: null,
  };
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(async (sql) => (
    sql.includes('SELECT * FROM restaurant_payouts WHERE id = $1 OR stripe_transfer_id = $2')
      ? { rows: [payout] }
      : { rows: [] }
  ));
  withTransaction.mockImplementation(async (transactionPool, operation) => operation(client));
  pool.query.mockResolvedValue({ rows: [{ owner_user_id: 'owner-1' }] });
  subBankService.ensureRestaurantSubBankAccount.mockResolvedValue({ id: 100 });
  creditService.ensureAccount.mockResolvedValue({ id: 200 });
  creditService.postJournalTransaction.mockResolvedValue({ transaction: { id: 301 }, replayed: false });

  const transfer = {
    id: 'tr_test123',
    amount: 2000,
    currency: 'usd',
    destination: 'acct_test123',
    reversed: true,
    metadata: { restaurant_payout_id: 'payout-1' },
  };
  const result = await service.applyTransferWebhookEvent({ eventType: 'transfer.reversed', transfer });

  expect(result).toMatchObject({ status: 'reversed', transferId: 'tr_test123' });
  expect(creditService.postJournalTransaction).toHaveBeenCalledWith(
    client,
    expect.objectContaining({
      transactionType: 'sub_bank_payout_reversal',
      debitAccountId: 200,
      creditAccountId: 100,
      amountCents: 2000,
      idempotencyKey: 'restaurant-payout-reversal:payout-1',
    }),
  );
  expect(sendNotification).toHaveBeenCalledTimes(1);
});

test('reconciliation does not auto-send a legacy payout without a journal reference', async () => {
  pool.query.mockResolvedValue({ rows: [{ funds_settled: false }] });

  const summary = await service.reconcilePayouts();

  expect(summary).toMatchObject({ inspected: 1, attention: 1, requeued: 0, failed: 0 });
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(stripeFactory.__instance.transfers.retrieve).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO restaurant_payout_outbox'),
    expect.anything(),
  );
});
