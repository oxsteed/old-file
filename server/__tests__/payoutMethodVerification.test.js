'use strict';
// Restored (Nov 1 audit item 23): these two tests were deleted with
// server/__tests__/payoutMethodVerification.test.js in 419db7da1 when the
// legacy affiliate payout route was consolidated, with no replacement.
// The guards they exercise are intact in PayoutController: owner-supplied
// status is rejected, and a second primary demotes the existing primary
// in the same transaction.
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
const Payout = require('../controllers/PayoutController');
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

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
