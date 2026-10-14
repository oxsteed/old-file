'use strict';

const stripe = require('stripe');
const stripeMock = stripe.__mockInstance;
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/sanctionsScreeningService', () => ({
  assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: true }),
}));

const { collectCancellationFee } = require('../services/cancellationFeeService');

const HELPER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  resetMocks();
  stripeMock.customers.listPaymentMethods = jest.fn().mockResolvedValue({ data: [{ id: 'pm_1' }] });
  stripeMock.paymentIntents.create = jest.fn().mockResolvedValue({ id: 'pi_1', latest_charge: 'ch_1' });
  stripeMock.transfers = { create: jest.fn().mockResolvedValue({ id: 'tr_1' }) };
});

// Routes pool.query calls by SQL so the full charge+transfer flow can run
// without a database.
function mockFeeCollectionQueries() {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('LEFT JOIN connect_accounts')) {
      return { rows: [{
        w9_completed: true,
        didit_status: 'verified',
        didit_verified_at: new Date().toISOString(),
        didit_enforcement_required: true,
        stripe_account_id: 'acct_helper',
        payouts_enabled: true,
      }] };
    }
    if (text.includes('stripe_customer_id')) {
      return { rows: [{ stripe_customer_id: 'cus_1' }] };
    }
    if (text.includes('FROM connect_accounts WHERE user_id')) {
      return { rows: [{ stripe_account_id: 'acct_helper' }] };
    }
    return { rows: [] };
  });
}

function feeUpdateCall() {
  const updates = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE cancellation_fees'));
  expect(updates).toHaveLength(1);
  return updates[0];
}

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
    customerId: CUSTOMER_ID,
    helperId: HELPER_ID,
    feeTotalCents: 1000,
    feeToHelper: 500,
  });

  const updates = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE cancellation_fees'));
  expect(updates).toHaveLength(1);
  expect(updates[0][1]).toEqual(['helper_payout_eligibility_required', 42]);
});

// P3-10-F14: a failed helper transfer after a successful charge must not
// settle the row. It stays 'transfer_pending' (not 'collected') with the
// charge recorded and the transfer failure reason, so finance can retry.
test('marks transfer_pending when the helper transfer fails after a successful charge', async () => {
  mockFeeCollectionQueries();
  stripeMock.transfers.create.mockRejectedValue(new Error('No such destination'));

  await collectCancellationFee({
    feeRecordId: 43,
    customerId: CUSTOMER_ID,
    helperId: HELPER_ID,
    feeTotalCents: 1000,
    feeToHelper: 500,
  });

  const [, params] = feeUpdateCall();
  expect(params[0]).toBe('ch_1');      // stripe_charge_id recorded
  expect(params[1]).toBeNull();        // no stripe_transfer_id
  expect(params[2]).toBe(43);         // feeRecordId
  expect(params[3]).toBe('transfer_pending');
  expect(String(params[4])).toContain('No such destination');
});

test('marks collected when the helper transfer succeeds', async () => {
  mockFeeCollectionQueries();

  await collectCancellationFee({
    feeRecordId: 44,
    customerId: CUSTOMER_ID,
    helperId: HELPER_ID,
    feeTotalCents: 1000,
    feeToHelper: 500,
  });

  const [, params] = feeUpdateCall();
  expect(params[0]).toBe('ch_1');
  expect(params[1]).toBe('tr_1');
  expect(params[2]).toBe(44);
  expect(params[3]).toBe('collected');
  expect(params[4]).toBeNull();
});
