'use strict';

// Group 1 checkpoint 1 (N11): the fund endpoint honors an idempotency key.
//
// POST /api/planned-needs/:id/fund only increments reserved_amount; it
// moves no money. Before this checkpoint it took no idempotency key and the
// client had no in-flight guard, so a double-click (or a retried request
// after a lost response) double-incremented reserved_amount.
//
// Runs against a dedicated fresh database (credit_statement_test_g1ckpt1)
// so checkpoint fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.G1_CKPT1_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g1ckpt1') {
    throw new Error('Group 1 checkpoint 1 DB tests require the loopback credit_statement_test_g1ckpt1 database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: 'customer',
      email: req.get('x-test-email') || `g1ckpt1-${id}@example.invalid`,
      email_verified: true,
    };
    return next();
  };
  return {
    authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 1 checkpoint 1: planned-needs fund idempotency (N11)', () => {
  let db;
  let app;

  beforeAll(async () => {
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/planned-needs', require('../routes/plannedNeeds'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });

  afterAll(async () => { await db?.end(); });

  async function addUser() {
    const id = randomUUID();
    const email = `g1ckpt1-${id}@example.invalid`;
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Checkpoint', 'Fixture', 'customer', 'customer', TRUE, TRUE, TRUE, 'pending', NULL)`,
      [id, email],
    );
    return { id, email };
  }

  async function makeNeed(user, { estimatedCost = 100, reservedAmount = 0 } = {}) {
    const { rows: [need] } = await db.query(
      `INSERT INTO planned_needs (user_id, title, category, status, due_date, estimated_cost, reserved_amount)
       VALUES ($1, 'Boiler service', 'other', 'planned', '2027-06-01', $2, $3)
       RETURNING id`,
      [user.id, estimatedCost, reservedAmount],
    );
    return need.id;
  }

  async function reservedAmount(needId) {
    const { rows: [row] } = await db.query(
      'SELECT reserved_amount FROM planned_needs WHERE id = $1',
      [needId],
    );
    return Number(row.reserved_amount);
  }

  function fund(needId, user, { amount, key } = {}) {
    const req = request(app)
      .post(`/api/planned-needs/${needId}/fund`)
      .set('x-test-user', user.id)
      .send({ amount });
    if (key) req.set('Idempotency-Key', key);
    return req;
  }

  test('a replayed key increments only once and returns the original result', async () => {
    const user = await addUser();
    const needId = await makeNeed(user);
    const key = randomUUID();

    const first = await fund(needId, user, { amount: 25, key }).expect(200);
    expect(Number(first.body.reserved_amount)).toBe(25);

    const replay = await fund(needId, user, { amount: 25, key }).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(await reservedAmount(needId)).toBe(25);
  });

  test('the same key with a different amount is a 422 and changes nothing', async () => {
    const user = await addUser();
    const needId = await makeNeed(user);
    const key = randomUUID();

    await fund(needId, user, { amount: 25, key }).expect(200);
    const mismatch = await fund(needId, user, { amount: 40, key }).expect(422);
    expect(mismatch.body.code).toBe('idempotency_key_reused');
    expect(await reservedAmount(needId)).toBe(25);
  });

  test('a different key increments again (dedupe scope is per need + key)', async () => {
    const user = await addUser();
    const needId = await makeNeed(user);

    await fund(needId, user, { amount: 25, key: randomUUID() }).expect(200);
    await fund(needId, user, { amount: 25, key: randomUUID() }).expect(200);
    expect(await reservedAmount(needId)).toBe(50);
  });

  test('a non-UUID key is a 400 and changes nothing', async () => {
    const user = await addUser();
    const needId = await makeNeed(user);

    const bad = await fund(needId, user, { amount: 25, key: 'not-a-uuid' }).expect(400);
    expect(bad.body.code).toBe('validation_failed');
    expect(await reservedAmount(needId)).toBe(0);
  });

  test('an unkeyed request still funds (key is optional, as in openDispute)', async () => {
    const user = await addUser();
    const needId = await makeNeed(user);

    const res = await fund(needId, user, { amount: 10 }).expect(200);
    expect(Number(res.body.reserved_amount)).toBe(10);
    expect(await reservedAmount(needId)).toBe(10);
  });
});
