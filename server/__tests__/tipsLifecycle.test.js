'use strict';

require('./setup');

const { mockQuery, resetMocks } = require('./setup');
const tips = require('../services/paymentRails/tips');
const railPolicy = require('../services/paymentRailPolicy');
const stripeMock = require('stripe').__mockInstance;

beforeEach(() => {
  resetMocks();
  stripeMock.paymentIntents.create.mockReset();
  railPolicy.clearPolicyCache();
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

test('marks a tip failed when Stripe initiation fails so the idempotency key can retry', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'job-2',
      client_id: 'customer-1',
      assigned_helper_id: 'helper-1',
      status: 'completed',
      payment_rail: 'stripe',
      job_value_cents: 10000,
      location_country_code: 'US',
    }] })
    .mockResolvedValueOnce({ rows: [] }) // idempotency replay lookup
    .mockResolvedValueOnce({ rows: [{ stripe_account_id: 'acct-helper-1' }] })
    .mockResolvedValueOnce({ rows: [] }) // country policy
    .mockResolvedValueOnce({ rows: [{
      id: 'tip-2', rail: 'stripe', status: 'pending', currency: 'USD',
      processing_cost_minor: 45, helper_net_minor: 455,
    }] }) // INSERT
    .mockResolvedValueOnce({ rows: [] }); // mark failed
  stripeMock.paymentIntents.create.mockRejectedValueOnce(new Error('stripe unavailable'));

  await expect(tips.createTip({
    jobId: 'job-2',
    user: { id: 'customer-1' },
    amountMinor: 500,
    idempotencyKey: 'tip-key-2',
  })).rejects.toThrow('stripe unavailable');

  const failed = mockQuery.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
  expect(failed).toBeTruthy();
  expect(failed[1]).toEqual(['tip-2']);
});
