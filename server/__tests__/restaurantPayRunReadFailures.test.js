'use strict';

const payrollController = require('../controllers/restaurantPayrollController');

function fakeRun() {
  return {
    id: 7,
    restaurant_id: 3,
    currency_code: 'USD',
    totals: { total_pay_cents: 1000 },
    finalized_at: null,
  };
}

test('surfaces payout-link database failures instead of reporting zero links', async () => {
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [fakeRun()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('database unavailable')),
  };

  await expect(payrollController._getPayRunWithLines(client, 3, 7))
    .rejects.toThrow('database unavailable');
});

test('keeps the legacy missing-table fallback for additive payout data', async () => {
  const missingTable = Object.assign(new Error('relation does not exist'), { code: '42P01' });
  const client = {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [fakeRun()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(missingTable)
      .mockRejectedValueOnce(missingTable),
  };

  const run = await payrollController._getPayRunWithLines(client, 3, 7);
  expect(run.payout_links).toEqual([]);
  expect(run.disbursements).toEqual([]);
  expect(run.disbursement_coverage.fully_covered).toBe(false);
});
