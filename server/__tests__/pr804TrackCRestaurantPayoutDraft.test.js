'use strict';

// PR #804 Track C — G-18 service tests (mock-based, mirroring
// restaurantPayoutService.test.js): a manager's payout request is a draft,
// an owner's is requested, only the owner confirms a draft, and managers
// read the payout list while other staff cannot.
//
// The migration side (the 'draft' status value + confirmation columns) is
// covered by pr804TrackCRestaurantPayoutDraft.db.test.js against the real
// schema, because the Credit ledger rules block direct balance edits in a
// DB-backed requestPayout test.

jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../utils/transaction', () => ({
  withTransaction: jest.fn(async (transactionPool, operation) => {
    const client = { query: jest.fn(), release: jest.fn() };
    return operation(client);
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
const subBankService = require('../services/oxsteedCreditSubBankService');

const service = require('../services/restaurantPayoutService');

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const REP_ID = '44444444-4444-4444-8444-444444444444';

function actorRow({ ownerId = OWNER_ID, memberRole = null } = {}) {
  return {
    id: 42,
    display_name: 'Test Kitchen',
    currency_code: 'USD',
    stripe_account_id: 'acct_test123',
    stripe_payouts_enabled: true,
    owner_id: ownerId,
    member_role: memberRole,
  };
}

// The actor query returns the row for the acting user; the owner-only
// query (requireRestaurantOwnership) returns a row only for the owner.
function mockClient({ actor = actorRow(), ownerRow = actorRow(), balanceCents = 5000, inserted = null } = {}) {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM food_restaurants')) {
      // requireRestaurantOwnership filters on b.user_id = $2 (owner only);
      // resolvePayoutActor returns the actor row. The two queries differ
      // in their selected columns: the actor query selects owner_id and
      // member_role.
      if (sql.includes('member_role')) return { rows: actor ? [actor] : [] };
      return { rows: ownerRow ? [ownerRow] : [] };
    }
    if (sql.includes('INSERT INTO restaurant_payouts')) {
      const row = inserted || {
        id: 'payout-1', restaurant_id: 42, currency_code: 'USD',
        amount_cents: params?.[2] ?? 2000, status: params?.[6] || 'requested',
        stripe_account_id: 'acct_test123', requested_by: 'user-1',
      };
      return { rows: [row] };
    }
    if (sql.includes('SELECT * FROM restaurant_payouts WHERE restaurant_id')) {
      return { rows: [] };
    }
    if (sql.includes('UPDATE restaurant_payouts')) {
      return { rows: [{ id: 'payout-1', restaurant_id: 42, status: 'requested' }] };
    }
    if (sql.includes('SELECT status FROM restaurant_payouts')) {
      return { rows: [{ status: 'requested' }] };
    }
    if (sql.includes('SELECT * FROM restaurant_payouts')) {
      return { rows: [{ id: 'payout-1', restaurant_id: 42, status: 'requested' }] };
    }
    if (sql.includes('SELECT COUNT(*)')) {
      return { rows: [{ total: 1 }] };
    }
    return { rows: [] };
  });
  withTransaction.mockReset();
  withTransaction.mockImplementation(async (transactionPool, operation) => operation(client));
  subBankService.ensureRestaurantSubBankAccount.mockResolvedValue({ id: 100, balance_cents: balanceCents });
  pool.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('manager request creates a draft, never a requested payout', async () => {
  mockClient({ actor: actorRow({ memberRole: 'manager' }) });
  const payout = await service.requestPayout({
    restaurantId: 42, userId: MANAGER_ID, amountCents: 2000,
    currencyCode: 'USD', idempotencyKey: 'key-draft',
  });
  expect(payout.status).toBe('draft');
});

test('owner request goes straight to requested', async () => {
  mockClient({ actor: actorRow({ memberRole: null }) });
  const payout = await service.requestPayout({
    restaurantId: 42, userId: OWNER_ID, amountCents: 2000,
    currencyCode: 'USD', idempotencyKey: 'key-direct',
  });
  expect(payout.status).toBe('requested');
});

test('a manager cannot self-promote a draft via initialStatus', async () => {
  mockClient({ actor: actorRow({ memberRole: 'manager' }) });
  await expect(service.requestPayout({
    restaurantId: 42, userId: MANAGER_ID, amountCents: 2000,
    currencyCode: 'USD', idempotencyKey: 'key-promote', initialStatus: 'requested',
  })).rejects.toMatchObject({ status: 403 });
});

test('other staff cannot request a payout at all', async () => {
  mockClient({ actor: null });
  await expect(service.requestPayout({
    restaurantId: 42, userId: REP_ID, amountCents: 2000,
    currencyCode: 'USD', idempotencyKey: 'key-rep',
  })).rejects.toMatchObject({ status: 404 });
});

test('owner confirms a draft; a non-owner cannot', async () => {
  // Owner path: ownership query returns a row.
  mockClient({ ownerRow: actorRow() });
  const confirmed = await service.confirmDraftPayout({
    restaurantId: 42, userId: OWNER_ID, payoutId: 'payout-1',
  });
  expect(confirmed.status).toBe('requested');

  // Manager path: ownership query returns nothing.
  mockClient({ ownerRow: null });
  await expect(service.confirmDraftPayout({
    restaurantId: 42, userId: MANAGER_ID, payoutId: 'payout-1',
  })).rejects.toMatchObject({ status: 404 });
});

test('manager reads the payout list; other staff cannot', async () => {
  const managerClient = mockClient({ actor: actorRow({ memberRole: 'manager' }) });
  const page = await service.listPayouts(managerClient, { restaurantId: 42, userId: MANAGER_ID });
  expect(page.total).toBe(1);

  const repClient = mockClient({ actor: null });
  await expect(service.listPayouts(repClient, { restaurantId: 42, userId: REP_ID }))
    .rejects.toMatchObject({ status: 404 });
});
