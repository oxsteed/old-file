'use strict';

// Group 13 Slice 4i acceptance: understand limits (691-695).
// 691 limit overview + 692 limit reset display re-checked live against the
// real endpoint (no build); 693 surfaces the stored restriction reason on
// granular-restriction blocks; 694 notifies the participant when
// eligibility or status changes; 695 links recovery paths from the states
// where a restricted or revoked state is shown. No money moves in this
// slice: 693 changes only the explanation on a 403, 694 only sends a
// notice after a transition commits, 695 only links existing paths.
// Runs against a dedicated fresh database (credit_statement_test_g13i) so
// slice-local fixtures never pollute the shared credit_statement_test DB.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'group13-slice4i-test-secret';

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

// 694: the maker-checker activation path verifies the checker's step-up
// challenge at decision time. The challenge itself is not what this slice
// proves, so it is stubbed verified exactly as the Phase 1 control-plane
// suite stubs it; the activation and the notice stay real.
jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4I_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13i') {
    throw new Error('Group 13 Slice 4i DB tests require the loopback credit_statement_test_g13i database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4i: understand limits (691-695)', () => {
  let pool;
  let app;
  let admin;

  beforeAll(async () => {
    pool = require('../db');
    const creditCtrl = require('../controllers/oxsteedCreditController');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.get('/oxsteed-credit/limits', authenticate, creditCtrl.getMyCreditLimits);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    // 694: the maker-checker decision asserts the rail is enabled.
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled) VALUES ('oxsteed_credit_enabled', TRUE)
       ON CONFLICT (key) DO UPDATE SET is_enabled = TRUE`,
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authGet = (user, path) => request(app)
    .get(path)
    .set('Authorization', `Bearer ${tokenFor(user)}`);

  async function notificationsFor(userId, type) {
    const { rows } = await pool.query(
      `SELECT type, title, body, data, action_url FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at`,
      [userId, type],
    );
    return rows;
  }

  // Seed the way an admin registration would: the partner row is
  // attributed to an active admin, which is what migration 488 requires.
  async function seedParticipant({ participantType, userId = null, businessId = null, status = 'pending', diditVerified = false }) {
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by, status)
       VALUES (NULL, $1, 'USD', NULL, $2, 'pending') RETURNING id`,
      [businessId, admin.id],
    );
    const { rows: [participant] } = await pool.query(
      `INSERT INTO credit_participants
         (partner_id, participant_type, restaurant_id, business_id, user_id, status, didit_verified, didit_verified_at, allowed_surfaces, notes)
       VALUES ($1, $2, NULL, $3, $4::uuid, $5, $6, CASE WHEN $6 THEN NOW() ELSE NULL END, '{}'::text[], NULL) RETURNING *`,
      [partner.id, participantType, businessId, userId, status, diditVerified],
    );
    return participant;
  }

  // 691: the limits overview still exists on the real endpoint.
  test('691 re-check: GET /oxsteed-credit/limits returns the spending guardrails', async () => {
    const user = await makeUser();
    const res = await authGet(user, '/oxsteed-credit/limits');
    expect(res.status).toBe(200);
    expect(res.body.limits).toBeDefined();
    expect(res.body.limits.spending).toMatchObject({
      centsRemaining: expect.any(Number),
      centsUsed: expect.any(Number),
      centsLimit: expect.any(Number),
      countRemaining: expect.any(Number),
    });
    expect(res.body.limits.resetsAt).toBeTruthy();
  });

  // 692: the reset time is the next calendar day, computed server-side.
  test('692 re-check: limits resetsAt is the next calendar day', async () => {
    const user = await makeUser();
    const res = await authGet(user, '/oxsteed-credit/limits');
    expect(res.status).toBe(200);
    const resetsAt = new Date(res.body.limits.resetsAt);
    expect(Number.isNaN(resetsAt.getTime())).toBe(false);
    const now = Date.now();
    expect(resetsAt.getTime()).toBeGreaterThan(now);
    expect(resetsAt.getTime()).toBeLessThan(now + 48 * 60 * 60 * 1000);
    const { rows } = await pool.query(`SELECT (CURRENT_DATE + INTERVAL '1 day')::timestamptz AS next_day`);
    const serverNextDay = new Date(rows[0].next_day);
    expect(Math.abs(resetsAt.getTime() - serverNextDay.getTime())).toBeLessThan(60 * 1000);
  });

  // 693: the middleware short-circuits in NODE_ENV=test, so these tests
  // flip the env around the direct invocation (restored in finally) and
  // exercise the real middleware against the real database.
  async function invokeRestrictions(userId, restrictionType) {
    const checkRestrictions = require('../middleware/checkRestrictions');
    const previousEnv = process.env.NODE_ENV;
    const calls = { status: null, body: null, nextCalled: false };
    const req = { user: { id: userId }, path: '/oxsteed-credit/checkout' };
    const res = {
      status(code) { calls.status = code; return this; },
      json(body) { calls.body = body; return this; },
    };
    const next = () => { calls.nextCalled = true; };
    try {
      process.env.NODE_ENV = 'development';
      await checkRestrictions(restrictionType)(req, res, next);
    } finally {
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
    }
    return calls;
  }

  test('693: a granular restriction block names the stored reason', async () => {
    const user = await makeUser();
    const reason = 'Manual review: unusual top-up pattern';
    await pool.query(
      `INSERT INTO user_restrictions (user_id, restriction_type, reason, is_active, expires_at)
       VALUES ($1, 'checkout', $2, TRUE, NULL)`,
      [user.id, reason],
    );
    const calls = await invokeRestrictions(user.id, 'checkout');
    expect(calls.status).toBe(403);
    expect(calls.body.code).toBe('ACCOUNT_RESTRICTED');
    expect(calls.body.error).toContain(reason);
    expect(calls.body.restrictionReason).toBe(reason);
    expect(calls.body.restrictionType).toBe('checkout');
    expect(calls.nextCalled).toBe(false);
  });

  test('693: the reason is never leaked to another customer', async () => {
    const restricted = await makeUser();
    const other = await makeUser();
    const reason = 'Manual review: unusual top-up pattern';
    await pool.query(
      `INSERT INTO user_restrictions (user_id, restriction_type, reason, is_active, expires_at)
       VALUES ($1, 'checkout', $2, TRUE, NULL)`,
      [restricted.id, reason],
    );
    const calls = await invokeRestrictions(other.id, 'checkout');
    expect(calls.nextCalled).toBe(true);
    expect(calls.status).toBeNull();
    expect(calls.body).toBeNull();
  });

  test('693: allow/deny is unchanged — wrong type and expired restrictions still pass', async () => {
    const user = await makeUser();
    await pool.query(
      `INSERT INTO user_restrictions (user_id, restriction_type, reason, is_active, expires_at)
       VALUES ($1, 'bidding', 'Bidding hold', TRUE, NULL)`,
      [user.id],
    );
    const wrongType = await invokeRestrictions(user.id, 'checkout');
    expect(wrongType.nextCalled).toBe(true);
    expect(wrongType.status).toBeNull();

    const expired = await makeUser();
    await pool.query(
      `INSERT INTO user_restrictions (user_id, restriction_type, reason, is_active, expires_at)
       VALUES ($1, 'checkout', 'Expired hold', TRUE, NOW() - INTERVAL '1 day')`,
      [expired.id],
    );
    const expiredCalls = await invokeRestrictions(expired.id, 'checkout');
    expect(expiredCalls.nextCalled).toBe(true);
    expect(expiredCalls.status).toBeNull();
  });

  test('693: an unrestricted customer still passes', async () => {
    const user = await makeUser();
    const calls = await invokeRestrictions(user.id, 'checkout');
    expect(calls.nextCalled).toBe(true);
    expect(calls.status).toBeNull();
  });

  // 694: apply notifies the applicant that the application is pending.
  // The live apply call cannot run on a migrated database — the HELD
  // 488 defect (creditParticipantMe.db.test.js): apply inserts the
  // partner row with created_by = the applicant and the 488 trigger
  // requires an active administrator creator. Widening that guard is a
  // money-control call awaiting Emile, so this test proves the exact
  // notice the apply wrapper sends (same helper, same arguments) against
  // an admin-seeded pending participant instead of driving the broken
  // insert. The enroll and activation tests below prove the live hooks.
  test('694: apply notice — a pending participant notifies its owner of the pending status', async () => {
    const { notifyParticipantStatusChange } = require('../services/oxsteedCreditParticipantService');
    const owner = await makeUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', TRUE, TRUE) RETURNING id`,
      [owner.id],
    );
    const participant = await seedParticipant({
      participantType: 'business', businessId: business.id, status: 'pending', diditVerified: false,
    });
    const { formatParticipant } = require('../services/oxsteedCreditParticipantService');
    await notifyParticipantStatusChange(formatParticipant(participant), { previousStatus: null });
    const notes = await notificationsFor(owner.id, 'credit_participant_status_changed');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBeTruthy();
    expect(notes[0].body).toContain('pending');
    expect(notes[0].data.status).toBe('pending');
    expect(notes[0].data.participant_id).toBe(String(participant.id));
    expect(notes[0].action_url).toBe('/credit/apply');
  });

  test('694: a repeated notice for the same transition replays instead of duplicating', async () => {
    const { notifyParticipantStatusChange, formatParticipant } = require('../services/oxsteedCreditParticipantService');
    const owner = await makeUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', TRUE, TRUE) RETURNING id`,
      [owner.id],
    );
    const participant = await seedParticipant({
      participantType: 'business', businessId: business.id, status: 'pending', diditVerified: false,
    });
    const formatted = formatParticipant(participant);
    await notifyParticipantStatusChange(formatted, { previousStatus: null });
    await notifyParticipantStatusChange(formatted, { previousStatus: null });
    expect(await notificationsFor(owner.id, 'credit_participant_status_changed')).toHaveLength(1);
  });

  // 694: admin enrollment notifies the enrolled subject.
  test('694: enroll notifies the enrolled subject of the pending status', async () => {
    const { enrollParticipant } = require('../services/oxsteedCreditParticipantService');
    const subject = await makeUser();
    const result = await enrollParticipant({
      actorUserId: admin.id, participantType: 'helper', subjectUserId: subject.id,
    });
    expect(result.participant.status).toBe('pending');
    const notes = await notificationsFor(subject.id, 'credit_participant_status_changed');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBeTruthy();
    expect(notes[0].body).toContain('pending');
    expect(notes[0].data.status).toBe('pending');
  });

  // 694: maker-checker activation notifies the subject after the
  // checker's approval commits — the real decide path, not the wrapper.
  test('694: maker-checker activation notifies the subject of the active status', async () => {
    const { requestPendingAction, decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
    const maker = await makeUser('super_admin');
    const checker = await makeUser('super_admin');
    const owner = await makeUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', TRUE, TRUE) RETURNING id`,
      [owner.id],
    );
    const participant = await seedParticipant({
      participantType: 'business', businessId: business.id, status: 'pending', diditVerified: true,
    });
    const requested = await requestPendingAction({
      actionType: 'credit_participant_activation',
      payload: { participantId: String(participant.id), reason: 'approve' },
      requestedBy: maker.id,
      idempotencyKey: `g13i-activate-${participant.id}`,
    });
    expect(requested.executed).toBe(false);
    const decided = await decidePendingAction({
      actionId: requested.pendingAction.id,
      decidedBy: checker.id,
      decision: 'approve',
      reason: 'verified',
      stepupChallengeId: 'c1',
      stepupCode: '123456',
    });
    expect(decided.pendingAction.status).toBe('approved');
    expect(decided.result.participant.status).toBe('active');
    const notes = await notificationsFor(owner.id, 'credit_participant_status_changed');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBeTruthy();
    expect(notes[0].body).toContain('active');
    expect(notes[0].data.status).toBe('active');
    expect(notes[0].data.previous_status).toBe('pending');
  });

  // 694: a wallet account status flip is the customer-side eligibility
  // change, and it notifies the wallet holder.
  test('694: suspending a wallet account notifies the holder; a same-status repeat does not', async () => {
    const creditService = require('../services/oxsteedCreditService');
    const customer = await makeUser();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await creditService.ensureAccount(client, { accountType: 'customer_wallet', customerId: customer.id, currencyCode: 'USD' });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const suspended = await creditService.updateCustomerCreditAccountStatus({
      customerId: customer.id, status: 'suspended', actorUserId: admin.id, reason: 'test suspension',
    });
    expect(suspended.replayed).toBe(false);
    expect(suspended.account.status).toBe('suspended');
    let notes = await notificationsFor(customer.id, 'credit_participant_status_changed');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBeTruthy();
    expect(notes[0].body).toContain('suspended');
    expect(notes[0].data.account_status).toBe('suspended');
    expect(notes[0].data.kind).toBe('wallet_account');
    expect(notes[0].action_url).toBe('/oxsteed-credit');

    const replay = await creditService.updateCustomerCreditAccountStatus({
      customerId: customer.id, status: 'suspended', actorUserId: admin.id, reason: 'test suspension',
    });
    expect(replay.replayed).toBe(true);
    notes = await notificationsFor(customer.id, 'credit_participant_status_changed');
    expect(notes).toHaveLength(1);

    const reactivated = await creditService.updateCustomerCreditAccountStatus({
      customerId: customer.id, status: 'active', actorUserId: admin.id, reason: 'test reactivation',
    });
    expect(reactivated.replayed).toBe(false);
    notes = await notificationsFor(customer.id, 'credit_participant_status_changed');
    expect(notes).toHaveLength(2);
    expect(notes[1].data.account_status).toBe('active');
  });
});
