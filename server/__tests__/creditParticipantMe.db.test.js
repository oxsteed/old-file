'use strict';

/**
 * PR #804 Track B (G-25): a business/helper applicant can read the live
 * status of their own Credit applications (GET
 * /api/oxsteed-credit/participants/me) instead of a static "submitted".
 *
 * KNOWN DEFECT (HELD, needs Emile's call): the self-serve apply path
 * itself is rejected on a migrated database. applyForCreditParticipation
 * inserts the oxsteed_credit_partners row with created_by = the applicant,
 * and migration 488's trigger requires an active administrator creator,
 * so every self-serve application fails with
 * "OxSteed Credit control records require an active administrator
 * creator" (23514). The only exemption is the dual-posting auto-provision
 * carve-out, which the apply path must not misuse as a marker. Widening
 * the guard is a money-control decision: hold the fix and ask Emile
 * whether self-serve pending partner rows may carry the attributed
 * applicant as creator, or whether apply becomes admin-initiated.
 * The test below reproduces the defect against unmodified code; flip it
 * to expect success when the guard call is made.
 *
 * The GET-me tests therefore seed participant rows the legitimate way an
 * admin registration would (partner created_by an active admin), which
 * proves the status endpoint, ownership scoping, and the empty state.
 * Skips unless STATEMENT_TEST_DATABASE_URL is the disposable Track B
 * database.
 */

jest.unmock('pg');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_pr804_b$/.test(url.pathname);
  } catch { return false; }
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;
if (CAN_RUN_DB) process.env.DATABASE_URL = RAW_URL;

jest.setTimeout(60000);

ddescribe('my Credit participant status (real database)', () => {
  let pool;
  let creditCtrl;
  let signupIntent;
  let app;
  let admin;

  beforeAll(async () => {
    pool = require('../db');
    creditCtrl = require('../controllers/oxsteedCreditController');
    signupIntent = require('../services/access/signupIntent');
    const { authenticate } = require('../middleware/auth');
    app = express();
    app.use(express.json());
    app.get('/api/oxsteed-credit/participants/me', authenticate, creditCtrl.getMyParticipants);
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
  });
  afterAll(async () => { if (pool) await pool.end(); });

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
  const auth = (call, user) => call.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getMe = (user) => auth(request(app).get('/api/oxsteed-credit/participants/me'), user);

  // Seed the way an admin registration would: the partner row is
  // attributed to an active admin, which is what migration 488 requires.
  async function seedParticipant({ participantType, userId = null, businessId = null, status = 'pending' }) {
    const { rows: [partner] } = await pool.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by, status)
       VALUES (NULL, $1, 'USD', NULL, $2, 'pending') RETURNING id`,
      [businessId, admin.id],
    );
    const { rows: [participant] } = await pool.query(
      `INSERT INTO credit_participants
         (partner_id, participant_type, restaurant_id, business_id, user_id, status, didit_verified, allowed_surfaces, notes)
       VALUES ($1, $2, NULL, $3, $4::uuid, $5, FALSE, '{}'::text[], NULL) RETURNING *`,
      [partner.id, participantType, businessId, userId, status],
    );
    return participant;
  }

  function fakeRes() {
    const res = { statusCode: 200, body: null, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }

  async function applyAs(user, body) {
    const res = fakeRes();
    let nextError = null;
    const next = (err) => { nextError = err; };
    await creditCtrl.applyForCredit({
      user: { id: user.id },
      body,
      ip: '127.0.0.1',
      get: () => undefined,
      correlationId: null,
    }, res, next);
    return { res, nextError };
  }

  test('helper application shows pending status on GET me', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    await seedParticipant({ participantType: 'helper', userId: user.id });

    const me = await getMe(user);
    expect(me.status).toBe(200);
    expect(me.body.participants).toHaveLength(1);
    expect(me.body.participants[0]).toMatchObject({ participantType: 'helper', status: 'pending' });
  });

  test('business application is visible to the owning user only', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { rows } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner.id, 'Fixture Business'],
    );
    await seedParticipant({ participantType: 'business', businessId: rows[0].id });

    const ownerMe = await getMe(owner);
    expect(ownerMe.status).toBe(200);
    expect(ownerMe.body.participants).toHaveLength(1);
    expect(ownerMe.body.participants[0]).toMatchObject({ participantType: 'business', status: 'pending' });

    const otherMe = await getMe(other);
    expect(otherMe.status).toBe(200);
    expect(otherMe.body.participants).toHaveLength(0);
  });

  test('a plain customer with no application sees an empty list', async () => {
    const user = await makeUser();
    const me = await getMe(user);
    expect(me.status).toBe(200);
    expect(me.body.participants).toEqual([]);
  });

  test('non-owner cannot apply for a business (checked before any insert)', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { rows } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner.id, 'Fixture Business 2'],
    );
    const forbidden = await applyAs(other, { participantType: 'business', businessId: rows[0].id });
    expect(forbidden.nextError).not.toBeNull();
    expect(forbidden.nextError.code).toBe('credit_apply_not_owner');
  });

  test('helper apply without a helper profile is rejected (checked before any insert)', async () => {
    const user = await makeUser();
    const { nextError } = await applyAs(user, { participantType: 'helper' });
    expect(nextError).not.toBeNull();
    expect(nextError.code).toBe('credit_apply_helper_required');
  });

  test('join_credit intent consumption stamps consumed_at', async () => {
    const user = await makeUser();
    await signupIntent.finalize(user.id, { signup_intent: 'join_credit', signup_return_to: null });
    expect(await signupIntent.consumeIntent(user.id, 'join_credit')).toBe(true);
    const { rows } = await pool.query(
      'SELECT consumed_at FROM access_signup_intents WHERE user_id = $1 AND intent = $2',
      [user.id, 'join_credit'],
    );
    expect(rows[0].consumed_at).not.toBeNull();
    expect(await signupIntent.pendingIntents(user.id)).toHaveLength(0);
  });

  test('KNOWN DEFECT (HELD): self-serve apply is rejected by the migration 488 creator guard', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    const { nextError } = await applyAs(user, { participantType: 'helper' });
    expect(nextError).not.toBeNull();
    expect(nextError.message).toMatch('OxSteed Credit control records require an active administrator creator');
  });
});
