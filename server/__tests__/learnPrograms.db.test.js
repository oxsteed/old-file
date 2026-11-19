'use strict';

/**
 * PR #804 Track B (G-24): /learn gains a minimal program record:
 * program -> enrollment -> completion, where completion is derived from
 * finishing every guide in the program's category, never self-declared.
 * Enrollment grants no guide-submission authority. Skips unless
 * STATEMENT_TEST_DATABASE_URL is the disposable Track B database.
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

const HELPER_GUIDES = [
  'write-a-winning-bid',
  'build-your-reputation',
  'set-your-service-rates',
  'get-your-first-review',
  'create-a-service-package',
  'manage-helper-calendar',
  'use-qr-codes-to-win-offline-leads',
];

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

ddescribe('learn programs and enrollments (real database)', () => {
  let pool;
  let learnCtrl;
  let signupIntent;
  let app;

  beforeAll(() => {
    pool = require('../db');
    learnCtrl = require('../controllers/learnController');
    signupIntent = require('../services/access/signupIntent');
    app = express();
    app.use(express.json());
    app.use('/api/learn', require('../routes/learn'));
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
  const nextThrower = (err) => { throw err; };

  test('programs list publicly with per-program progress', async () => {
    const res = fakeRes();
    await learnCtrl.listPrograms({ user: null }, res, nextThrower);
    expect(res.statusCode).toBe(200);
    expect(res.body.programs.map((p) => p.slug).sort()).toEqual([
      'customer-service-essentials', 'helper-foundations', 'workforce-management',
    ]);
    const helper = res.body.programs.find((p) => p.slug === 'helper-foundations');
    expect(helper.category).toBe('helper');
    expect(helper.totalGuides).toBe(HELPER_GUIDES.length);
    expect(helper.completedGuides).toBe(0);
  });

  test('enroll, re-enroll idempotently, and complete by finishing every guide', async () => {
    const user = await makeUser();
    await signupIntent.finalize(user.id, { signup_intent: 'join_workforce', signup_return_to: null });

    const first = fakeRes();
    await learnCtrl.enrollInProgram({ user: { id: user.id }, params: { slug: 'helper-foundations' } }, first, nextThrower);
    expect(first.statusCode).toBe(201);
    expect(first.body.enrollment).toMatchObject({ programSlug: 'helper-foundations', status: 'enrolled' });

    // Enrolling consumes the workforce handoff.
    const { rows: intentRows } = await pool.query(
      'SELECT consumed_at FROM access_signup_intents WHERE user_id = $1 AND intent = $2',
      [user.id, 'join_workforce'],
    );
    expect(intentRows[0].consumed_at).not.toBeNull();

    const again = fakeRes();
    await learnCtrl.enrollInProgram({ user: { id: user.id }, params: { slug: 'helper-foundations' } }, again, nextThrower);
    expect(again.statusCode).toBe(200);
    expect(again.body.enrollment.id).toBe(first.body.enrollment.id);

    // Completing all but one guide leaves the enrollment open.
    for (const guideId of HELPER_GUIDES.slice(0, -1)) {
      const done = fakeRes();
      await learnCtrl.recordCompletion(
        { user: { id: user.id }, body: { guide_id: guideId, difficulty: 'Easy' } },
        done, nextThrower,
      );
      expect(done.statusCode).toBe(200);
      expect(done.body.success).toBe(true);
    }
    const mid = fakeRes();
    await learnCtrl.listMyEnrollments({ user: { id: user.id } }, mid, nextThrower);
    expect(mid.body.enrollments[0].status).toBe('enrolled');

    // The last guide completes the enrollment (derived, never declared).
    const last = fakeRes();
    await learnCtrl.recordCompletion(
      { user: { id: user.id }, body: { guide_id: HELPER_GUIDES[HELPER_GUIDES.length - 1], difficulty: 'Easy' } },
      last, nextThrower,
    );
    expect(last.statusCode).toBe(200);
    expect(last.body.badge_awarded).toBe('helper');

    const after = fakeRes();
    await learnCtrl.listMyEnrollments({ user: { id: user.id } }, after, nextThrower);
    expect(after.body.enrollments[0]).toMatchObject({
      programSlug: 'helper-foundations', status: 'completed',
      totalGuides: HELPER_GUIDES.length, completedGuides: HELPER_GUIDES.length,
    });
    expect(after.body.enrollments[0].completedAt).toBeTruthy();
  });

  test('enrolling in an unknown program is a 404', async () => {
    const user = await makeUser();
    let caught = null;
    await learnCtrl.enrollInProgram(
      { user: { id: user.id }, params: { slug: 'no-such-program' } },
      fakeRes(),
      (err) => { caught = err; },
    );
    expect(caught).not.toBeNull();
    expect(caught.status).toBe(404);
    expect(caught.code).toBe('program_not_found');
  });

  test('enrollment grants no guide-submission authority', async () => {
    const user = await makeUser();
    const enrolled = await auth(
      request(app).post('/api/learn/programs/helper-foundations/enroll'), user,
    ).send({});
    expect([200, 201]).toContain(enrolled.status);

    const submitted = await auth(request(app).post('/api/learn/submissions'), user)
      .send({
        title: 'Fixture guide', category: 'helper', difficulty: 'Easy',
        intro: 'A fixture intro for the gate test.',
        steps: ['First step', 'Second step'],
      });
    expect(submitted.status).toBe(403);
  });

  test('program routes are mounted: public list and authed enroll', async () => {
    const listed = await request(app).get('/api/learn/programs');
    expect(listed.status).toBe(200);
    expect(listed.body.programs).toHaveLength(3);

    const user = await makeUser();
    const enrolled = await auth(
      request(app).post('/api/learn/programs/workforce-management/enroll'), user,
    ).send({});
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.enrollment.programSlug).toBe('workforce-management');

    const mine = await auth(request(app).get('/api/learn/enrollments/mine'), user);
    expect(mine.status).toBe(200);
    expect(mine.body.enrollments.map((e) => e.programSlug)).toContain('workforce-management');
  });
});
