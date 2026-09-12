'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { reconcileCreditLedger } = require('../services/oxsteedCreditAdminService');

beforeEach(resetMocks);

test('reconciliation uses the same posted-transaction currency invariant as verification', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      account_balance_cents: '1000',
      journal_balance_cents: '1000',
      difference_cents: '0',
      account_count: 1,
      entry_count: 2,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'run-1',
      currency_code: 'USD',
      period_start: '2026-09-11T00:00:00.000Z',
      period_end: '2026-09-12T00:00:00.000Z',
      status: 'balanced',
      account_balance_cents: '1000',
      journal_balance_cents: '1000',
      difference_cents: '0',
      account_count: 1,
      entry_count: 2,
      completed_at: '2026-09-12T02:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await reconcileCreditLedger({
    currencyCode: 'USD',
    periodStart: '2026-09-11T00:00:00.000Z',
    periodEnd: '2026-09-12T00:00:00.000Z',
    actorUserId: null,
  });

  expect(result.run.status).toBe('balanced');
  expect(mockQuery.mock.calls[0][0]).toContain('JOIN oxsteed_credit_transactions');
  expect(mockQuery.mock.calls[0][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[0][0]).toContain("t.currency_code = $1");
  expect(mockQuery.mock.calls[0][1]).toEqual(['USD']);
});
