'use strict';

/**
 * Credit Everywhere Phase 1 — control plane tests.
 *
 * Covers the LOCKED decisions:
 * 1. Maker-checker on activation: requesting activation queues a pending
 *    action (202, not executed); a DIFFERENT admin must approve;
 *    self-approval is 403 credit_self_approval_forbidden.
 * 2. Didit gate: activation is blocked (409 credit_participant_didit_required)
 *    unless the owners are Didit-verified.
 * 3. Self-serve apply: creates a pending participant + pending partner;
 *    duplicate applies replay.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});

const {
  requestPendingAction,
  decidePendingAction,
} = require('../services/oxsteedCreditPendingActionService');
const {
  applyForCreditParticipation,
  activateParticipantInTransaction,
} = require('../services/oxsteedCreditParticipantService');
const { withTransaction } = require('../utils/transaction');

const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHECKER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const PARTICIPANT_ID = '11';
const PARTNER_ID = '22';

let railEnabled = true;

function installRouter() {
  mockQuery.mockImplementation((sql, params = []) => {
    // Rail gate: feature_flags oxsteed_credit_enabled
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return Promise.resolve({ rows: [{ is_enabled: railEnabled }] });
    }
    if (sql.includes('pg_advisory_xact_lock')) {
      return Promise.resolve({ rows: [] });
    }
    // Rail freeze check: no active freezes
    if (sql.includes('FROM oxsteed_credit_rail_freezes')) {
      return Promise.resolve({ rows: [] });
    }
    // Participants table exists
    if (sql.includes('information_schema.tables') && sql.includes('credit_participants')) {
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    }
    // Pending action insert (activation request)
    if (sql.includes('INSERT INTO oxsteed_credit_pending_actions')) {
      return Promise.resolve({
        rows: [{
          id: 'pa-1',
          action_type: params[0],
          payload: JSON.parse(params[1]),
          requested_by: params[2],
          requested_at: new Date().toISOString(),
          status: 'pending',
          decided_by: null,
          decided_at: null,
          decision_reason: null,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          idempotency_key: params[4],
          execution_refs: {},
        }],
      });
    }
    // Pending action lookup for decision (mutable status for post-decision re-read)
    if (sql.includes('FROM oxsteed_credit_pending_actions WHERE id =')) {
      const actionType = global.__testActionType || 'credit_participant_activation';
      return Promise.resolve({
        rows: [{
          id: 'pa-1',
          action_type: actionType,
          payload: { participantId: PARTICIPANT_ID, partnerId: PARTNER_ID, reason: 'test' },
          requested_by: global.__testMaker || MAKER_ID,
          requested_at: new Date().toISOString(),
          status: global.__testDecidedStatus || global.__testActionStatus || 'pending',
          decided_by: global.__testDecidedStatus ? CHECKER_ID : null,
          decided_at: global.__testDecidedStatus ? new Date().toISOString() : null,
          decision_reason: null,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          idempotency_key: 'k1',
          execution_refs: {},
        }],
      });
    }
    // Decision writes flip the mutable status
    if (sql.includes("SET status = 'approved'") || sql.includes('SET status = $')) {
      global.__testDecidedStatus = 'approved';
      return Promise.resolve({ rows: [] });
    }
    // Participant row for activation
    if (sql.includes('FROM credit_participants cp WHERE cp.id =')) {
      return Promise.resolve({
        rows: [{
          id: PARTICIPANT_ID,
          partner_id: PARTNER_ID,
          participant_type: 'business',
          user_id: null,
          restaurant_id: null,
          business_id: '33',
          status: global.__testParticipantStatus || 'pending',
          didit_verified: global.__testDiditVerified !== false,
          allowed_surfaces: ['food'],
          notes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });
    }
    if (sql.includes('SELECT * FROM credit_participants WHERE id =')) {
      return Promise.resolve({
        rows: [{
          id: PARTICIPANT_ID,
          partner_id: PARTNER_ID,
          participant_type: 'business',
          user_id: null,
          restaurant_id: null,
          business_id: '33',
          status: 'active',
          didit_verified: true,
          allowed_surfaces: ['food'],
          notes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });
    }
    // Users didit check
    if (sql.includes('FROM users WHERE id = ANY')) {
      const verified = global.__testOwnerDiditVerified !== false;
      return Promise.resolve({
        rows: (params[0] || []).map((id) => ({ id, didit_status: verified ? 'verified' : 'pending' })),
      });
    }
    // Business owner lookup
    if (sql.includes('SELECT user_id FROM businesses WHERE id =')) {
      return Promise.resolve({ rows: [{ user_id: MAKER_ID }] });
    }
    // Partner owner resolution (business owners via partner business_id or restaurant link)
    if (sql.includes('SELECT DISTINCT b.user_id AS owner_id')) {
      return Promise.resolve({ rows: [{ owner_id: MAKER_ID }] });
    }
    // Partner owner lookup (legacy shape, kept for safety)
    if (sql.includes('SELECT business_id, restaurant_id FROM oxsteed_credit_partners WHERE id =')) {
      return Promise.resolve({ rows: [{ business_id: '33', restaurant_id: null }] });
    }
    // Business ownership for apply
    if (sql.includes('SELECT id, user_id FROM businesses WHERE id =')) {
      return Promise.resolve({ rows: [{ id: '33', user_id: global.__testApplyUser || MAKER_ID }] });
    }
    // Existing application check
    if (sql.includes('FROM credit_participants') && sql.includes("status IN ('pending', 'active')") && sql.includes('participant_type = $1')) {
      return Promise.resolve({ rows: global.__testExistingApplication ? [{ id: '99', status: 'pending' }] : [] });
    }
    // Partner insert
    if (sql.includes('INSERT INTO oxsteed_credit_partners')) {
      return Promise.resolve({ rows: [{ id: PARTNER_ID }] });
    }
    // Participant insert
    if (sql.includes('INSERT INTO credit_participants')) {
      return Promise.resolve({
        rows: [{
          id: PARTICIPANT_ID,
          partner_id: PARTNER_ID,
          participant_type: 'business',
          user_id: null,
          restaurant_id: null,
          business_id: '33',
          status: 'pending',
          didit_verified: false,
          allowed_surfaces: [],
          notes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });
    }
    // Updates / audit
    if (sql.includes('UPDATE credit_participants') || sql.includes('UPDATE oxsteed_credit_partners') || sql.includes('INSERT INTO') && sql.includes('audit')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  resetMocks();
  railEnabled = true;
  global.__testActionType = 'credit_participant_activation';
  global.__testMaker = MAKER_ID;
  global.__testActionStatus = 'pending';
  global.__testDecidedStatus = null;
  global.__testParticipantStatus = 'pending';
  global.__testDiditVerified = true;
  global.__testOwnerDiditVerified = true;
  global.__testApplyUser = MAKER_ID;
  global.__testExistingApplication = false;
  installRouter();
});

describe('maker-checker on activation', () => {
  test('requesting participant activation queues a pending action (not executed)', async () => {
    const result = await requestPendingAction({
      actionType: 'credit_participant_activation',
      payload: { participantId: PARTICIPANT_ID, reason: 'looks good' },
      requestedBy: MAKER_ID,
      idempotencyKey: 'activate-1',
    });
    expect(result.executed).toBe(false);
    expect(result.pendingAction).toBeTruthy();
    expect(result.pendingAction.actionType).toBe('credit_participant_activation');
    expect(result.pendingAction.status).toBe('pending');
  });

  test('self-approval is forbidden (403)', async () => {
    await expect(
      decidePendingAction({
        actionId: 'pa-1',
        decidedBy: MAKER_ID, // same as maker
        decision: 'approved',
        reason: 'approve myself',
        stepupChallengeId: 'c1',
        stepupCode: '123456',
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'credit_self_approval_forbidden' });
  });

  test('a different admin can approve', async () => {
    const result = await decidePendingAction({
      actionId: 'pa-1',
      decidedBy: CHECKER_ID,
      decision: 'approved',
      reason: 'verified',
      stepupChallengeId: 'c1',
      stepupCode: '123456',
    });
    expect(result.pendingAction.status).toBe('approved');
    expect(result.replayed).toBe(false);
  });

  test('rejection requires a reason', async () => {
    await expect(
      decidePendingAction({
        actionId: 'pa-1',
        decidedBy: CHECKER_ID,
        decision: 'rejected',
        reason: '',
        stepupChallengeId: 'c1',
        stepupCode: '123456',
      })
    ).rejects.toMatchObject({ code: 'credit_decision_reason_required' });
  });
});

describe('Didit gate', () => {
  test('activation blocked when participant not didit-verified and owners unverified', async () => {
    global.__testDiditVerified = false;
    global.__testOwnerDiditVerified = false;
    await expect(
      withTransaction(require('../db'), async (client) =>
        activateParticipantInTransaction(client, {
          participantId: PARTICIPANT_ID,
          actorUserId: CHECKER_ID,
          reason: 'activate',
        })
      )
    ).rejects.toMatchObject({ code: 'credit_participant_didit_required' });
  });

  test('activation proceeds when owners are didit-verified', async () => {
    global.__testDiditVerified = false; // flag false, but owners verified
    global.__testOwnerDiditVerified = true;
    const result = await withTransaction(require('../db'), async (client) =>
      activateParticipantInTransaction(client, {
        participantId: PARTICIPANT_ID,
        actorUserId: CHECKER_ID,
        reason: 'activate',
      })
    );
    expect(result.participant.status).toBe('active');
    expect(result.replayed).toBe(false);
  });
});

describe('self-serve apply', () => {
  test('business owner apply creates pending participant', async () => {
    const result = await applyForCreditParticipation({
      userId: MAKER_ID,
      participantType: 'business',
      businessId: '33',
      notes: 'please approve',
    });
    expect(result.replayed).toBe(false);
    expect(result.participant.status).toBe('pending');
    expect(result.participant.participantType).toBe('business');
  });

  test('non-owner cannot apply for a business', async () => {
    global.__testApplyUser = CHECKER_ID; // business owned by someone else
    await expect(
      applyForCreditParticipation({
        userId: MAKER_ID,
        participantType: 'business',
        businessId: '33',
      })
    ).rejects.toMatchObject({ code: 'credit_apply_not_owner' });
  });

  test('duplicate apply replays', async () => {
    global.__testExistingApplication = true;
    const result = await applyForCreditParticipation({
      userId: MAKER_ID,
      participantType: 'business',
      businessId: '33',
    });
    expect(result.replayed).toBe(true);
  });

  test('unauthenticated apply is rejected', async () => {
    await expect(
      applyForCreditParticipation({ userId: null, participantType: 'business', businessId: '33' })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});


describe('partner activation maker-checker (LOCKED)', () => {
  test('partner activation request queues a credit_partner_activation action (202, not executed)', async () => {
    const { pendingAction, executed } = await requestPendingAction({
      actionType: 'credit_partner_activation',
      payload: { partnerId: 7, expectedStatus: 'pending', reason: 'Partner vetted' },
      requestedBy: MAKER_ID,
      idempotencyKey: 'partner-act-1',
    });
    expect(executed).toBe(false);
    expect(pendingAction.actionType).toBe('credit_partner_activation');
    expect(pendingAction.status).toBe('pending');
    // Partner must still be pending: no direct activation happened
    expect(global.__testDecidedStatus).toBeNull();
  });

  test('self-approval of partner activation is 403', async () => {
    global.__testActionType = 'credit_partner_activation';
    await requestPendingAction({
      actionType: 'credit_partner_activation',
      payload: { partnerId: 7, reason: 'test' },
      requestedBy: MAKER_ID,
      idempotencyKey: 'partner-act-2',
    });
    await expect(
      decidePendingAction({ actionId: 'pa-1', decision: 'approve', decidedBy: MAKER_ID, reason: 'self approve' })
    ).rejects.toMatchObject({ code: 'credit_self_approval_forbidden', status: 403 });
  });

  test('checker approving partner activation enforces Didit gate (blocked when unverified)', async () => {
    global.__testActionType = 'credit_partner_activation';
    global.__testOwnerDiditVerified = false;
    await requestPendingAction({
      actionType: 'credit_partner_activation',
      payload: { partnerId: 7, reason: 'test' },
      requestedBy: MAKER_ID,
      idempotencyKey: 'partner-act-3',
    });
    await expect(
      decidePendingAction({ actionId: 'pa-1', decision: 'approve', decidedBy: CHECKER_ID, reason: 'approve' })
    ).rejects.toMatchObject({ code: 'credit_participant_didit_required' });
  });

  test('direct partner activation via controller is 409 (dual-control required)', async () => {
    const controller = require('../controllers/oxsteedCreditController');
    const req = {
      params: { id: '5' },
      body: { targetStatus: 'active' },
      user: { id: MAKER_ID },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = {
      statusCode: 0,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    let nextErr = null;
    await controller.transitionAdminPartner(req, res, (err) => { nextErr = err; });
    // The controller short-circuits before touching the service
    expect(nextErr).toMatchObject({ code: 'credit_partner_activation_requires_dual_control', status: 409 });
  });
});
