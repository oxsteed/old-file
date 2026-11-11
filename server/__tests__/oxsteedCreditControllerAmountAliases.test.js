'use strict';

// Request aliases must preserve an explicit zero long enough for the owning
// service to reject it. Truthiness-based fallback lets a contradictory
// snake_case alias silently replace that value with a different amount.
const { resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => ({
  issueStepupChallenge: jest.fn(),
  verifyStepupChallenge: jest.fn(),
  amountRequiresStepup: jest.fn(),
  TOTP_STEPUP_ACTION_TYPES: ['pending_action_request'],
}));
jest.mock('../services/oxsteedCreditPendingActionService', () => ({
  requestPendingAction: jest.fn(),
  decidePendingAction: jest.fn(),
  listPendingActions: jest.fn(),
  resolveCheckerStepupAmountCents: jest.fn(),
}));
jest.mock('../services/oxsteedCreditCurrencyConversionService', () => ({
  calculateQuotedTargetAmount: jest.fn(({ sourceAmountMinorUnits }) => sourceAmountMinorUnits),
  getCurrencyQuote: jest.fn(),
  convertCustomerCredit: jest.fn(),
}));
jest.mock('../services/fxRateProvider', () => ({ getFxQuote: jest.fn() }));

const controller = require('../controllers/oxsteedCreditController');
const { issueStepupChallenge, verifyStepupChallenge } = require('../services/stepupChallengeService');
const { requestPendingAction } = require('../services/oxsteedCreditPendingActionService');
const { convertCustomerCredit } = require('../services/oxsteedCreditCurrencyConversionService');

function makeReq(body = {}, headers = {}) {
  return {
    body,
    params: {},
    query: {},
    user: { id: 'admin-1', email: 'admin@example.test' },
    ip: '127.0.0.1',
    get: (name) => headers[name],
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  verifyStepupChallenge.mockClear();
  issueStepupChallenge.mockClear();
  requestPendingAction.mockClear();
  convertCustomerCredit.mockClear();
  verifyStepupChallenge.mockResolvedValue({ verified: true });
  issueStepupChallenge.mockResolvedValue({
    challenge: { id: 'challenge-1', actionType: 'pending_action_request', amountCents: 0, currencyCode: 'USD', expiresAt: 'future' },
    delivery: 'totp',
  });
  requestPendingAction.mockResolvedValue({
    executed: false,
    pendingAction: { id: 'pending-1', status: 'pending' },
    replayed: false,
  });
  convertCustomerCredit.mockResolvedValue({ replayed: false, conversion: { id: 'conversion-1' } });
});

test('customer conversion preserves explicit zero over the snake_case alias', async () => {
  await controller.convertMyCredit(
    makeReq(
      { sourceAmountMinorUnits: 0, source_amount_minor_units: 100, quoteId: 7 },
      { 'Idempotency-Key': 'conversion-1' },
    ),
    makeRes(),
    jest.fn(),
  );

  expect(convertCustomerCredit).toHaveBeenCalledWith(expect.objectContaining({
    sourceAmountMinorUnits: 0,
  }));
});

test('admin currency quote preserves explicit zero over the snake_case aliases', async () => {
  await controller.createAdminCurrencyQuote(
    makeReq(
      {
        sourceCurrencyCode: 'USD',
        targetCurrencyCode: 'EUR',
        sourceAmountMinorUnits: 0,
        source_amount_minor_units: 100,
        targetAmountMinorUnits: 0,
        target_amount_minor_units: 90,
        rateNumerator: '1',
        rateDenominator: '1',
        provider: 'test-provider',
        providerQuoteReference: 'test-reference',
        customerId: '11111111-1111-4111-8111-111111111111',
        reason: 'alias regression',
        stepupChallengeId: 'challenge-1',
        stepupCode: '123456',
      },
      { 'Idempotency-Key': 'quote-1' },
    ),
    makeRes(),
    jest.fn(),
  );

  expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
    payload: expect.objectContaining({
      sourceAmountMinorUnits: 0,
      targetAmountMinorUnits: 0,
    }),
  }));
});

test('currency quote maker step-up binds to the source amount', async () => {
  await controller.createAdminCurrencyQuote(
    makeReq({
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'EUR',
      sourceAmountMinorUnits: 2500,
      targetAmountMinorUnits: 2500,
      rateNumerator: '1',
      rateDenominator: '1',
      provider: 'test-provider',
      providerQuoteReference: 'test-reference-2',
      customerId: '11111111-1111-4111-8111-111111111111',
      reason: 'maker binding regression',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    }, { 'Idempotency-Key': 'quote-2' }),
    makeRes(),
    jest.fn(),
  );

  expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
    actionType: 'pending_action_request',
    expectedAmountCents: 2500,
  }));
});

test('partner funding preserves explicit zero over the snake_case alias', async () => {
  const req = makeReq(
    {
      amountCents: 0,
      amount_cents: 100,
      direction: 'credit',
      reason: 'alias regression',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    },
    { 'Idempotency-Key': 'funding-1' },
  );
  req.params.partnerId = '7';
  await controller.recordAdminPartnerFunding(
    req,
    makeRes(),
    jest.fn(),
  );

  expect(requestPendingAction).toHaveBeenCalledWith(expect.objectContaining({
    payload: expect.objectContaining({ amountCents: 0 }),
  }));
});

test('step-up issuance preserves explicit zero over the snake_case alias', async () => {
  await controller.issueAdminStepupChallenge(
    makeReq({
      actionType: 'pending_action_request',
      amountCents: 0,
      amount_cents: 100,
      currencyCode: 'USD',
    }),
    makeRes(),
    jest.fn(),
  );

  expect(issueStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 0 }));
});
