'use strict';

/**
 * Behavior tests for the in-statement dispute follow-up messaging API
 * (capability 9b): GET/POST /api/statements/disputes/:disputeId/messages.
 *
 * These tests run against the disposable `credit_statement_test` database
 * only. The local database cannot run the full migration chain (no
 * PostGIS), so beforeAll applies the REAL migration file this workstream
 * needs (871) plus the audit-events table DDL extracted verbatim from
 * migration 421 (which cannot be applied wholesale here). All statements
 * are idempotent, so the same setup also passes against a fully migrated
 * CI database.
 *
 * The real JWT auth middleware cannot run here, so `../middleware/auth`
 * is stubbed with the same contract: req.user = { id, role } from the
 * x-test-user-id / x-test-user-role headers. Record-level authorization
 * (dispute owner or admin) is implemented in the router under test and is
 * what these tests exercise.
 *
 * Run with e.g.
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/disputeMessaging.test.js --forceExit
 * Without it, the DB tests skip (fail closed) instead of touching a DB.
 */

jest.unmock('pg');

const fs = require('fs');
const path = require('path');
const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('STATEMENT_DISPUTE_MESSAGING_TEST_DATABASE_URL');

const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('disputeMessaging DB tests skipped: set STATEMENT_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const userId = req.headers['x-test-user-id'];
    const role = req.headers['x-test-user-role'] || 'customer';
    if (!userId) return res.status(401).json({ error: 'No token provided' });
    req.user = { id: userId, role };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  },
}));

jest.setTimeout(60000);

ddescribe('dispute messaging (disposable DB)', () => {
  const express = require('express');
  const request = require('supertest');
  const crypto = require('crypto');
  const pool = require('../db');

  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/statementDisputeMessages'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code, error: err.message }));

  const as = (id, role = 'customer') => ({ 'x-test-user-id': id, 'x-test-user-role': role });
  const messagesUrl = (disputeId) => `/api/statements/disputes/${disputeId}/messages`;

  // Applies the audit-events table DDL verbatim from migration 421. The full
  // 421 file cannot run here (foundation tables this partial database does
  // not have), so the table plus its three indexes are extracted from the
  // real migration text so the schema cannot drift.
  async function applyAuditEventsDdl() {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '421_oxsteed_credit_foundation.sql'), 'utf8');
    const table = sql.match(/CREATE TABLE IF NOT EXISTS oxsteed_credit_audit_events \([\s\S]*?\);\n/);
    const indexes = [...sql.matchAll(/CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_\w+[\s\S]*?;\n/g)];
    if (!table || indexes.length !== 3) throw new Error('421 audit DDL extraction failed');
    await pool.query(table[0]);
    for (const index of indexes) await pool.query(index[0]);
  }

  async function ensureSchema() {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '871_dispute_messages.sql'), 'utf8');
    await pool.query(sql);
    await applyAuditEventsDdl();
  }

  async function createUser(role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'synthetic', 'Stmt', 'Fixture', $3, TRUE)`,
      [id, `${id}@example.invalid`, role]);
    return id;
  }

  async function createDispute(customerId) {
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO oxsteed_credit_disputes (id, customer_id) VALUES ($1, $2)',
      [id, customerId]
    );
    return id;
  }

  async function readDisputeRow(disputeId) {
    const { rows } = await pool.query('SELECT * FROM oxsteed_credit_disputes WHERE id = $1', [disputeId]);
    return rows[0];
  }

  beforeAll(async () => {
    await ensureSchema();
  });

  test('owner can list (empty) and post; response matches the API contract', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);

    const empty = await request(app).get(messagesUrl(disputeId)).set(as(ownerId)).expect(200);
    expect(empty.body).toEqual({ messages: [] });

    const key = crypto.randomUUID();
    const posted = await request(app)
      .post(messagesUrl(disputeId))
      .set(as(ownerId))
      .send({
        message: 'The charge on Sep 12 was not mine.',
        evidenceText: 'Receipt from the restaurant',
        evidenceFileUrl: '/api/storage/public/u123/statement-note/receipt.png',
        idempotencyKey: key,
      })
      .expect(201);
    expect(posted.body.replayed).toBe(false);
    const m = posted.body.message;
    expect(m).toMatchObject({
      disputeId,
      authorId: ownerId,
      authorRole: 'customer',
      message: 'The charge on Sep 12 was not mine.',
      evidenceText: 'Receipt from the restaurant',
      evidenceFileUrl: '/api/storage/public/u123/statement-note/receipt.png',
    });
    expect(typeof m.id).toBe('string');
    expect(typeof m.createdAt).toBe('string');
    // Exact contract keys, nothing more.
    expect(Object.keys(m).sort()).toEqual(
      ['authorId', 'authorRole', 'createdAt', 'disputeId', 'evidenceFileUrl', 'evidenceText', 'id', 'message'].sort()
    );

    const listed = await request(app).get(messagesUrl(disputeId)).set(as(ownerId)).expect(200);
    expect(listed.body.messages).toHaveLength(1);
    expect(listed.body.messages[0]).toEqual(m);
  });

  test('messages list in chronological order', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);
    for (const text of ['first', 'second', 'third']) {
      await request(app).post(messagesUrl(disputeId)).set(as(ownerId))
        .send({ message: text, idempotencyKey: crypto.randomUUID() })
        .expect(201);
    }
    const listed = await request(app).get(messagesUrl(disputeId)).set(as(ownerId)).expect(200);
    expect(listed.body.messages.map((m) => m.message)).toEqual(['first', 'second', 'third']);
  });

  test('unauthorized users get indistinguishable 404s on GET and POST', async () => {
    const ownerId = await createUser('customer');
    const intruderId = await createUser('customer');
    const disputeId = await createDispute(ownerId);

    await request(app).get(messagesUrl(disputeId)).expect(401);
    await request(app).get(messagesUrl(disputeId)).set(as(intruderId)).expect(404);
    await request(app)
      .post(messagesUrl(disputeId))
      .set(as(intruderId))
      .send({ message: 'hi', idempotencyKey: crypto.randomUUID() })
      .expect(404);

    // A helper (non-owner, non-admin) is also 404, not 403.
    const helperId = await createUser('helper');
    await request(app).get(messagesUrl(disputeId)).set(as(helperId, 'helper')).expect(404);

    // Unknown dispute ids are 404 too (indistinguishable from unauthorized).
    await request(app).get(messagesUrl(crypto.randomUUID())).set(as(ownerId)).expect(404);
    await request(app)
      .post(messagesUrl(crypto.randomUUID()))
      .set(as(ownerId))
      .send({ message: 'hi', idempotencyKey: crypto.randomUUID() })
      .expect(404);

    // Malformed ids are 404 as well.
    await request(app).get(messagesUrl('not-a-uuid')).set(as(ownerId)).expect(404);
  });

  test('admin can list and post on a dispute they do not own', async () => {
    const ownerId = await createUser('customer');
    const adminId = await createUser('admin');
    const disputeId = await createDispute(ownerId);

    const listed = await request(app).get(messagesUrl(disputeId)).set(as(adminId, 'admin')).expect(200);
    expect(listed.body.messages).toEqual([]);

    const posted = await request(app)
      .post(messagesUrl(disputeId))
      .set(as(adminId, 'admin'))
      .send({ message: 'We are reviewing your case.', idempotencyKey: crypto.randomUUID() })
      .expect(201);
    expect(posted.body.message.authorRole).toBe('admin');
    expect(posted.body.message.authorId).toBe(adminId);
  });

  test('idempotency: same key replays the original message', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);
    const key = crypto.randomUUID();
    const body = { message: 'Please look again.', idempotencyKey: key };

    const first = await request(app).post(messagesUrl(disputeId)).set(as(ownerId)).send(body).expect(201);
    expect(first.body.replayed).toBe(false);

    const second = await request(app).post(messagesUrl(disputeId)).set(as(ownerId)).send(body).expect(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.message.id).toBe(first.body.message.id);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM oxsteed_credit_dispute_messages WHERE dispute_id = $1',
      [disputeId]
    );
    expect(rows[0].n).toBe(1);
  });

  test('idempotency: same key with different details is a 409', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);
    const key = crypto.randomUUID();

    await request(app).post(messagesUrl(disputeId)).set(as(ownerId))
      .send({ message: 'Original message.', idempotencyKey: key })
      .expect(201);
    const conflict = await request(app).post(messagesUrl(disputeId)).set(as(ownerId))
      .send({ message: 'Different message.', idempotencyKey: key })
      .expect(409);
    expect(conflict.body.code).toBe('statement_dispute_idempotency_conflict');
  });

  test('posting a message never mutates the dispute row', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);
    const before = await readDisputeRow(disputeId);

    await request(app).post(messagesUrl(disputeId)).set(as(ownerId))
      .send({
        message: 'This must not change anything about the dispute.',
        evidenceText: 'some evidence',
        evidenceFileUrl: '/api/storage/public/u1/note/x.png',
        idempotencyKey: crypto.randomUUID(),
      })
      .expect(201);

    const after = await readDisputeRow(disputeId);
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
  });

  test('an audit event is written for each posted message', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);

    const posted = await request(app).post(messagesUrl(disputeId)).set(as(ownerId))
      .send({ message: 'Audited message.', idempotencyKey: crypto.randomUUID() })
      .expect(201);
    const messageId = posted.body.message.id;

    const { rows } = await pool.query(
      `SELECT action_type, actor_user_id, customer_id, resource_type, resource_id
         FROM oxsteed_credit_audit_events
        WHERE resource_type = 'credit_dispute_message' AND resource_id = $1`,
      [messageId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action_type).toBe('credit.dispute.message.posted');
    expect(String(rows[0].actor_user_id)).toBe(String(ownerId));
    expect(String(rows[0].customer_id)).toBe(String(ownerId));
  });

  test('validation rejects bad input', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);
    const post = (body) => request(app).post(messagesUrl(disputeId)).set(as(ownerId)).send(body);

    // Missing / empty message.
    await post({ idempotencyKey: crypto.randomUUID() }).expect(400);
    await post({ message: '   ', idempotencyKey: crypto.randomUUID() }).expect(400);

    // Message over 5000 chars.
    const tooLong = await post({ message: 'x'.repeat(5001), idempotencyKey: crypto.randomUUID() }).expect(400);
    expect(tooLong.body.code).toBe('statement_dispute_message_too_long');

    // Missing / malformed idempotency key (UUID format required).
    await post({ message: 'hello' }).expect(400);
    const badKey = await post({ message: 'hello', idempotencyKey: 'not-a-uuid' }).expect(400);
    expect(badKey.body.code).toBe('statement_dispute_idempotency_key_invalid');

    // Evidence text over 2000 chars.
    const badEvidence = await post({
      message: 'hello',
      evidenceText: 'y'.repeat(2001),
      idempotencyKey: crypto.randomUUID(),
    }).expect(400);
    expect(badEvidence.body.code).toBe('statement_dispute_evidence_text_too_long');

    // Evidence file URL: arbitrary hosts and javascript: URLs are rejected.
    await post({
      message: 'hello',
      evidenceFileUrl: 'https://evil.example/x.png',
      idempotencyKey: crypto.randomUUID(),
    }).expect(400);
    const badScheme = await post({
      message: 'hello',
      evidenceFileUrl: 'javascript:alert(1)',
      idempotencyKey: crypto.randomUUID(),
    }).expect(400);
    expect(badScheme.body.code).toBe('statement_dispute_evidence_url_invalid');

    // Signed download references are rejected (bearer-token laundering).
    await post({
      message: 'hello',
      evidenceFileUrl: '/api/storage/files/some-key?sig=abc',
      idempotencyKey: crypto.randomUUID(),
    }).expect(400);

    // Nothing was stored by the rejected posts.
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM oxsteed_credit_dispute_messages WHERE dispute_id = $1',
      [disputeId]
    );
    expect(rows[0].n).toBe(0);
  });

  test('rate limiting triggers after ~10 messages per minute per user', async () => {
    const ownerId = await createUser('customer');
    const disputeId = await createDispute(ownerId);
    const post = (n) => request(app)
      .post(messagesUrl(disputeId))
      .set(as(ownerId))
      .send({ message: `rate test ${n}`, idempotencyKey: crypto.randomUUID() });

    for (let n = 0; n < 10; n++) {
      await post(n).expect(201);
    }
    const limited = await post(10).expect(429);
    expect(limited.body.error).toMatch(/too many/i);
  });
});
