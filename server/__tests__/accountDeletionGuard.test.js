'use strict';

// Review P3-1039 / P3-1040: self-delete cancels subscriptions and refuses
// while money is still on the account.
const { mockQuery, resetMocks } = require('./setup');
const guard = require('../services/accountDeletionGuard');

beforeEach(() => resetMocks());

function respond(map) {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.includes('to_regclass')) return { rows: [{ t: 'x' }] };
    for (const [k, v] of Object.entries(map)) if (t.includes(k)) return { rows: [v] };
    return { rows: [{ n: 0, balance: 0, reserved: 0 }] };
  });
}

test('no money anywhere: no blockers', async () => {
  respond({});
  await expect(guard.findFinancialBlockers('u1')).resolves.toEqual([]);
});

test('credit balance, food wallet hold and pending payout all block', async () => {
  respond({
    'FROM oxsteed_credit_accounts': { balance: 500, reserved: 0 },
    'FROM food_customer_wallet_holds': { n: 1 },
    'FROM main_app_payout_requests': { n: 2 },
  });
  await expect(guard.findFinancialBlockers('u1')).resolves.toEqual(['credit_balance', 'food_wallet_hold', 'pending_payout']);
});

test('reserved-only credit and negative wallet balances block too', async () => {
  respond({
    'FROM oxsteed_credit_accounts': { balance: 0, reserved: 100 },
    'FROM food_customer_wallet_accounts': { balance: -10 },
  });
  await expect(guard.findFinancialBlockers('u1')).resolves.toEqual(['credit_balance', 'food_wallet_balance']);
});

test('missing tables are skipped', async () => {
  mockQuery.mockResolvedValue({ rows: [{ t: null }] });
  await expect(guard.findFinancialBlockers('u1')).resolves.toEqual([]);
});

test('live Stripe and credit subscriptions are cancelled immediately', async () => {
  const stripe = { subscriptions: { cancel: jest.fn().mockResolvedValue({}) } };
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 1, stripe_subscription_id: 'sub_1' }, { id: 2, stripe_subscription_id: null }] })
    .mockResolvedValue({ rows: [] });
  await expect(guard.cancelSubscriptionsForDeletion('u1', { stripe })).resolves.toBe(2);
  expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1', expect.any(Object));
  const updates = mockQuery.mock.calls.filter(([s]) => /UPDATE subscriptions/.test(s));
  expect(updates).toHaveLength(2);
});

test('a Stripe failure aborts before local state changes', async () => {
  const stripe = { subscriptions: { cancel: jest.fn().mockRejectedValue(Object.assign(new Error('down'), { code: 'api_error' })) } };
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, stripe_subscription_id: 'sub_1' }] });
  await expect(guard.cancelSubscriptionsForDeletion('u1', { stripe })).rejects.toMatchObject({ code: 'subscription_cancel_failed' });
  expect(mockQuery.mock.calls.some(([s]) => /UPDATE subscriptions/.test(s))).toBe(false);
});

test('a subscription already gone at Stripe is still closed locally', async () => {
  const stripe = { subscriptions: { cancel: jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { code: 'resource_missing' })) } };
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, stripe_subscription_id: 'sub_1' }] }).mockResolvedValue({ rows: [] });
  await expect(guard.cancelSubscriptionsForDeletion('u1', { stripe })).resolves.toBe(1);
});
