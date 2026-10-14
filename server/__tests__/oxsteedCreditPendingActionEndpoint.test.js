'use strict';

/**
 * ADM-079: the generic POST /admin/super/oxsteed-credit/pending-actions
 * maker endpoint must not bypass the dedicated maker front doors.
 *
 * - Action types with dedicated maker routes (settlement payout, withdrawal
 *   approval, currency quote) are 400-rejected with
 *   credit_pending_action_dedicated_route_required.
 * - A fresh maker step-up challenge (actionType 'pending_action_request')
 *   is required before anything queues.
 * - Terminal idempotency replays return 409, not 200 (ADM-081/ADM-116).
 */

const { resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn() };
});
jest.mock('../services/oxsteedCreditPendingActionService', () => ({
  requestPendingAction: jest.fn(),
  decidePendingAction: jest.fn(),
  listPendingActions: jest.fn(),
}));

const controller = require('../controllers/oxsteedCreditController');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');
const { requestPendingAction } = require('../services/oxsteedCreditPendingActionService');

function makeReq(body, idempotencyKey) {
  return {
    body,
    user: { id: 'maker-1' },
    ip: '127.0.0.1',
    get: (header) => {
      if (header === 'Idempotency-Key') return idempotencyKey;
      return undefined;
    },
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
  verifyStepupChallenge.mockReset();
  requestPendingAction.mockReset();
});

describe('requestAdminPendingAction (ADM-079)', () => {
  test('settlement payout / withdrawal approval / currency quote are 400-rejected', async () => {
    for (const actionType of ['credit_settlement_payout', 'credit_withdrawal_approval', 'credit_currency_quote']) {
      const next = jest.fn();
      await controller.requestAdminPendingAction(makeReq({ actionType, payload: {} }), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toMatchObject({
        status: 400,
        code: 'credit_pending_action_dedicated_route_required',
      });
    }
    expect(verifyStepupChallenge).not.toHaveBeenCalled();
    expect(requestPendingAction).not.toHaveBeenCalled();
  });

  test('requires a fresh maker step-up challenge', async () => {
    verifyStepupChallenge.mockRejectedValue(
      Object.assign(new Error('step-up denied'), { status: 403, code: 'stepup_verification_failed' })
    );
    const next = jest.fn();
    await controller.requestAdminPendingAction(
      makeReq(
        {
          actionType: 'credit_fee_schedule_update',
          payload: { id: '7' },
          stepupChallengeId: 'challenge-1',
          stepupCode: '123456',
        },
        'key-1'
      ),
      makeRes(),
      next
    );
    expect(verifyStepupChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: 'challenge-1',
        actorUserId: 'maker-1',
        actionType: 'pending_action_request',
        code: '123456',
      })
    );
    expect(requestPendingAction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a valid maker step-up queues the action (202)', async () => {
    verifyStepupChallenge.mockResolvedValue({ verified: true });
    requestPendingAction.mockResolvedValue({
      executed: false,
      pendingAction: { id: 'pa-1', status: 'pending' },
      result: null,
      replayed: false,
    });
    const res = makeRes();
    const next = jest.fn();
    await controller.requestAdminPendingAction(
      makeReq(
        {
          actionType: 'credit_fee_schedule_update',
          payload: { id: '7' },
          stepupChallengeId: 'challenge-1',
          stepupCode: '123456',
        },
        'key-1'
      ),
      res,
      next
    );
    expect(requestPendingAction).toHaveBeenCalledTimes(1);
    expect(requestPendingAction.mock.calls[0][0]).toMatchObject({
      actionType: 'credit_fee_schedule_update',
      requestedBy: 'maker-1',
      idempotencyKey: 'key-1',
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(next).not.toHaveBeenCalled();
  });

  test('a terminal idempotency replay returns 409, not 200', async () => {
    verifyStepupChallenge.mockResolvedValue({ verified: true });
    requestPendingAction.mockResolvedValue({
      executed: false,
      pendingAction: { id: 'pa-1', status: 'approved' },
      result: null,
      replayed: true,
      terminalReplay: true,
    });
    const res = makeRes();
    const next = jest.fn();
    await controller.requestAdminPendingAction(
      makeReq(
        {
          actionType: 'credit_fee_schedule_update',
          payload: { id: '7' },
          stepupChallengeId: 'challenge-1',
          stepupCode: '123456',
        },
        'key-1'
      ),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'credit_pending_action_terminal_replay', replayed: true })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
