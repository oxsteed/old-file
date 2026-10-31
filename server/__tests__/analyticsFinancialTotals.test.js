'use strict';

/**
 * Canonical ledger totals (metricsRegistry.ledgerFinancialTotals): the
 * Financial Management totals must be per currency and must distinguish
 * platform take (job_fee + subscription) from gross ledger inflows (every
 * positive row) and net ledger movement (all rows summed). These tests run
 * against a stubbed db (no database needed): they pin the mapping, the
 * currency binding, and the refunds definition (source_type='refund' only,
 * matching platformRevenue — a negative row of another source is not a
 * refund).
 */
const registry = require('../analytics/metricsRegistry');

function stubDb(row) {
  const db = { query: jest.fn().mockResolvedValue({ rows: [row] }) };
  return db;
}

describe('ledgerFinancialTotals', () => {
  test('maps gross, splits, refunds, and net from one currency-scoped row', async () => {
    const db = stubDb({
      gross_cents: '12000',
      job_fee_cents: '5000',
      subscription_cents: '3000',
      refunds_cents: '1500',
      net_cents: '10500',
    });
    const totals = await registry.ledgerFinancialTotals(db, 'usd');
    expect(totals).toEqual({
      currency_code: 'USD',
      gross_cents: 12000,
      job_fee_cents: 5000,
      subscription_cents: 3000,
      refunds_cents: 1500,
      net_cents: 10500,
    });
    // Platform take is the job_fee + subscription split, not gross.
    expect(totals.job_fee_cents + totals.subscription_cents).toBe(8000);
    expect(totals.gross_cents).not.toBe(8000);
  });

  test('binds exactly one currency parameter and filters on it', async () => {
    const db = stubDb({
      gross_cents: '0', job_fee_cents: '0', subscription_cents: '0', refunds_cents: '0', net_cents: '0',
    });
    await registry.ledgerFinancialTotals(db, 'eur');
    const [text, params] = db.query.mock.calls[0];
    expect(params).toEqual(['eur']);
    expect(text).toMatch('UPPER(currency) = UPPER($1)');
    // No second currency can leak in: a single predicate, no OR across currencies.
    expect(text).not.toMatch('OR UPPER');
  });

  test('refunds count only source_type=refund rows (SQL text pins the predicate)', async () => {
    const db = stubDb({
      gross_cents: '0', job_fee_cents: '0', subscription_cents: '0', refunds_cents: '0', net_cents: '0',
    });
    await registry.ledgerFinancialTotals(db, 'USD');
    const [text] = db.query.mock.calls[0];
    expect(text).toMatch("source_type = 'refund'");
    // The old getFinancials counted every negative row as a refund; the
    // canonical definition does not. No bare amount_cents < 0 refund clause.
    expect(text).not.toMatch('amount_cents < 0 THEN ABS');
  });

  test('empty ledger yields zeros, not nulls', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };
    const totals = await registry.ledgerFinancialTotals(db, 'USD');
    expect(totals).toEqual({
      currency_code: 'USD',
      gross_cents: 0,
      job_fee_cents: 0,
      subscription_cents: 0,
      refunds_cents: 0,
      net_cents: 0,
    });
  });

  test('defaults to USD', async () => {
    const db = stubDb({
      gross_cents: '0', job_fee_cents: '0', subscription_cents: '0', refunds_cents: '0', net_cents: '0',
    });
    const totals = await registry.ledgerFinancialTotals(db);
    expect(totals.currency_code).toBe('USD');
    expect(db.query.mock.calls[0][1]).toEqual(['USD']);
  });
});
