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
    [/SUM\(commission_cents\)/, { rows: [{ total_cents: 1500, count: 2 }] }],
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

  const sumSql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /SUM\(commission_cents\)/.test(s));
  const claimSql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /UPDATE affiliate_commissions\s+SET payout_id/.test(s));
  expect(sumSql).toBeDefined();
  expect(claimSql).toBeDefined();
  for (const sql of [sumSql, claimSql]) {
    expect(sql).toMatch(/FROM marketplace_orders mo/);
    expect(sql).toMatch(/mo\.id = affiliate_commissions\.order_id AND mo\.status = 'refunded'/);
  }
});
