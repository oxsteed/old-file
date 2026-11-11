'use strict';

require('./setup');

const { mockQuery, resetMocks } = require('./setup');
const tips = require('../services/paymentRails/tips');

beforeEach(() => {
  resetMocks();
  process.env.FEATURE_JOB_TIPS = 'true';
});

afterEach(() => {
  delete process.env.FEATURE_JOB_TIPS;
});

test('does not persist an unrecoverable pending tip when the helper lacks a Stripe account', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'job-1',
      client_id: 'customer-1',
      assigned_helper_id: 'helper-1',
      status: 'completed',
      payment_rail: 'stripe',
      job_value_cents: 10000,
    }] })
    .mockResolvedValueOnce({ rows: [] }) // idempotency replay lookup
    .mockResolvedValueOnce({ rows: [] }); // missing Connect account

  await expect(tips.createTip({
    jobId: 'job-1',
    user: { id: 'customer-1' },
    amountMinor: 500,
    idempotencyKey: 'tip-key-1',
  })).rejects.toMatchObject({ code: 'helper_account_not_ready' });

  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO job_tips/.test(sql))).toBe(false);
});
