'use strict';

// Money-flows audit item 44: commission math must be exact integer-cent
// math, not float math. The old formula
// Math.round(sale_amount * (commission_rate / 100)) mis-rounds real
// cases: 5000 cents at 99.99% is exactly 4999.5 (half-up 5000), but
// float64 computes 4999.499999999999 and rounds down to 4999.
const { commissionCentsForSale, runAffiliateCommissionBatch } = require('../jobs/affiliateCommissionBatch');

// Affiliate auto-confirm must never confirm a commission whose order was
// refunded after the commission was created (Oct 29 money-flows item 4,
// repeated in the Oct 30 background-jobs audit). These tests pin the
// confirm-time guard in the executed UPDATE.
const { mockQuery, resetMocks } = require('./setup');

describe('commissionCentsForSale (item 44)', () => {
  test('float trap: 5000 cents at 99.99% rounds half-up to 5000, not 4999', () => {
    expect(Math.round(5000 * (99.99 / 100))).toBe(4999);
    expect(commissionCentsForSale(5000, 99.99)).toBe(5000);
  });

  test('ordinary cases agree with the old formula', () => {
    expect(commissionCentsForSale(1005, 10)).toBe(101);
    expect(commissionCentsForSale(10000, 7.5)).toBe(750);
    expect(commissionCentsForSale(999, 33.33)).toBe(333);
  });

  test('accepts pg string inputs (BIGINT sale cents, NUMERIC rate)', () => {
    expect(commissionCentsForSale('5000', '99.99')).toBe(5000);
    expect(commissionCentsForSale('10000', '7.50')).toBe(750);
  });

  test('boundary rates', () => {
    expect(commissionCentsForSale(12345, 0)).toBe(0);
    expect(commissionCentsForSale(12345, 100)).toBe(12345);
  });

  test('fails closed on inputs the DECIMAL(5,2) column cannot produce', () => {
    expect(() => commissionCentsForSale(1000, 7.555)).toThrow();
    expect(() => commissionCentsForSale('10.5', 10)).toThrow();
    expect(() => commissionCentsForSale(-5, 10)).toThrow();
    expect(() => commissionCentsForSale(1000, -1)).toThrow();
    expect(() => commissionCentsForSale(1000, 'abc')).toThrow();
  });
});

describe('affiliate auto-confirm refund guard', () => {
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
});

describe('affiliate auto-confirm chargeback guard (Oct 30 item 4)', () => {
  beforeEach(() => {
    resetMocks();
  });

  async function runBatchAndGetUpdate() {
    await runAffiliateCommissionBatch();
    const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE affiliate_commissions'));
    expect(update).toBeTruthy();
    return String(update[0]);
  }

  test('auto-confirm skips orders with an open or lost chargeback', async () => {
    const sql = await runBatchAndGetUpdate();
    expect(sql).toMatch(/JOIN stripe_chargebacks/);
    expect(sql).toMatch(/sc\.stripe_payment_intent_id = mt\.payment_intent_id/);
    expect(sql).toMatch(/'needs_response'/);
    expect(sql).toMatch(/'under_review'/);
    expect(sql).toMatch(/'lost'/);
    expect(sql).toMatch(/'charge_refunded'/);
  });

  test('a won dispute does not block auto-confirm', async () => {
    const sql = await runBatchAndGetUpdate();
    // The blocking list names only money-back states; 'won' keeps the
    // money, so it must not appear as a blocking status.
    expect(sql).not.toMatch(/'won'/);
  });
});

describe('affiliate batch failure visibility (Oct 30 item 8)', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('a failed batch records a deduped incident and rethrows instead of logging only', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(runAffiliateCommissionBatch()).rejects.toThrow('db down');
    const incident = mockQuery.mock.calls.find(
      ([sql, params]) => String(sql).includes('INSERT INTO incident_log')
        && Array.isArray(params) && params.includes('affiliate-commission-batch-failed')
    );
    expect(incident).toBeTruthy();
    expect(incident[1][0]).toBe('affiliate_commission_batch_failed');
    expect(incident[1][1]).toBe('high');
  });
});

describe('affiliate null-rate skip (Oct 30 item 17)', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('a program with a NULL rate records a deduped incident and skips the row instead of throwing nightly', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM marketplace_order_items')) {
        return { rows: [{
          order_id: 'ord-1', item_id: 'it-1', sale_amount: '10000', sale_currency: 'USD',
          helper_user_id: 'helper-1', affiliate_program_id: 'prog-1', commission_rate: null,
        }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await runAffiliateCommissionBatch();
    const commissionInsert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO affiliate_commissions'));
    expect(commissionInsert).toBeFalsy();
    const incident = mockQuery.mock.calls.find(
      ([sql, params]) => String(sql).includes('INSERT INTO incident_log')
        && Array.isArray(params) && params.includes('affiliate-program-null-rate:prog-1')
    );
    expect(incident).toBeTruthy();
    expect(incident[1][0]).toBe('affiliate_program_missing_commission_rate');
  });
});
