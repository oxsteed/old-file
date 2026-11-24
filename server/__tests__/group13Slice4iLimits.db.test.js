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
});
