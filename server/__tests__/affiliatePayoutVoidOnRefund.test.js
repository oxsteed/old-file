'use strict';

// Decision Q3 (2026-10-31): a refund landing between payout calculation
// and transfer voids the claimed commission and adjusts the payout total.
// The payout row stays the source of truth; a transferred payout is
// never adjusted.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('stripe', () => () => ({ transfers: { create: jest.fn() } }));

const { voidClaimedCommissionsForRefund } = require('../services/affiliatePayoutVoidOnRefund');
const { settleRefund } = require('../services/marketplaceRefundService');

// Fake transaction client: routes SQL to scripted results, logs every call.
function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      for (const [re, value] of routes) {
        if (re.test(text)) return typeof value === 'function' ? value(params) : value;
      }
      return { rows: [] };
    },
  };
}

const LOCK_SELECT = /FROM affiliate_payouts ap\s+JOIN affiliate_commissions/;
const VOID_UPDATE = /UPDATE affiliate_commissions ac\s+SET status = 'void'/;
const PAYOUT_UPDATE = /UPDATE affiliate_payouts\s+SET total_commission_cents/;
const PROGRAM_UPDATE = /UPDATE affiliate_programs\s+SET pending_cents/;

describe('voidClaimedCommissionsForRefund', () => {
  test('post-calculation refund voids the claimed commission and adjusts payout + program totals', async () => {
    const client = fakeClient([
      [LOCK_SELECT, { rows: [{ payout_id: 9 }] }],
      [VOID_UPDATE, { rows: [{ id: 4, commission_cents: '500', payout_id: 9, affiliate_program_id: 3 }] }],
      [PAYOUT_UPDATE, { rows: [] }],
      [PROGRAM_UPDATE, { rows: [] }],
    ]);
    const summary = await voidClaimedCommissionsForRefund(client, 77);
    expect(summary).toEqual({
      voidedCount: 1,
      voidedCents: '500',
      payouts: [{ payoutId: 9, voidedCents: '500', voidedCount: 1 }],
    });
    const payoutUpdate = client.calls.find((c) => PAYOUT_UPDATE.test(c.text));
    expect(payoutUpdate.params).toEqual([9, '500', 1]);
    expect(payoutUpdate.text).toMatch(/status = 'pending'/);
    const programUpdate = client.calls.find((c) => PROGRAM_UPDATE.test(c.text));
    expect(programUpdate.params).toEqual([3, '500']);
  });

  test('sums multiple commissions on one payout into a single adjustment', async () => {
    const client = fakeClient([
      [LOCK_SELECT, { rows: [{ payout_id: 9 }] }],
      [VOID_UPDATE, { rows: [
        { id: 4, commission_cents: '500', payout_id: 9, affiliate_program_id: 3 },
        { id: 5, commission_cents: '250', payout_id: 9, affiliate_program_id: 3 },
      ] }],
      [PAYOUT_UPDATE, { rows: [] }],
      [PROGRAM_UPDATE, { rows: [] }],
    ]);
    const summary = await voidClaimedCommissionsForRefund(client, 77);
    expect(summary.voidedCount).toBe(2);
    expect(summary.voidedCents).toBe('750');
    const payoutUpdates = client.calls.filter((c) => PAYOUT_UPDATE.test(c.text));
    expect(payoutUpdates).toHaveLength(1);
    expect(payoutUpdates[0].params).toEqual([9, '750', 2]);
  });

  test('processing payout is untouched: transfer in flight owns that window', async () => {
    const client = fakeClient([[LOCK_SELECT, { rows: [] }]]);
    const summary = await voidClaimedCommissionsForRefund(client, 77);
    expect(summary).toEqual({ voidedCount: 0, voidedCents: 0, payouts: [] });
    expect(client.calls.filter((c) => VOID_UPDATE.test(c.text))).toHaveLength(0);
    expect(client.calls.filter((c) => PAYOUT_UPDATE.test(c.text))).toHaveLength(0);
  });

  test('unclaimed commissions are untouched: item-42 exclusion owns the pre-calculation path', async () => {
    const client = fakeClient([[LOCK_SELECT, { rows: [] }]]);
    const summary = await voidClaimedCommissionsForRefund(client, 77);
    expect(summary.voidedCount).toBe(0);
    expect(client.calls.filter((c) => VOID_UPDATE.test(c.text))).toHaveLength(0);
  });

  test('void is idempotent: a second run finds no confirmed rows', async () => {
    const client = fakeClient([
      [LOCK_SELECT, { rows: [] }],
      [VOID_UPDATE, { rows: [] }],
    ]);
    const summary = await voidClaimedCommissionsForRefund(client, 77);
    expect(summary).toEqual({ voidedCount: 0, voidedCents: 0, payouts: [] });
    expect(client.calls.filter((c) => PAYOUT_UPDATE.test(c.text))).toHaveLength(0);
    expect(client.calls.filter((c) => PROGRAM_UPDATE.test(c.text))).toHaveLength(0);
  });

  test('a payout emptied by the void is failed, never left pending at zero', async () => {
    const client = fakeClient([
      [LOCK_SELECT, { rows: [{ payout_id: 9 }] }],
      [VOID_UPDATE, { rows: [{ id: 4, commission_cents: '500', payout_id: 9, affiliate_program_id: 3 }] }],
      [PAYOUT_UPDATE, { rows: [] }],
      [PROGRAM_UPDATE, { rows: [] }],
    ]);
    await voidClaimedCommissionsForRefund(client, 77);
    const payoutUpdate = client.calls.find((c) => PAYOUT_UPDATE.test(c.text));
    expect(payoutUpdate.text).toMatch(/THEN 'failed' ELSE status END/);
    expect(payoutUpdate.text).toMatch(/all_commissions_voided_by_refund/);
  });
});

describe('settleRefund hook', () => {
  function route(handlers) {
    mockQuery.mockImplementation(async (sql, params) => {
      const text = String(sql);
      for (const [re, value] of handlers) {
        if (re.test(text)) return typeof value === 'function' ? value(params) : value;
      }
      return { rows: [] };
    });
  }

  beforeEach(() => { resetMocks(); });

  function baseReservation() {
    return {
      refund: { id: 11, transaction_id: 21, amount_cents: 10000, reason: 'buyer request', actor_user_id: 5 },
      transaction: { id: 21, payment_intent_id: 'pi_1', currency: 'USD', amount_cents: 10000 },
      order: { id: 77 },
    };
  }

  function settleRoutes({ voidedCommission, refundAmountCents = 10000 } = {}) {
    return [
      [/SELECT \* FROM marketplace_transaction_refunds WHERE id/, { rows: [{ id: 11, transaction_id: 21, status: 'pending', amount_cents: refundAmountCents }] }],
      [/SELECT \* FROM marketplace_transactions WHERE id/, { rows: [{ id: 21, refunded_amount_cents: 0, amount_cents: 10000, status: 'succeeded' }] }],
      [/UPDATE marketplace_transaction_refunds/, { rows: [{ id: 11, status: 'succeeded' }] }],
      [/UPDATE marketplace_transactions/, { rows: [{ id: 21 }] }],
      [/UPDATE marketplace_orders/, { rows: [{ id: 77, status: 'refunded' }] }],
      [LOCK_SELECT, voidedCommission ? { rows: [{ payout_id: 9 }] } : { rows: [] }],
      [VOID_UPDATE, voidedCommission ? { rows: [{ id: 4, commission_cents: '500', payout_id: 9, affiliate_program_id: 3 }] } : { rows: [] }],
      [PAYOUT_UPDATE, { rows: [] }],
      [PROGRAM_UPDATE, { rows: [] }],
    ];
  }

  const providerRefund = { id: 're_1', amount: 10000, currency: 'usd', payment_intent: 'pi_1', status: 'succeeded' };

  test('full refund voids the claimed commission and adjusts the payout total', async () => {
    route(settleRoutes({ voidedCommission: true }));
    const result = await settleRefund(baseReservation(), providerRefund);
    expect(result.order.status).toBe('refunded');
    expect(result.replay).toBe(false);
    const calls = mockQuery.mock.calls.map(([s]) => String(s));
    expect(calls.some((s) => VOID_UPDATE.test(s))).toBe(true);
    expect(calls.some((s) => PAYOUT_UPDATE.test(s))).toBe(true);
    expect(calls.some((s) => PROGRAM_UPDATE.test(s))).toBe(true);
  });

  test('partial refund never voids: pro-rate owns that path, not void-in-full', async () => {
    route(settleRoutes({ voidedCommission: false, refundAmountCents: 4000 }));
    const partial = baseReservation();
    partial.refund.amount_cents = 4000;
    const partialProvider = { ...providerRefund, amount: 4000 };
    const result = await settleRefund(partial, partialProvider);
    expect(result.replay).toBe(false);
    const calls = mockQuery.mock.calls.map(([s]) => String(s));
    expect(calls.some((s) => VOID_UPDATE.test(s))).toBe(false);
    expect(calls.some((s) => PAYOUT_UPDATE.test(s))).toBe(false);
  });
});
