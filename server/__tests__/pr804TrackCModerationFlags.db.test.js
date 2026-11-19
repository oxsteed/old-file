'use strict';

// R-6 (PR #804 Track C): the moderation-flags reader endpoints existed
// (GET /api/admin/moderation-flags, POST .../review) but no admin UI ever
// called them, so mobile content flags were write-only. This pins the
// contract the new Content Flags tab on /admin/moderation consumes:
// list shape, status filter, and the pending-only review rule.
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('Refusing to run: STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

const crypto = require('crypto');
const pool = require('../db');
const { listContentFlags, reviewContentFlag } = require('../controllers/moderationController');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

describe('R-6 moderation-flags queue contract', () => {
  let reporterId;
  let adminId;
  let pendingJsonId;
  let pendingPlainId;
  let resolvedId;
  let baselinePending = 0;
  let baselineResolved = 0;

  beforeAll(async () => {
    const { rows: counts } = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM moderation_queue WHERE status IN ('pending', 'resolved') GROUP BY status`
    );
    for (const row of counts) {
      if (row.status === 'pending') baselinePending = Number(row.n);
      if (row.status === 'resolved') baselineResolved = Number(row.n);
    }
    reporterId = crypto.randomUUID();
    adminId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $3, 'x', 'Rita', 'Reporter', 'customer'),
              ($2, $4, 'x', 'Amy', 'Admin', 'admin')`,
      [reporterId, adminId, `r6-reporter-${reporterId.slice(0, 8)}@example.invalid`, `r6-admin-${adminId.slice(0, 8)}@example.invalid`]
    );
    const insert = async (type, targetId, targetType, reason, status, priority) => {
      const { rows } = await pool.query(
        `INSERT INTO moderation_queue (type, target_id, target_type, reported_by, reason, status, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [type, targetId, targetType, reporterId, reason, status, priority]
      );
      return Number(rows[0].id);
    };
    pendingJsonId = await insert(
      'content_flag', 'chat:1', 'content',
      JSON.stringify({ text: 'send gift card to this number', locale: 'en', source: 'ios' }),
      'pending', 'high'
    );
    pendingPlainId = await insert(
      'user_report', 'user-9', 'user', 'Repeated harassment in messages', 'pending', 'normal'
    );
    resolvedId = await insert(
      'content_flag', 'chat:2', 'content',
      JSON.stringify({ text: '100% free money, wire transfer only', locale: 'en', source: 'ios' }),
      'resolved', 'urgent'
    );
    await pool.query(
      `UPDATE moderation_queue SET resolution = 'Confirmed scam wording', resolved_by = $2, resolved_at = NOW() WHERE id = $1`,
      [resolvedId, adminId]
    );
  });

  afterAll(async () => { await pool.end(); });

  test('list returns pending flags with the reporter joined', async () => {
    const res = fakeRes();
    await listContentFlags({ query: { status: 'pending', limit: 100 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(baselinePending + 2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(100);
    const ids = res.body.flags.map((f) => f.id);
    expect(ids).toContain(pendingJsonId);
    expect(ids).toContain(pendingPlainId);
    const jsonFlag = res.body.flags.find((f) => f.id === pendingJsonId);
    expect(jsonFlag.reporter_first).toBe('Rita');
    expect(jsonFlag.reporter_email).toBe(`r6-reporter-${reporterId.slice(0, 8)}@example.invalid`);
    expect(jsonFlag.priority).toBe('high');
  });

  test('list filters by status', async () => {
    const res = fakeRes();
    await listContentFlags({ query: { status: 'resolved', limit: 100 } }, res);
    expect(res.body.total).toBe(baselineResolved + 1);
    const resolved = res.body.flags.find((f) => f.id === resolvedId);
    expect(resolved).toBeTruthy();
    expect(resolved.resolution).toBe('Confirmed scam wording');
  });

  test('list rejects an unknown status', async () => {
    const res = fakeRes();
    await listContentFlags({ query: { status: 'bogus' } }, res);
    expect(res.statusCode).toBe(400);
  });

  test('review resolves a pending flag and records the resolver', async () => {
    const res = fakeRes();
    await reviewContentFlag(
      { params: { id: String(pendingPlainId) }, body: { decision: 'resolved', resolution: 'Reviewed: harassment confirmed' }, user: { id: adminId } },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.flag.status).toBe('resolved');
    expect(res.body.flag.id).toBe(pendingPlainId);
    const { rows } = await pool.query(
      `SELECT status, resolution, resolved_by FROM moderation_queue WHERE id = $1`, [pendingPlainId]
    );
    expect(rows[0].status).toBe('resolved');
    expect(rows[0].resolution).toBe('Reviewed: harassment confirmed');
    expect(String(rows[0].resolved_by)).toBe(adminId);
  });

  test('review refuses a second decision on the same flag', async () => {
    const res = fakeRes();
    await reviewContentFlag(
      { params: { id: String(pendingPlainId) }, body: { decision: 'dismissed' }, user: { id: adminId } },
      res
    );
    expect(res.statusCode).toBe(409);
  });

  test('review rejects an unknown decision and an unknown flag', async () => {
    const badDecision = fakeRes();
    await reviewContentFlag(
      { params: { id: String(pendingJsonId) }, body: { decision: 'escalate' }, user: { id: adminId } },
      badDecision
    );
    expect(badDecision.statusCode).toBe(400);
    const missing = fakeRes();
    await reviewContentFlag(
      { params: { id: '999999999' }, body: { decision: 'resolved' }, user: { id: adminId } },
      missing
    );
    expect(missing.statusCode).toBe(404);
  });
});
