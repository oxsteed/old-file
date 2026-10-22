'use strict';

/**
 * Auth audit 2026-10-22 (credit-core track): regression tests for items
 * 2 (maker), 8, 11, 16.
 *
 * - Item 2 (maker): adminAdjustCredit passes through evaluateFundingCompliance
 *   with fundingMethod 'admin_adjustment'; compliance uncertainty fails closed
 *   before anything is queued.
 * - Item 11: every dedicated maker route funnels through requestMoneyMovement,
 *   which verifies a fresh maker step-up challenge (actionType
 *   'pending_action_request') exactly once.
 * - Item 8: rail unfreeze rejects impersonated sessions at the route and
 *   requires a fresh step-up challenge ('credit_rail_unfreeze') in the
 *   controller. Freeze stays unilateral by design.
 * - Item 16: admin card issuance routes reject impersonated sessions and the
 *   issuance handlers require a fresh step-up challenge ('credit_card_issue').
 */

const fs = require('fs');
const { resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn() };
});
jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn(),
}));
jest.mock('../services/oxsteedCreditPendingActionService', () => ({
  requestPendingAction: jest.fn(),
}));
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return { ...actual, unfreezeCreditRail: jest.fn() };
});
jest.mock('../services/oxsteedCreditCardService', () => ({
  adminIssueVirtualCard: jest.fn(),
  adminIssuePhysicalCard: jest.fn(),
}));
// The card controller imports the device-credential helpers for its
// kiosk surface; mock them the same way oxsteedCreditCard.test.js does.
jest.mock('../controllers/restaurantAppFlowController', () => ({
  requireDeviceCredential: jest.fn(),
  assertDeviceApp: jest.fn(),
}));

const controller = require('../controllers/oxsteedCreditController');
const cardController = require('../controllers/oxsteedCreditCardController');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const { requestPendingAction } = require('../services/oxsteedCreditPendingActionService');
const creditService = require('../services/oxsteedCreditService');
const cardService = require('../services/oxsteedCreditCardService');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function makeReq(overrides = {}) {
  return {
    params: {},
    body: {},
    query: {},
    headers: {},
    user: { id: ADMIN_ID, role: 'super_admin' },
    ip: '127.0.0.1',
    correlationId: 'audit-item-test',
    get: () => undefined,
    ...overrides,
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function stepupDenied() {
  return Object.assign(new Error('step-up denied'), { status: 403, code: 'credit_stepup_challenge_required' });
}

beforeEach(() => {
  resetMocks();
  verifyStepupChallenge.mockReset().mockResolvedValue({ verified: true });
  evaluateFundingCompliance.mockReset().mockResolvedValue({ allowed: true });
  requestPendingAction.mockReset().mockResolvedValue({
    executed: false,
    pendingAction: { id: 'pa-1', status: 'pending' },
    result: null,
    replayed: false,
  });
  creditService.unfreezeCreditRail.mockReset().mockResolvedValue({ freeze: null, cleared: false, replayed: true });
  cardService.adminIssueVirtualCard.mockReset().mockResolvedValue({ replayed: false, card: { id: 'card-1' } });
});

describe('item 2 (maker): adminAdjustCredit passes the funding compliance choke point', () => {
  function adjustmentReq() {
    return makeReq({
      params: { customerId: CUSTOMER_ID },
      body: {
        direction: 'credit',
        amountCents: 10000,
        currencyCode: 'USD',
        reason: 'goodwill grant',
        referenceId: 'funding-9',
        stepupChallengeId: 'challenge-1',
        stepupCode: '123456',
      },
    });
  }

  test('queues the adjustment when compliance passes, tagged admin_adjustment', async () => {
    const res = makeRes();
    const next = jest.fn();
    await controller.adminAdjustCredit(adjustmentReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(evaluateFundingCompliance).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      amountCents: 10000,
      currencyCode: 'USD',
      fundingMethod: 'admin_adjustment',
      actorUserId: ADMIN_ID,
    }));
    expect(requestPendingAction).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test('fails closed at the maker when compliance is uncertain: nothing queued', async () => {
    evaluateFundingCompliance.mockRejectedValueOnce(
      Object.assign(new Error('Sanctions hit'), { status: 403, code: 'fiat_compliance_sanctions_hit' })
    );
    const next = jest.fn();
    await controller.adminAdjustCredit(adjustmentReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403, code: 'fiat_compliance_sanctions_hit' });
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('the funding-reference 400 still fires before compliance touches the DB', async () => {
    const req = adjustmentReq();
    delete req.body.referenceId;
    const next = jest.fn();
    await controller.adminAdjustCredit(req, makeRes(), next);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 400, code: 'credit_funding_reference_required' });
    expect(evaluateFundingCompliance).not.toHaveBeenCalled();
    expect(requestPendingAction).not.toHaveBeenCalled();
  });
});

describe('item 11: maker-side fresh step-up on every money-movement intent', () => {
  test('a dedicated maker route verifies the maker step-up before queueing', async () => {
    const res = makeRes();
    const next = jest.fn();
    await controller.adminAdjustCredit(
      makeReq({
        params: { customerId: CUSTOMER_ID },
        body: {
          direction: 'credit', amountCents: 10000, currencyCode: 'USD',
          reason: 'grant', referenceId: 'funding-11',
          stepupChallengeId: 'challenge-1', stepupCode: '123456',
        },
      }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: 'challenge-1',
      actorUserId: ADMIN_ID,
      actionType: 'pending_action_request',
      code: '123456',
    }));
    expect(requestPendingAction).toHaveBeenCalledTimes(1);
  });

  test('a failed maker step-up blocks queueing on a dedicated maker route', async () => {
    verifyStepupChallenge.mockRejectedValueOnce(stepupDenied());
    const next = jest.fn();
    await controller.refundAdminCredit(
      makeReq({
        params: { transactionId: '33333333-3333-4333-8333-333333333333' },
        body: { amountCents: 500, reason: 'duplicate charge', stepupChallengeId: 'bad', stepupCode: '000000' },
      }),
      makeRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('the generic maker endpoint verifies the single-use challenge exactly once', async () => {
    const next = jest.fn();
    await controller.requestAdminPendingAction(
      makeReq({
        body: {
          actionType: 'credit_fee_schedule_update',
          payload: { id: '7' },
          stepupChallengeId: 'challenge-1',
          stepupCode: '123456',
        },
      }),
      makeRes(),
      next
    );
    expect(next).not.toHaveBeenCalled();
    // Exactly once: requestMoneyMovement is the single choke point now, so
    // the single-use challenge is never consumed twice.
    expect(verifyStepupChallenge).toHaveBeenCalledTimes(1);
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'pending_action_request',
    }));
    expect(requestPendingAction).toHaveBeenCalledTimes(1);
  });
});

describe('item 8: rail unfreeze is no longer unilateral', () => {
  function unfreezeReq() {
    return makeReq({
      body: { reason: 'fraud incident resolved', stepupChallengeId: 'challenge-9', stepupCode: '654321' },
    });
  }

  test('requires a fresh step-up challenge before unfreezing', async () => {
    const res = makeRes();
    const next = jest.fn();
    await controller.unfreezeAdminCreditRail(unfreezeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_rail_unfreeze',
      actorUserId: ADMIN_ID,
    }));
    expect(creditService.unfreezeCreditRail).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalled();
  });

  test('a missing/invalid step-up blocks the unfreeze: the rail stays frozen', async () => {
    verifyStepupChallenge.mockRejectedValueOnce(stepupDenied());
    const next = jest.fn();
    await controller.unfreezeAdminCreditRail(unfreezeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
    expect(creditService.unfreezeCreditRail).not.toHaveBeenCalled();
  });

  test('the unfreeze route rejects impersonated sessions', () => {
    const source = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
    expect(source).toMatch(/router\.post\('\/super\/oxsteed-credit\/rail\/unfreeze',\s*requireSuperAdmin,\s*rejectImpersonated/);
  });
});

describe('item 16: admin card issuance guards', () => {
  function issueReq() {
    return makeReq({
      body: {
        customerId: CUSTOMER_ID,
        currencyCode: 'USD',
        stepupChallengeId: 'challenge-7',
        stepupCode: '777777',
      },
    });
  }

  test('virtual card issuance requires a fresh step-up challenge', async () => {
    const res = makeRes();
    const next = jest.fn();
    await cardController.adminIssueVirtualCard(issueReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'credit_card_issue',
      actorUserId: ADMIN_ID,
    }));
    expect(cardService.adminIssueVirtualCard).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('a missing step-up blocks card issuance: no card is created', async () => {
    verifyStepupChallenge.mockRejectedValueOnce(stepupDenied());
    const next = jest.fn();
    await cardController.adminIssueVirtualCard(issueReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
    expect(cardService.adminIssueVirtualCard).not.toHaveBeenCalled();
  });

  test('the card issuance routes reject impersonated sessions', () => {
    const source = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
    for (const path of [
      '/super/oxsteed-credit/cards/issue-virtual',
      '/super/oxsteed-credit/cards/issue-physical',
      '/super/oxsteed-credit/cards/:cardId/replacement/retry',
      '/super/oxsteed-credit/cards/:cardId/revoke',
    ]) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(source).toMatch(new RegExp(`router\\.post\\('${escaped}',\\s*requireSuperAdmin,\\s*rejectImpersonated`));
    }
  });
});

describe('rejectImpersonated middleware', () => {
  function mwRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  test('blocks a session flagged by the auth middleware', () => {
    const res = mwRes();
    const next = jest.fn();
    rejectImpersonated({ isImpersonated: true, headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'impersonation_blocked' }));
  });

  test('blocks a bearer token carrying impersonation claims', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ impersonation: true })).toString('base64url');
    const signature = Buffer.from('test-signature').toString('base64url');
    const token = `${header}.${payload}.${signature}`;
    const res = mwRes();
    const next = jest.fn();
    rejectImpersonated({ headers: { authorization: `Bearer ${token}` } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('passes a clean admin request through', () => {
    const res = mwRes();
    const next = jest.fn();
    rejectImpersonated({ headers: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
