'use strict';

// Finding 48: the merchant payout history was capped at 20 with no pager,
// and the server list had no offset or total. Covers the { payouts, total,
// limit, offset } shape, offset forwarding, and the 200 cap, mirroring the
// admin queue fix.

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
      if (/FROM food_restaurants/.test(sql)) return { rows: [{ id: 9, display_name: 'Test', currency_code: 'USD' }] };
      return { rows: pageRows };
    }),
  };
}

test('returns payouts plus total, limit, and offset for the first page', async () => {
  const client = fakeClient({ pageRows: [{ id: 'p1' }], total: 45 });
  const result = await service.listPayouts(client, { restaurantId: 9, userId: 'u1', limit: 20, offset: 0 });
  expect(result.payouts).toEqual([{ id: 'p1' }]);
  expect(result.total).toBe(45);
  expect(result.limit).toBe(20);
  expect(result.offset).toBe(0);
  const pageCall = client.calls.find((c) => /FROM restaurant_payouts/.test(c.sql) && !/COUNT/.test(c.sql));
  expect(pageCall.params).toEqual([9, 20, 0]);
  expect(pageCall.sql).toMatch(/LIMIT \$2 OFFSET \$3/);
  const countCall = client.calls.find((c) => /COUNT\(\*\)/.test(c.sql));
  expect(countCall.params).toEqual([9]);
});

test('forwards offset so pages past the old cap reach older payouts', async () => {
  const client = fakeClient({ pageRows: [{ id: 'p21' }], total: 45 });
  const result = await service.listPayouts(client, { restaurantId: 9, userId: 'u1', limit: 20, offset: 20 });
  expect(result.offset).toBe(20);
  expect(result.payouts).toEqual([{ id: 'p21' }]);
});

test('caps limit at 200 and clamps negative offset to 0', async () => {
  const client = fakeClient({ pageRows: [], total: 0 });
  const result = await service.listPayouts(client, { restaurantId: 9, userId: 'u1', limit: 9999, offset: -5 });
  expect(result.limit).toBe(200);
  expect(result.offset).toBe(0);
});

test('applies the status filter to both page and count', async () => {
  const client = fakeClient({ pageRows: [], total: 3 });
  await service.listPayouts(client, { restaurantId: 9, userId: 'u1', status: 'failed', limit: 20, offset: 0 });
  const pageCall = client.calls.find((c) => /FROM restaurant_payouts/.test(c.sql) && !/COUNT/.test(c.sql));
  expect(pageCall.params).toEqual([9, 'failed', 20, 0]);
  const countCall = client.calls.find((c) => /COUNT\(\*\)/.test(c.sql));
  expect(countCall.params).toEqual([9, 'failed']);
});
