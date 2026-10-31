'use strict';

// Audit fix (item 2): the legacy below-threshold direct path must run the
// same four gates as the newer affiliate core before any money moves:
// W-9 tax identity, fresh Didit verification, sanctions screening, and the
// credit-rail kill switch. Above-threshold payouts skip these here because
// the checker executor runs them; the gate test covers that path.

const { mockQuery, resetMocks } = require('./setup');
const AppError = require('../utils/appError');

const mockTransfers = { create: jest.fn() };
jest.mock('stripe', () => () => ({ transfers: mockTransfers }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));
jest.mock('../services/oxsteedCreditService', () => ({ assertCreditRailEnabled: jest.fn().mockResolvedValue(undefined) }));

const sanctions = require('../services/sanctionsScreeningService');
const rail = require('../services/oxsteedCreditService');
const dualApproval = require('../services/dualApprovalService');
const Payout = require('../controllers/PayoutController');

let ownerRow;

function installMocks() {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (/FROM payout_transactions pt/.test(text)) return { rows: [] };
    if (/FROM affiliate_payouts ap\s+JOIN affiliate_programs/.test(text)) {
      return {
        rows: [{
          id: 9,
          status: 'pending',
          helper_id: 'helper-1',
          payout_method_id: 5,
          net_payout_cents: 1400,
          total_commission_cents: 1500,
          processor_fee_cents: 100,
          stripe_account_id: 'acct_1',
          payout_method_status: 'verified',
          connect_payouts_enabled: true,
        }],
      };
    }
    if (/FROM users\s+WHERE id/.test(text)) return { rows: [ownerRow] };
    if (/FROM payout_methods pm\s+JOIN connect_accounts/.test(text)) {
      return {
        rows: [{
          payout_method_status: 'verified',
          stripe_account_id: 'acct_1',
          connect_payouts_enabled: true,
        }],
      };
    }
    if (/SET status = 'processing'/.test(text)) return { rows: [{ id: 9 }] };
    if (/SET status = 'completed'/.test(text)) return { rows: [{ id: 9, status: 'completed' }] };
    return { rows: [] };
  });
}

function goodOwner() {
  return { w9_completed: true, didit_status: 'verified', didit_verified_at: new Date().toISOString() };
}

function run() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return Payout.processPayout({
    user: { id: 'admin' },
    params: { payout_id: 9 },
    get: () => 'synthetic-payout-key',
    body: { payment_processor: 'stripe' },
  }, res).then(() => res);
}

beforeEach(() => {
  resetMocks();
  process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
  mockTransfers.create.mockReset().mockResolvedValue({ id: 'tr_1' });
  // resetMocks only resets the pg mock; the service mocks must be reset
  // explicitly or a rejection set by one test leaks into the next.
  sanctions.assertSanctionsClear.mockReset().mockResolvedValue({ cleared: false });
  rail.assertCreditRailEnabled.mockReset().mockResolvedValue(undefined);
  jest.spyOn(dualApproval, 'requestMoneyMovementApproval').mockResolvedValue({ queued: false });
  ownerRow = goodOwner();
  installMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('below-threshold payout with all four gates passing transfers and completes', async () => {
  const res = await run();
  expect(mockTransfers.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 1400, destination: 'acct_1' }),
    expect.objectContaining({ idempotencyKey: 'affiliate-payout:9' })
  );
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(sanctions.assertSanctionsClear).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ subjectType: 'customer', subjectId: 'helper-1' })
  );
  expect(rail.assertCreditRailEnabled).toHaveBeenCalled();
});

test('missing W-9 blocks the payout before any transfer', async () => {
  ownerRow = { ...goodOwner(), w9_completed: false };
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('unverified Didit blocks the payout before any transfer', async () => {
  ownerRow = { ...goodOwner(), didit_status: 'pending' };
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('stale Didit verification blocks the payout before any transfer', async () => {
  const threeYearsAgo = new Date();
  threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);
  ownerRow = { ...goodOwner(), didit_verified_at: threeYearsAgo.toISOString() };
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('sanctions hit blocks the payout before any transfer', async () => {
  sanctions.assertSanctionsClear.mockRejectedValue(new AppError('blocked pending sanctions review', 403, 'credit_sanctions_match'));
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockTransfers.create).not.toHaveBeenCalled();
});

test('frozen rail blocks the payout before any transfer', async () => {
  rail.assertCreditRailEnabled.mockRejectedValue(new AppError('OxSteed Credit is temporarily suspended', 503, 'credit_rail_suspended'));
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(mockTransfers.create).not.toHaveBeenCalled();
});
