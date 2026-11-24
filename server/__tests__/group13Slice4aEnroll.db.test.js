'use strict';

// Group 13 Slice 4a acceptance: Enroll (651-655).
// 651-654 are EXISTS re-checks (evidence in docs/persona-roadmap/group13.md);
// this suite proves 655 (D-359): the activation checklist derives from the
// three existing gates (application status, Didit verified, maker-checker
// approval) and is exposed per participant in GET
// /api/oxsteed-credit/participants/me. The checklist is read-only: it adds
// no new activation state machine and no new gate, and a participant sees
// only their own record.
// Runs against a dedicated fresh database (credit_statement_test_g13a) so
// slice-local fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4A_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13a') {
    throw new Error('Group 13 Slice 4a DB tests require the loopback credit_statement_test_g13a database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const { buildActivationChecklist } = require('../services/oxsteedCreditParticipantService');

// Pure derivation: no database needed, runs on every invocation.
describe('Group 13 Slice 4a: activation checklist derivation (655, D-359)', () => {
  const byId = (checklist) => Object.fromEntries(checklist.map((s) => [s.id, s]));

  test('pending + unverified: identity pending, approval blocked on Didit', () => {
    const steps = byId(buildActivationChecklist({ status: 'pending', diditVerified: false }));
    expect(steps.application).toEqual({ id: 'application', state: 'done', detail: 'submitted' });
    expect(steps.identity).toEqual({ id: 'identity', state: 'pending', detail: 'awaiting_verification' });
    expect(steps.approval).toEqual({ id: 'approval', state: 'blocked', detail: 'needs_verification' });
  });

  test('pending + verified, no approval requested: approval awaits review', () => {
    const steps = byId(buildActivationChecklist({ status: 'pending', diditVerified: true }));
    expect(steps.identity).toEqual({ id: 'identity', state: 'done', detail: 'verified' });
    expect(steps.approval).toEqual({ id: 'approval', state: 'pending', detail: 'awaiting_review' });
  });

  test('pending + verified + approval requested: approval awaits the checker', () => {
    const steps = byId(
      buildActivationChecklist({ status: 'pending', diditVerified: true }, { approvalRequested: true }),
    );
    expect(steps.approval).toEqual({ id: 'approval', state: 'pending', detail: 'approval_requested' });
  });

  test('active + verified: every step done', () => {
    const steps = byId(buildActivationChecklist({ status: 'active', diditVerified: true }));
    expect(Object.values(steps).map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(steps.approval).toEqual({ id: 'approval', state: 'done', detail: 'approved' });
  });

  test('suspended and revoked: identity and approval blocked, application stays done', () => {
    for (const status of ['suspended', 'revoked']) {
      const steps = byId(buildActivationChecklist({ status, diditVerified: true }));
      expect(steps.application).toEqual({ id: 'application', state: 'done', detail: 'submitted' });
      expect(steps.identity).toEqual({ id: 'identity', state: 'blocked', detail: 'closed' });
      expect(steps.approval).toEqual({ id: 'approval', state: 'blocked', detail: 'closed' });
    }
  });

  test('checklist always has exactly the three gates, in order', () => {
    const checklist = buildActivationChecklist({ status: 'pending', diditVerified: false });
    expect(checklist.map((s) => s.id)).toEqual(['application', 'identity', 'approval']);
    for (const step of checklist) {
      expect(['done', 'pending', 'blocked']).toContain(step.state);
      expect(typeof step.detail).toBe('string');
    }
  });
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4a: activation checklist on GET /participants/me (655)', () => {
  let pool;
  let creditCtrl;
  let app;
  let admin;

  beforeAll(async () => {
    pool = require('../db');
    creditCtrl = require('../controllers/oxsteedCreditController');
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
  const getMe = (user) => request(app)
    .get('/api/oxsteed-credit/participants/me')
    .set('Authorization', `Bearer ${tokenFor(user)}`);

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

  // An open maker-checker activation request filed by a maker admin.
  async function seedOpenApproval(participantId) {
    await pool.query(
      `INSERT INTO oxsteed_credit_pending_actions (action_type, payload, requested_by, status, expires_at, idempotency_key)
       VALUES ('credit_participant_activation', jsonb_build_object('participantId', $1::text), $2, 'pending', NOW() + INTERVAL '7 days', $3)`,
      [String(participantId), admin.id, crypto.randomUUID()],
    );
  }

  const checklistById = (participant) => Object.fromEntries(
    (participant.activationChecklist || []).map((s) => [s.id, s]),
  );

  test('652 re-check: helper application shows pending status on GET me', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    await seedParticipant({ participantType: 'helper', userId: user.id });

    const me = await getMe(user);
    expect(me.status).toBe(200);
    expect(me.body.participants).toHaveLength(1);
    expect(me.body.participants[0]).toMatchObject({ participantType: 'helper', status: 'pending' });
  });

  test('655: pending + unverified checklist is live on GET me', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    await seedParticipant({ participantType: 'helper', userId: user.id });

    const me = await getMe(user);
    expect(me.status).toBe(200);
    const steps = checklistById(me.body.participants[0]);
    expect(steps.application).toEqual({ id: 'application', state: 'done', detail: 'submitted' });
    expect(steps.identity).toEqual({ id: 'identity', state: 'pending', detail: 'awaiting_verification' });
    expect(steps.approval).toEqual({ id: 'approval', state: 'blocked', detail: 'needs_verification' });
  });

  test('655: verified + approval requested shows the checker wait', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    const participant = await seedParticipant({ participantType: 'helper', userId: user.id, diditVerified: true });
    await seedOpenApproval(participant.id);

    const me = await getMe(user);
    expect(me.status).toBe(200);
    const steps = checklistById(me.body.participants[0]);
    expect(steps.identity).toEqual({ id: 'identity', state: 'done', detail: 'verified' });
    expect(steps.approval).toEqual({ id: 'approval', state: 'pending', detail: 'approval_requested' });
  });

  test('655: verified without an open request awaits review, not a checker', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    await seedParticipant({ participantType: 'helper', userId: user.id, diditVerified: true });

    const me = await getMe(user);
    expect(me.status).toBe(200);
    expect(checklistById(me.body.participants[0]).approval)
      .toEqual({ id: 'approval', state: 'pending', detail: 'awaiting_review' });
  });

  test('655: active participant shows every step done', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    await seedParticipant({ participantType: 'helper', userId: user.id, status: 'active', diditVerified: true });

    const me = await getMe(user);
    expect(me.status).toBe(200);
    const steps = checklistById(me.body.participants[0]);
    expect(Object.values(steps).map((s) => s.state)).toEqual(['done', 'done', 'done']);
    expect(steps.approval).toEqual({ id: 'approval', state: 'done', detail: 'approved' });
  });

  test('655: suspended participant shows identity and approval blocked', async () => {
    const user = await makeUser();
    await pool.query('INSERT INTO helper_profiles (user_id) VALUES ($1)', [user.id]);
    await seedParticipant({ participantType: 'helper', userId: user.id, status: 'suspended', diditVerified: true });

    const me = await getMe(user);
    expect(me.status).toBe(200);
    const steps = checklistById(me.body.participants[0]);
    expect(steps.identity).toEqual({ id: 'identity', state: 'blocked', detail: 'closed' });
    expect(steps.approval).toEqual({ id: 'approval', state: 'blocked', detail: 'closed' });
  });

  test('655: a viewer sees only their own record and checklist', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { rows } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner.id, 'Fixture Business'],
    );
    await seedParticipant({ participantType: 'business', businessId: rows[0].id, diditVerified: true });

    const ownerMe = await getMe(owner);
    expect(ownerMe.status).toBe(200);
    expect(ownerMe.body.participants).toHaveLength(1);
    expect(ownerMe.body.participants[0].activationChecklist).toHaveLength(3);

    const otherMe = await getMe(other);
    expect(otherMe.status).toBe(200);
    expect(otherMe.body.participants).toEqual([]);
  });

  test('655: a plain customer with no application sees an empty list', async () => {
    const user = await makeUser();
    const me = await getMe(user);
    expect(me.status).toBe(200);
    expect(me.body.participants).toEqual([]);
  });
});
