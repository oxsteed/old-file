'use strict';

// Audit fix (auth finding 15, issuance track): the maker step-up on both
// affiliate process routes needs an issue path. The generic admin issue
// endpoint gates on ADMIN_STEPUP_ACTION_TYPES (derived from the TOTP-only
// list), which deliberately excludes 'affiliate_payout_process', so the
// dedicated POST /:payoutId/stepup-challenges endpoint on the affiliate
// router issues it with the payout's payable amount.
const { mockQuery, resetMocks } = require('./setup');

const mockIssue = jest.fn();
jest.mock('stripe', () => () => ({}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/sanctionsScreeningService', () => ({ assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: false }) }));
jest.mock('../services/stepupChallengeService', () => ({ issueStepupChallenge: mockIssue }));

const { issueProcessStepupChallenge } = require('../controllers/affiliatePayoutsController');

function routePayout(row) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM affiliate_payouts WHERE id/.test(String(sql))) return { rows: row ? [row] : [] };
    return { rows: [] };
  });
}

function res() {
  const r = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return r;
}

beforeEach(() => {
  resetMocks();
  mockIssue.mockReset();
  mockIssue.mockImplementation(async (args) => ({
    challenge: { id: 'ch_1', actionType: args.actionType, amountCents: args.amountCents, currencyCode: args.currencyCode, expiresAt: new Date().toISOString() },
    delivery: 'email',
  }));
});

test('issues with the payable amount: net wins when present', async () => {
  routePayout({ id: 9, status: 'pending', net_payout_cents: 1200, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: 'admin-1', email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  expect(next).not.toHaveBeenCalled();
  expect(mockIssue).toHaveBeenCalledWith({
    actorUserId: 'admin-1',
    actorEmail: 'admin@oxsteed.com',
    actionType: 'affiliate_payout_process',
    amountCents: 1200,
    currencyCode: 'USD',
  });
  expect(r.status).toHaveBeenCalledWith(201);
  expect(r.json).toHaveBeenCalledWith({
    challenge: expect.objectContaining({ id: 'ch_1', actionType: 'affiliate_payout_process', amountCents: 1200, currencyCode: 'USD' }),
    delivery: 'email',
  });
});

test('issues with gross minus fee when no net is stored', async () => {
  routePayout({ id: 9, status: 'pending', net_payout_cents: null, total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: 'admin-1', email: 'admin@oxsteed.com' }, params: { payoutId: 9 } }, r, next);
  expect(next).not.toHaveBeenCalled();
  expect(mockIssue.mock.calls[0][0].amountCents).toBe(1400);
});

test('missing payout 404s and never issues', async () => {
  routePayout(null);
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: { id: 'admin-1', email: 'admin@oxsteed.com' }, params: { payoutId: 999 } }, r, next);
  expect(mockIssue).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalled();
  expect(next.mock.calls[0][0].statusCode).toBe(404);
  expect(next.mock.calls[0][0].code).toBe('payout_not_found');
});

test('no admin user 401s and never issues', async () => {
  routePayout({ id: 9, status: 'pending', total_commission_cents: 1500, processor_fee_cents: 100 });
  const r = res();
  const next = jest.fn();
  await issueProcessStepupChallenge({ user: null, params: { payoutId: 9 } }, r, next);
  expect(mockIssue).not.toHaveBeenCalled();
  expect(next.mock.calls[0][0].statusCode).toBe(401);
  expect(next.mock.calls[0][0].code).toBe('no_auth');
});

test('the issue route carries the same guards as the process route', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/affiliatePayouts.js'), 'utf8');
  expect(src).toMatch(/'\/:payoutId\/stepup-challenges',\s*requireAdmin,\s*rejectImpersonated,\s*requirePermission\('view_financials'\),\s*strictLimiter,\s*affiliatePayoutsController\.issueProcessStepupChallenge/);
});
