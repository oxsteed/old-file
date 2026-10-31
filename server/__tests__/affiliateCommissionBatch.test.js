'use strict';

// Affiliate auto-confirm must never confirm a commission whose order was
// refunded after the commission was created (Oct 29 money-flows item 4,
// repeated in the Oct 30 background-jobs audit). These tests pin the
// confirm-time guard in the executed UPDATE.

const { mockQuery, resetMocks } = require('./setup');

const { runAffiliateCommissionBatch } = require('../jobs/affiliateCommissionBatch');

beforeEach(() => {
  resetMocks();
});

async function runBatchAndGetUpdate() {
  await runAffiliateCommissionBatch();
  const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE affiliate_commissions'));
  expect(update).toBeTruthy();
  return String(update[0]);
}

test('auto-confirm skips refunded and cancelled orders', async () => {
  const sql = await runBatchAndGetUpdate();
  expect(sql).toMatch(/FROM marketplace_orders/);
  expect(sql).toMatch(/mo\.status IN \('refunded', 'cancelled'\)/);
});

test('auto-confirm skips orders with a succeeded refund row', async () => {
  const sql = await runBatchAndGetUpdate();
  expect(sql).toMatch(/FROM marketplace_transaction_refunds/);
  expect(sql).toMatch(/mtr\.status = 'succeeded'/);
});

test('auto-confirm still requires pending status and the 30-day age', async () => {
  const sql = await runBatchAndGetUpdate();
  expect(sql).toMatch(/status = 'pending'/);
  expect(sql).toMatch(/INTERVAL '30 days'/);
});

test('creation still only picks paid, completed orders', async () => {
  await runAffiliateCommissionBatch();
  const select = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM marketplace_order_items'));
  expect(select).toBeTruthy();
  expect(String(select[0])).toMatch(/mo\.status = 'paid'/);
  expect(String(select[0])).toMatch(/mo\.completed_at IS NOT NULL/);
});
