'use strict';

/**
 * Instant payout step-up (auth-audit finding 27).
 *
 * Instant payouts moved up to $500/day on session auth alone. Every
 * instant payout now requires a fresh email-OTP step-up challenge
 * (action type 'instant_payout'); the per-user-day idempotency key bounds
 * this to at most one challenge per day.
 */

const { mockQuery, resetMocks } = require('./setup');
const AppError = require('../utils/appError');

jest.mock('stripe', () => {
  const balanceRetrieve = jest.fn();
  const accountsRetrieve = jest.fn();
  const factory = jest.fn(() => ({
    balance: { retrieve: balanceRetrieve },
    accounts: { retrieve: accountsRetrieve },
  }));
  factory.__balanceRetrieve = balanceRetrieve;
  factory.__accountsRetrieve = accountsRetrieve;
  return factory;
});
jest.mock('../services/stripeConnectSoTService', () => ({
  syncHelperProfileStripeFromConnect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return {
    ...actual,
    verifyStepupChallenge: jest.fn(),
    issueStepupChallenge: jest.fn(),
  };
});

const stripeFactory = require('stripe');
const { syncHelperProfileStripeFromConnect } = require('../services/stripeConnectSoTService');
const { verifyStepupChallenge, issueStepupChallenge } = require('../services/stepupChallengeService');
const paymentController = require('../controllers/paymentController');

function fakeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

const ACCOUNT_ROW = {
  rows: [{
    user_id: 'helper-1', stripe_account_id: 'acct_123',
    payouts_enabled: true, charges_enabled: true,
  }],
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  stripeFactory.__accountsRetrieve.mockResolvedValue({
    charges_enabled: true, payouts_enabled: true, details_submitted: true,
    requirements: { currently_due: [] }, country: 'US', default_currency: 'usd',
  });
  syncHelperProfileStripeFromConnect.mockResolvedValue(undefined);
});

describe('finding 27: requestInstantPayout step-up', () => {
  test('no challenge -> rejected before any Stripe call', async () => {
    mockQuery.mockResolvedValue(ACCOUNT_ROW);
    verifyStepupChallenge.mockRejectedValue(new AppError('challenge required', 400, 'credit_stepup_challenge_required'));
    const req = { user: { id: 'helper-1', email: 'h@example.com' }, body: {}, ip: '1.2.3.4' };
    const res = fakeRes();
    const next = jest.fn();
    await paymentController.requestInstantPayout(req, res, next);
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'helper-1',
      actionType: 'instant_payout',
    }));
    expect(stripeFactory.__balanceRetrieve).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'credit_stepup_challenge_required' }));
  });

  test('valid challenge -> proceeds to balance check', async () => {
    mockQuery.mockResolvedValue(ACCOUNT_ROW);
    verifyStepupChallenge.mockResolvedValue({ verified: true });
    stripeFactory.__balanceRetrieve.mockResolvedValue({ instant_available: [{ currency: 'usd', amount: 0 }] });
    const req = {
      user: { id: 'helper-1', email: 'h@example.com' },
      body: { stepupChallengeId: 'ch-1', stepupCode: '654321' },
      ip: '1.2.3.4',
    };
    const res = fakeRes();
    const next = jest.fn();
    await paymentController.requestInstantPayout(req, res, next);
    expect(verifyStepupChallenge).toHaveBeenCalledWith({
      challengeId: 'ch-1',
      actorUserId: 'helper-1',
      actionType: 'instant_payout',
      code: '654321',
    });
    expect(stripeFactory.__balanceRetrieve).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('finding 27: issueInstantPayoutStepupChallenge', () => {
  test('issues an instant_payout challenge capped at the $500 max', async () => {
    issueStepupChallenge.mockResolvedValue({
      challenge: {
        id: 'ch-2', actionType: 'instant_payout', amountCents: 50000,
        currencyCode: 'USD', expiresAt: '2030-01-01T00:00:00.000Z',
      },
      delivery: { channel: 'email' },
    });
    const req = { user: { id: 'helper-1', email: 'h@example.com' }, body: { amountCents: 99999999 } };
    const res = fakeRes();
    const next = jest.fn();
    await paymentController.issueInstantPayoutStepupChallenge(req, res, next);
    expect(issueStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'helper-1',
      actionType: 'instant_payout',
      amountCents: 50000,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.challenge.id).toBe('ch-2');
    expect(next).not.toHaveBeenCalled();
  });
});
