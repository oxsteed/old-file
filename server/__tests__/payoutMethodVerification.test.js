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
    // Audit item 2: the legacy direct path gates on W-9, fresh Didit,
    // sanctions, and the credit rail before any transfer. Serve a
    // compliant fixture through the real gate queries so these tests
    // exercise the readiness/method paths they name.
    if (/SELECT w9_completed, didit_status, didit_verified_at/.test(sql)) return { rows: [{ w9_completed: true,
      didit_status: 'verified', didit_verified_at: new Date().toISOString() }] };
    if (/FROM oxsteed_credit_sanctions_screenings/.test(sql)) return { rows: [{ result: 'clear',
      screened_at: new Date(), cleared_at: null, confirmed_at: null }] };
    if (/FROM feature_flags WHERE key = 'oxsteed_credit_enabled'/.test(sql)) return { rows: [{ is_enabled: true }] };
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

// P2-8-F12: creating a second payout method must not 500 on the
// unique_primary_method_per_helper partial index. The existing primary is
// demoted in the same transaction before the new primary row is inserted.
test('creating a second payout method demotes the existing primary instead of 500ing', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{ pg_advisory_xact_lock: null }] };
    if (/INSERT INTO payout_methods/.test(sql)) return { rows: [{ id: 5, helper_id: 'helper', is_primary: true, status: 'pending' }] };
    return { rows: [], rowCount: 0 };
  });
  const res = response();
  await Payout.createPayoutMethod(
    {
      user: { id: 'helper' },
      body: { method_type: 'bank_account', account_holder_name: 'Ada', bank_name: 'Bank', account_last_four: '1234' },
    },
    res
  );
  const calls = mockQuery.mock.calls.map(([sql]) => sql);
  expect(calls.some((sql) => /^BEGIN/.test(sql))).toBe(true);
  const demote = calls.find((sql) => /UPDATE payout_methods SET is_primary = FALSE/.test(sql));
  expect(demote).toBeTruthy();
  expect(demote).toContain('WHERE helper_id = $1 AND is_primary = TRUE');
  const insertIdx = calls.findIndex((sql) => /INSERT INTO payout_methods/.test(sql));
  const demoteIdx = calls.findIndex((sql) => /UPDATE payout_methods SET is_primary = FALSE/.test(sql));
  expect(demoteIdx).toBeLessThan(insertIdx);
  expect(calls.some((sql) => /^COMMIT/.test(sql))).toBe(true);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});
