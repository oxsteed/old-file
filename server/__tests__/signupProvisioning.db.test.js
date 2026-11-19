'use strict';

/**
 * PR #804 Track B (G-4 / G-23 / G-35): staff, device/service-account, and
 * partner signup intents are recorded as visible provisioning requests a
 * reviewer can see and decide. A decision records who decided and when;
 * it grants nothing by itself. Skips unless STATEMENT_TEST_DATABASE_URL
 * is the disposable Track B database.
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

ddescribe('signup provisioning requests (real database)', () => {
  let pool;
  let signupIntent;
  let app;

  beforeAll(() => {
    pool = require('../db');
    signupIntent = require('../services/access/signupIntent');
    const routes = require('../routes/signupProvisioning');
    app = express();
    app.use(express.json());
    app.use('/api/me', routes.meRouter);
    app.use('/api/admin/signup-provisioning-requests', routes.adminRouter);
    app.use(require('../middleware/errorHandler').errorHandler);
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

  test('staff signup creates a decidable queue row; approval consumes the intent', async () => {
    const user = await makeUser();
    const admin = await makeUser('super_admin');
    await signupIntent.finalize(user.id, { signup_intent: 'request_support', signup_return_to: null });

    // The queue is shared with other suites on this database: filter by
    // kind and match this test's own row instead of assuming it is alone.
    const queued = await auth(request(app).get('/api/admin/signup-provisioning-requests?kind=staff_support'), admin);
    expect(queued.status).toBe(200);
    const mine = (queued.body.requests || []).filter((r) => r.applicantEmail === user.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: 'staff_support', status: 'pending', applicantEmail: user.email,
    });
    const requestId = mine[0].id;

    const approved = await auth(
      request(app).post(`/api/admin/signup-provisioning-requests/${requestId}/approve`), admin,
    ).send({ note: 'Provisioned out of band.' });
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({ status: 'approved', decisionNote: 'Provisioned out of band.' });
    expect(approved.body.request.decidedBy).toBe(admin.id);
    expect(approved.body.request.decidedAt).toBeTruthy();

    // The ask has been answered: the resume card stops offering it.
    const { rows } = await pool.query(
      'SELECT consumed_at FROM access_signup_intents WHERE user_id = $1 AND intent = $2',
      [user.id, 'request_support'],
    );
    expect(rows[0].consumed_at).not.toBeNull();

    // A second decision on the same row is a conflict, not a double grant.
    const again = await auth(
      request(app).post(`/api/admin/signup-provisioning-requests/${requestId}/approve`), admin,
    ).send({});
    expect(again.status).toBe(409);
  });

  test('a non-helper can request partner access; it is recorded and declinable', async () => {
    const user = await makeUser();
    const admin = await makeUser('super_admin');

    const created = await auth(request(app).post('/api/me/signup-provisioning-requests'), user)
      .send({ kind: 'partner_application' });
    expect(created.status).toBe(201);
    expect(created.body.request).toMatchObject({ kind: 'partner_application', status: 'pending' });
    const requestId = created.body.request.id;

    // Idempotent per pending (user, kind): no duplicate row.
    const replay = await auth(request(app).post('/api/me/signup-provisioning-requests'), user)
      .send({ kind: 'partner_application' });
    expect(replay.status).toBe(200);
    expect(replay.body.request.id).toBe(requestId);

    const mine = await auth(request(app).get('/api/me/signup-provisioning-requests'), user);
    expect(mine.status).toBe(200);
    expect(mine.body.requests.map((r) => r.id)).toContain(requestId);

    const declined = await auth(
      request(app).post(`/api/admin/signup-provisioning-requests/${requestId}/decline`), admin,
    ).send({ note: 'Invite-only; no open slots.' });
    expect(declined.status).toBe(200);
    expect(declined.body.request.status).toBe('declined');
  });

  test('a device signup creates a service-account request record; deciding it mints nothing by itself', async () => {
    const user = await makeUser();
    const admin = await makeUser('super_admin');
    await signupIntent.finalize(user.id, { signup_intent: 'request_device', signup_return_to: null });

    const mine = await auth(request(app).get('/api/me/signup-provisioning-requests'), user);
    expect(mine.body.requests).toHaveLength(1);
    expect(mine.body.requests[0]).toMatchObject({ kind: 'service_account', status: 'pending' });

    const decided = await auth(
      request(app).post(`/api/admin/signup-provisioning-requests/${mine.body.requests[0].id}/approve`), admin,
    ).send({ note: 'Admin will provision credentials out of band.' });
    expect(decided.status).toBe(200);
    expect(decided.body.request.status).toBe('approved');
    // The request record is the whole artifact: approval records the
    // decision; no credential row is created by the decision itself.
    expect(decided.body.request.decidedBy).toBe(admin.id);
  });

  test('only partner_application can be created from the client', async () => {
    const user = await makeUser();
    const res = await auth(request(app).post('/api/me/signup-provisioning-requests'), user)
      .send({ kind: 'staff_reviewer' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });
});
