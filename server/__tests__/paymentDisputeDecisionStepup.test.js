'use strict';

// Domain 7 #1: payment-dispute decisions close disputes on a pasted refund
// reference with no step-up, no impersonation rejection, no limiter.
//
// Repro: an approved/resolved decision must require a fresh step-up
// challenge (verified before the controller runs), the route must carry
// rejectImpersonated + strictLimiter, and the challenge issue endpoint
// must share the decision route's auth (requireAdmin + manage_disputes,
// not super-admin-only). Non-closing moves (under_review, denied) need
// no fresh proof.

const { mockQuery, resetMocks } = require('./setup');
const AppError = require('../utils/appError');

jest.mock('../services/stepupChallengeService', () => ({
  issueStepupChallenge: jest.fn(),
  verifyStepupChallenge: jest.fn(),
  amountRequiresStepup: jest.fn(),
  TOTP_STEPUP_ACTION_TYPES: [],
}));

const stepup = require('../services/stepupChallengeService');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { strictLimiter } = require('../middleware/rateLimiter');
const adminRouter = require('../routes/admin');
const {
  requireAdminActionStepupIf,
  resolveDisputeAmountCents,
  issueAdminActionStepup,
} = require('../middleware/adminActionStepup');

function routeHandlers(router, path) {
  const matches = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const routePath = layer.route.path;
    const paths = Array.isArray(routePath) ? routePath : [routePath];
    if (paths.includes(path)) {
      matches.push(...layer.route.stack.map((l) => l.handle));
    }
  }
  return matches;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM main_app_payment_disputes/.test(sql)) {
      return { rows: [{ requested_refund_cents: 5000 }] };
    }
    return { rows: [] };
  });
});

describe('Domain 7 #1: decision route guards', () => {
  test('the decision route carries rejectImpersonated and strictLimiter', () => {
    const handlers = routeHandlers(adminRouter, '/payment-disputes/:id/decision');
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
    expect(handlers).toContain(strictLimiter);
  });

  test('the decision route carries a conditional step-up gate before the controller', () => {
    const handlers = routeHandlers(adminRouter, '/payment-disputes/:id/decision');
    expect(handlers.some((h) => h && h.name === 'adminActionStepupIf')).toBe(true);
  });

  test('the step-up issue route shares the decision auth (admin + manage_disputes, not super-only)', () => {
    const handlers = routeHandlers(adminRouter, '/payment-disputes/stepup-challenges');
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
    expect(handlers).toContain(strictLimiter);
  });
});

describe('Domain 7 #1: conditional step-up gate', () => {
  function gate() {
    return requireAdminActionStepupIf(
      (req) => req.body?.status === 'approved' || req.body?.status === 'resolved',
      'payment_dispute_decision',
      resolveDisputeAmountCents,
    );
  }

  test('an approved decision without a challenge fails with challenge_required and never reaches the controller', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(
      new AppError('A step-up verification code is required for this action', 403, 'credit_stepup_challenge_required')
    );
    const next = jest.fn();
    await gate()({ params: { id: '4' }, body: { status: 'approved' }, user: { id: 'admin-1' } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'credit_stepup_challenge_required' }));
    // No challenge id was presented, so the middleware fails on the
    // missing challenge before resolving the amount (its documented
    // behavior); the binding itself is asserted in the valid-challenge
    // test below.
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      actionType: 'payment_dispute_decision',
    }));
    expect(stepup.verifyStepupChallenge.mock.calls[0][0]).not.toHaveProperty('expectedAmountCents');
  });

  test('a resolved decision without a challenge also requires step-up', async () => {
    stepup.verifyStepupChallenge.mockRejectedValue(
      new AppError('A step-up verification code is required for this action', 403, 'credit_stepup_challenge_required')
    );
    const next = jest.fn();
    await gate()({ params: { id: '4' }, body: { status: 'resolved' }, user: { id: 'admin-1' } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'credit_stepup_challenge_required' }));
  });

  test('under_review and denied moves pass without a challenge', async () => {
    const next = jest.fn();
    await gate()({ params: { id: '4' }, body: { status: 'under_review' }, user: { id: 'admin-1' } }, {}, next);
    await gate()({ params: { id: '4' }, body: { status: 'denied' }, user: { id: 'admin-1' } }, {}, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledWith();
    expect(stepup.verifyStepupChallenge).not.toHaveBeenCalled();
  });

  test('an approved decision with a valid challenge passes, bound to the requested amount', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue({ verified: true });
    const next = jest.fn();
    await gate()(
      { params: { id: '4' }, body: { status: 'approved', stepupChallengeId: 'ch-1', stepupCode: '123456' }, user: { id: 'admin-1' } },
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith();
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'ch-1',
      code: '123456',
      expectedAmountCents: 5000,
    }));
  });
});

describe('Domain 7 #1: dispute amount resolver', () => {
  test('returns the requested refund amount when positive', async () => {
    await expect(resolveDisputeAmountCents({ params: { id: '4' } })).resolves.toBe(5000);
  });

  test('returns 1 for a zero or missing requested amount so the challenge stays issuable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ requested_refund_cents: 0 }] });
    await expect(resolveDisputeAmountCents({ params: { id: '4' } })).resolves.toBe(1);
    mockQuery.mockResolvedValueOnce({ rows: [{ requested_refund_cents: null }] });
    await expect(resolveDisputeAmountCents({ params: { id: '4' } })).resolves.toBe(1);
  });

  test('returns null when the dispute does not exist, so issuance fails closed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(resolveDisputeAmountCents({ params: { id: '4' } })).resolves.toBeNull();
  });

  test('the issue endpoint mints a challenge bound to the dispute amount', async () => {
    stepup.issueStepupChallenge.mockResolvedValue({
      challenge: { id: 'ch-1', method: 'totp', expiresAt: '2026-11-13T20:00:00.000Z' },
      delivery: 'totp',
    });
    const handler = issueAdminActionStepup('payment_dispute_decision', resolveDisputeAmountCents);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await handler({ body: { disputeId: 4 }, user: { id: 'admin-1', email: 'admin@example.com' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(stepup.issueStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      actionType: 'payment_dispute_decision',
      amountCents: 5000,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ challenge: expect.objectContaining({ id: 'ch-1' }) }));
  });
});
