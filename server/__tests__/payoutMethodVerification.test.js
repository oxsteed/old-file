'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
const mockTransfers = { create: jest.fn() };
jest.mock('stripe', () => () => ({ transfers: mockTransfers }));
const previousProcessorFlag = process.env.PAYOUT_PROCESSOR_ENABLED;
afterAll(() => { if (previousProcessorFlag === undefined) delete process.env.PAYOUT_PROCESSOR_ENABLED; else process.env.PAYOUT_PROCESSOR_ENABLED = previousProcessorFlag; });
const Payout = require('../controllers/PayoutController');
const stripe = require('stripe')();
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
beforeEach(() => { resetMocks(); jest.clearAllMocks(); process.env.PAYOUT_PROCESSOR_ENABLED = 'true'; });
function route(status, ready) {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT ap\.\*/.test(sql)) return { rows: [{ id: 9, helper_id: 'helper', status: 'pending', payout_method_id: 4,
      stripe_account_id: 'acct_owned', connect_payouts_enabled: ready, payout_method_status: status, net_payout_cents: 1500 }] };
    if (/SELECT pm.status/.test(sql)) return { rows: [{ payout_method_status: status, stripe_account_id: 'acct_owned', connect_payouts_enabled: ready }] };
    if (/SET status = 'processing'/.test(sql)) return { rows: [{ id: 9 }] };
    if (/SET status = 'completed'/.test(sql)) return { rows: [{ id: 9, status: 'completed' }] };
    return { rows: [] };
  });
}
test('pending processor-backed methods are verified before the payout transfer', async () => {
  route('pending', true); stripe.transfers.create.mockResolvedValueOnce({ id: 'tr_verified' });
  const res = response();
  await Payout.processPayout({ user: { id: 'admin' }, params: { payout_id: 9 }, get: () => 'synthetic-payout-9', body: { payment_processor: 'stripe' } }, res);
  expect(res.status).not.toHaveBeenCalledWith(409);
  expect(stripe.transfers.create).toHaveBeenCalledWith(expect.objectContaining({ destination: 'acct_owned', amount: 1500 }), { idempotencyKey: 'affiliate-payout:9' });
  const verify = mockQuery.mock.calls.find(([sql]) => /UPDATE payout_methods/.test(sql));
  expect(verify[1]).toEqual(['acct_owned', 4]);
  const read = mockQuery.mock.calls.find(([sql]) => /SELECT ap\.\*/.test(sql))[0];
  expect(read).toContain('pm.helper_id = aprg.helper_id'); expect(read).toContain('ca.user_id = aprg.helper_id');
});
test.each(['pending', 'verified', 'active'])('disabled Connect capability blocks %s methods before transferring', async (status) => {
  route(status, false); const res = response();
  await Payout.processPayout({ user: { id: 'admin' }, params: { payout_id: 9 }, get: () => 'synthetic-payout-9', body: { payment_processor: 'stripe' } }, res);
  expect(res.status).toHaveBeenCalledWith(409); expect(stripe.transfers.create).not.toHaveBeenCalled();
});
test.each(['inactive', 'rejected'])('processor readiness never restores a %s method', async (status) => {
  route(status, true); const res = response();
  await Payout.processPayout({ user: { id: 'admin' }, params: { payout_id: 9 }, get: () => 'synthetic-payout-9', body: { payment_processor: 'stripe' } }, res);
  expect(res.status).toHaveBeenCalledWith(409); expect(stripe.transfers.create).not.toHaveBeenCalled();
});
test('a user cannot self-verify a payout method', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 4 }] }); const res = response();
  await Payout.updatePayoutMethod({ user: { id: 'helper' }, params: { method_id: 4 }, body: { status: 'verified' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE payout_methods/.test(sql))).toBe(false);
});
