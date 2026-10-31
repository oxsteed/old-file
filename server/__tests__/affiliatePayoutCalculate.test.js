'use strict';

// Money-flows audit item 42: period payout calculation must not claim
// commissions on fully refunded orders. The SUM and the UPDATE that flips
// rows to confirmed must share the refund exclusion exactly; if they
// disagree, refunded commissions are either paid or stranded.
const { mockQuery, resetMocks } = require('./setup');

jest.mock('stripe', () => () => ({ transfers: { create: jest.fn() } }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));

const { calculateAndCreatePayout } = require('../controllers/affiliatePayoutsController');

function route(handlers) {
  mockQuery.mockImplementation(async (sql, params) => {
    const t = String(sql);
    for (const [re, v] of handlers) if (re.test(t)) return typeof v === 'function' ? v(params) : v;
    return { rows: [] };
  });
}

beforeEach(() => { resetMocks(); });

test('calculate excludes fully refunded orders from both the total and the claim', async () => {
  route([
    [/FROM affiliate_programs WHERE id/, { rows: [{ id: 3, helper_id: 'owner' }] }],
    [/FROM affiliate_payouts WHERE idempotency_key/, { rows: [] }],
    [/SUM\(\s*CASE/, { rows: [{ total_cents: 1500, count: 2 }] }],
    [/INSERT INTO affiliate_payouts/, { rows: [{ id: 9, affiliate_program_id: 3, total_commission_cents: 1500 }] }],
  ]);
  const res = { json: jest.fn() };
  const next = jest.fn();
  await calculateAndCreatePayout(
    { user: { id: 'owner' }, body: { programId: 3, periodStart: '2026-10-01', periodEnd: '2026-11-01' } },
    res,
    next
  );
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

  const sumSql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /SUM\(\s*CASE/.test(s));
  const claimSql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /UPDATE affiliate_commissions\s+SET payout_id/.test(s));
  expect(sumSql).toBeDefined();
  expect(claimSql).toBeDefined();
  for (const sql of [sumSql, claimSql]) {
    expect(sql).toMatch(/FROM marketplace_orders mo/);
    expect(sql).toMatch(/mo\.id = affiliate_commissions\.order_id AND mo\.status = 'refunded'/);
  }
});

test('calculate pro-rates partially refunded orders on the kept share only', async () => {
  route([
    [/FROM affiliate_programs WHERE id/, { rows: [{ id: 3, helper_id: 'owner' }] }],
    [/FROM affiliate_payouts WHERE idempotency_key/, { rows: [] }],
    [/SUM\(\s*CASE/, { rows: [{ total_cents: 1600, count: 2 }] }],
    [/INSERT INTO affiliate_payouts/, { rows: [{ id: 9, affiliate_program_id: 3, total_commission_cents: 1600 }] }],
  ]);
  const res = { json: jest.fn() };
  const next = jest.fn();
  await calculateAndCreatePayout(
    { user: { id: 'owner' }, body: { programId: 3, periodStart: '2026-10-01', periodEnd: '2026-11-01' } },
    res,
    next
  );
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

  const sumSql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /SUM\(\s*CASE/.test(s));
  const claimSql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /UPDATE affiliate_commissions\s+SET payout_id/.test(s));
  expect(sumSql).toBeDefined();
  expect(claimSql).toBeDefined();
  // Pro-rate expression: kept base = sale minus succeeded refunds, same
  // half-up shape as the batch math (rate_bps + 5000) / 10000.
  expect(sumSql).toMatch(/FROM marketplace_transaction_refunds r/);
  expect(sumSql).toMatch(/r\.status = 'succeeded'/);
  expect(sumSql).toMatch(/GREATEST\(/);
  expect(sumSql).toMatch(/product_sale_amount_cents/);
  expect(sumSql).toMatch(/commission_rate \* 100/);
  expect(sumSql).toMatch(/\+ 5000\s*\) \/ 10000/);
  // Rows with no succeeded refund still contribute stored commission_cents.
  expect(sumSql).toMatch(/ELSE affiliate_commissions\.commission_cents/);
  // Uncomputable rows (refunds exist but rate or sale unknown) stay
  // unclaimed in both queries, never guessed.
  for (const sql of [sumSql, claimSql]) {
    expect(sql).toMatch(/marketplace_transaction_refunds r/);
    expect(sql).toMatch(/commission_rate IS NULL/);
    expect(sql).toMatch(/product_sale_amount_cents IS NULL/);
  }
  // The claim flips rows only; it never rewrites stored amounts.
  expect(claimSql).not.toMatch(/GREATEST\(/);
});
