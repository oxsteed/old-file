'use strict';

// Admin-ops audit item 8: the restaurant-payout admin queue must page through
// the full queue instead of truncating at 500 oldest-first (which hid the
// NEWEST requests past the cap). Covers the { payouts, total, limit, offset }
// shape, offset forwarding, the 500 cap, and the count query filter.

jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../utils/transaction', () => ({
  withTransaction: jest.fn(),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  ensureAccount: jest.fn(),
  postJournalTransaction: jest.fn(),
  assertSupportedCreditCurrency: jest.fn(),
  assertCreditRailEnabled: jest.fn(),
}));
jest.mock('../services/oxsteedCreditSubBankService', () => ({
  ensureRestaurantSubBankAccount: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

const service = require('../services/restaurantPayoutService');

function fakeClient({ pageRows = [], total = 0 } = {}) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total }] };
      return { rows: pageRows };
    }),
  };
}

test('returns payouts plus total, limit, and offset for the first page', async () => {
  const client = fakeClient({ pageRows: [{ id: 'p1' }], total: 620 });
  const result = await service.listAdminQueue(client, { status: 'requested', limit: 50, offset: 0 });
  expect(result.payouts).toEqual([{ id: 'p1' }]);
  expect(result.total).toBe(620);
  expect(result.limit).toBe(50);
  expect(result.offset).toBe(0);
  expect(client.calls[0].params).toEqual(['requested', 50, 0]);
  expect(client.calls[0].sql).toMatch(/LIMIT \$2 OFFSET \$3/);
  expect(client.calls[1].sql).toMatch(/COUNT\(\*\)/);
  expect(client.calls[1].params).toEqual(['requested']);
});

test('forwards offset so pages past the old cap reach the newest requests', async () => {
  const client = fakeClient({ pageRows: [{ id: 'p501' }], total: 620 });
  const result = await service.listAdminQueue(client, { status: 'requested', limit: 50, offset: 500 });
  expect(result.offset).toBe(500);
  expect(result.payouts).toEqual([{ id: 'p501' }]);
  expect(client.calls[0].params).toEqual(['requested', 50, 500]);
});

test('caps limit at 500 and clamps negative offset to 0', async () => {
  const client = fakeClient({ pageRows: [], total: 0 });
  const result = await service.listAdminQueue(client, { status: 'requested', limit: 9999, offset: -10 });
  expect(result.limit).toBe(500);
  expect(result.offset).toBe(0);
});

test('keeps the oldest-first order and the status filter', async () => {
  const client = fakeClient({ pageRows: [], total: 3 });
  await service.listAdminQueue(client, { status: 'approved', limit: 50, offset: 0 });
  expect(client.calls[0].sql).toMatch(/ORDER BY p\.created_at ASC/);
  expect(client.calls[0].params[0]).toBe('approved');
  expect(client.calls[1].params).toEqual(['approved']);
});
