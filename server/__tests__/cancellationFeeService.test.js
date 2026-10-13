'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { collectCancellationFee } = require('../services/cancellationFeeService');

const HELPER_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(resetMocks);

test('blocks helper transfer when identity or payouts are not currently eligible', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      didit_status: 'verified',
      didit_verified_at: '2020-01-01T00:00:00.000Z',
      didit_enforcement_required: true,
      stripe_account_id: 'acct_helper',
      payouts_enabled: true,
    }] })
    .mockResolvedValueOnce({ rows: [] });

  await collectCancellationFee({
    feeRecordId: 42,
    customerId: '22222222-2222-4222-8222-222222222222',
    helperId: HELPER_ID,
    feeTotalCents: 1000,
    feeToHelper: 500,
  });

  const updates = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE cancellation_fees'));
  expect(updates).toHaveLength(1);
  expect(updates[0][1]).toEqual(['helper_payout_eligibility_required', 42]);
});
