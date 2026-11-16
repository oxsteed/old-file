'use strict';

/**
 * Progressive account access — PostgreSQL + mounted-route evidence for the
 * request lifecycle, review authority, grants, projection and concurrency
 * (WP-010, WP-011, WP-012, WP-014; AC cases listed in PROGRESS.md).
 *
 * Skips unless ACCESS_TEST_DATABASE_URL is a loopback disposable database
 * (credit_statement_test or pa_tN) that has been migrated.
 */

jest.unmock('pg');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ACCESS_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname);
  } catch { return false; }
}
if (RAW_URL && !isDisposableDb(RAW_URL)) throw new Error('Progressive access DB tests require a loopback disposable database');
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.LOG_LEVEL = 'error';
}
process.env.ACCESS_REQUESTS_ENABLED = 'true';
process.env.ACCESS_PROJECTION_ENABLED = 'true';

const mockUsers = new Map();
function mockFakeAuth(req, res, next) {
  const id = req.get('x-test-user');
  const u = id && mockUsers.get(id);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { ...u };
  return next();
}
jest.mock('../middleware/auth', () => ({
  authenticate: (...a) => mockFakeAuth(...a),
  requireAuth: (...a) => mockFakeAuth(...a),
  optionalAuth: (req, res, next) => (req.get('x-test-user') ? mockFakeAuth(req, res, next) : next()),
}));
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, res, next) => mockFakeAuth(req, res, () => {
      if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
      req.isSuper = req.user.role === 'super_admin';
      return next();
    }),
  };
});

jest.setTimeout(120000);

const HELPER_ANSWERS = { serviceCategories: ['plumbing'], serviceArea: { country: 'US', region: 'OH', city: 'Springfield' } };

ddescribe('progressive access (real database, mounted routes)', () => {
  let pool;
  let app;

  async function newUser(label, { role = 'customer', mode = 'customer' } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', $4, $5, TRUE, TRUE)`,
      [id, `pa-${label}-${id}@example.invalid`, label, role, mode],
    );
    mockUsers.set(id, { id, role });
    return id;
  }
  async function grantAdminPerm(adminId, perm, grantorId) {
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at)
       VALUES ($1, $2, $3::jsonb, NOW() + INTERVAL '1 day')`,
      [grantorId, adminId, JSON.stringify([perm])],
    );
  }
  const as = (userId) => ({
    get: (url) => request(app).get(url).set('x-test-user', userId),
    post: (url, body = {}, key) => {
      const r = request(app).post(url).set('x-test-user', userId);
      if (key) r.set('Idempotency-Key', key);
      return r.send(body);
    },
    patch: (url, body = {}) => request(app).patch(url).set('x-test-user', userId).send(body),
  });
  const count = async (sql, params) => Number((await pool.query(sql, params)).rows[0].n);

  let superAdmin; let reviewer; let unpermittedAdmin; let investorReviewer;

  beforeAll(async () => {
    pool = require('../db');
    const routes = require('../routes/progressiveAccess');
    app = express();
    app.use(express.json());
    app.use('/api/me', routes.meRouter);
    app.use('/api/admin/access-requests', routes.adminRouter);
    superAdmin = await newUser('super', { role: 'super_admin', mode: 'customer' });
    reviewer = await newUser('reviewer', { role: 'admin' });
    unpermittedAdmin = await newUser('noperm', { role: 'admin' });
    investorReviewer = await newUser('invrev', { role: 'admin' });
    await grantAdminPerm(reviewer, 'review_access_requests', superAdmin);
    await grantAdminPerm(investorReviewer, 'review_investor_access', superAdmin);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('a new account is a customer with an empty request list (D1, AC-001)', async () => {
    const u = await newUser('fresh');
    const res = await as(u).get('/api/me/access');
    expect(res.status).toBe(200);
    expect(res.body.access.personal).toEqual(['customer']);
    expect(res.body.access.openRequestCount).toBe(0);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect((await as(u).get('/api/me/access-requests')).body.requests).toEqual([]);
  });

  test('full helper lifecycle: draft → submit → needs info → resubmit → approve adds capability in place (D2–D4)', async () => {
    const u = await newUser('helper-applicant');
    const before = (await as(u).get('/api/me/access')).body.access.version;

    const created = await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: { serviceCategories: ['plumbing'] }, source: 'in_context', returnTo: '/jobs/123?secret=1' }, 'create-key-0001');
    expect(created.status).toBe(201);
    const r = created.body.request;
    expect(r).toMatchObject({ status: 'draft', version: 1, availableActions: ['edit', 'submit', 'withdraw'], returnTo: '/jobs/123' });

    // Incomplete submission is rejected with field errors and nothing changes.
    const bad = await as(u).post(`/api/me/access-requests/${r.id}/submit`, { expectedVersion: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toMatchObject({ serviceArea: 'required' });

    const sub = await as(u).post(`/api/me/access-requests/${r.id}/submit`, { expectedVersion: 1, answers: { serviceArea: HELPER_ANSWERS.serviceArea } });
    expect(sub.status).toBe(200);
    expect(sub.body.request).toMatchObject({ status: 'submitted', version: 2, evidenceRevision: 2 });

    // Pending: still customer only; customer access continues.
    expect((await as(u).get('/api/me/access')).body.access.personal).toEqual(['customer']);

    const info = await as(reviewer).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'request_information', expectedVersion: 2, reasonCode: 'service_area_required', informationRequest: 'Add your ZIP code', note: 'internal only' });
    expect(info.status).toBe(200);
    const mine = await as(u).get(`/api/me/access-requests/${r.id}`);
    expect(mine.body.request).toMatchObject({ status: 'needs_information', publicReasonCode: 'service_area_required', informationRequest: 'Add your ZIP code' });
    expect(JSON.stringify(mine.body)).not.toContain('internal only');

    const resub = await as(u).post(`/api/me/access-requests/${r.id}/resubmit`, { expectedVersion: 3, answers: { serviceArea: { ...HELPER_ANSWERS.serviceArea, postalCode: '45501' } } });
    expect(resub.status).toBe(200);
    expect(resub.body.request.status).toBe('submitted');

    const approve = await as(reviewer).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 4, evidenceRevision: 3 });
    expect(approve.status).toBe(200);
    expect(approve.body.grantId).toBeTruthy();

    const after = (await as(u).get('/api/me/access')).body.access;
    expect(after.personal).toEqual(['customer', 'helper.offer_services']);
    expect(after.version).toBeGreaterThan(before);

    // Legacy authority untouched: no global role/mode mutation (D4).
    const { rows: [usr] } = await pool.query('SELECT role, default_mode FROM users WHERE id = $1', [u]);
    expect(usr).toEqual({ role: 'customer', default_mode: 'customer' });

    // Immutable history + one outbox event per notifying decision.
    expect(await count('SELECT COUNT(*) AS n FROM access_request_decisions WHERE request_id = $1', [r.id])).toBe(5);
    expect(await count("SELECT COUNT(*) AS n FROM access_outbox WHERE request_id = $1 AND event_type IN ('access_request.approved','access_request.needs_information')", [r.id])).toBe(2);
    await expect(pool.query('UPDATE access_request_decisions SET internal_note = NULL WHERE request_id = $1', [r.id])).rejects.toThrow(/append-only/);

    const hist = (await as(u).get(`/api/me/access-requests/${r.id}`)).body.history;
    expect(hist.map((h) => h.toStatus)).toEqual(['draft', 'submitted', 'needs_information', 'submitted', 'approved']);
  });

  test('idempotent create: same key replays, different payload is refused, second key conflicts (AC duplicate submit)', async () => {
    const u = await newUser('idem');
    const body = { capability: 'helper.offer_services', answers: HELPER_ANSWERS, submit: true };
    const a = await as(u).post('/api/me/access-requests', body, 'idem-key-00001');
    const b = await as(u).post('/api/me/access-requests', body, 'idem-key-00001');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body.request.id).toBe(a.body.request.id);
    const c = await as(u).post('/api/me/access-requests', { ...body, answers: { ...HELPER_ANSWERS, about: 'x' } }, 'idem-key-00001');
    expect(c.status).toBe(422);
    expect(c.body.code).toBe('idempotency_key_reused');
    const d = await as(u).post('/api/me/access-requests', body, 'idem-key-00002');
    expect(d.status).toBe(409);
    expect(d.body).toMatchObject({ code: 'request_already_open', requestId: a.body.request.id });
    expect(await count('SELECT COUNT(*) AS n FROM access_requests WHERE applicant_id = $1', [u])).toBe(1);
  });

  test('concurrent submissions from several tabs converge on one open request', async () => {
    const u = await newUser('tabs');
    const body = { capability: 'helper.offer_services', answers: HELPER_ANSWERS };
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => as(u).post('/api/me/access-requests', body, `tab-key-0000${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'request_already_open')).toBe(true);
    expect(await count('SELECT COUNT(*) AS n FROM access_requests WHERE applicant_id = $1', [u])).toBe(1);
  });

  test('competing reviewers: exactly one decision wins, the other gets a version conflict; one grant', async () => {
    const u = await newUser('compete');
    const r = (await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: HELPER_ANSWERS, submit: true })).body.request;
    const [x, y] = await Promise.all([
      as(reviewer).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 1 }),
      as(superAdmin).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'decline', expectedVersion: 1, reasonCode: 'policy_not_met' }),
    ]);
    const statuses = [x.status, y.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(['request_version_conflict', 'invalid_transition']).toContain(loser.body.code);
    expect(await count('SELECT COUNT(*) AS n FROM access_request_decisions WHERE request_id = $1', [r.id])).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM access_grants WHERE source_request_id = $1', [r.id])).toBeLessThanOrEqual(1);
  });

  test('review authority: unpermitted admin, applicant self-review, non-admin, wrong specialist permission (D6)', async () => {
    const u = await newUser('authz');
    const r = (await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: HELPER_ANSWERS, submit: true })).body.request;
    expect((await as(unpermittedAdmin).get('/api/admin/access-requests')).status).toBe(403);
    expect((await as(unpermittedAdmin).get(`/api/admin/access-requests/${r.id}`)).status).toBe(404);
    expect((await as(unpermittedAdmin).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 1 })).status).toBe(404);
    expect((await as(u).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 1 })).status).toBe(403);
    expect((await as(investorReviewer).get(`/api/admin/access-requests/${r.id}`)).status).toBe(404);
    const q = await as(investorReviewer).get('/api/admin/access-requests?status=open');
    expect(q.status).toBe(200);
    expect(q.body.capabilities).toEqual(['investor.reporting']);
    expect(q.body.requests.every((x) => x.capability === 'investor.reporting')).toBe(true);

    // A super admin applying for themselves cannot approve their own request.
    const own = (await as(superAdmin).post('/api/me/access-requests', { capability: 'consultant.accept_paying_clients', answers: { bio: 'b'.repeat(90), yearsExperience: 5, areasOfExpertise: ['ops'] }, submit: true })).body.request;
    const self = await as(superAdmin).post(`/api/admin/access-requests/${own.id}/decision`, { decision: 'approve', expectedVersion: 1 });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('self_review_forbidden');

    // Revoking the reviewer's permission takes effect on the next write.
    const tmp = await newUser('tmp-reviewer', { role: 'admin' });
    await grantAdminPerm(tmp, 'review_access_requests', superAdmin);
    expect((await as(tmp).get(`/api/admin/access-requests/${r.id}`)).status).toBe(200);
    await pool.query('UPDATE admin_permission_grants SET revoked_at = NOW() WHERE grantee_id = $1', [tmp]);
    expect((await as(tmp).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 1 })).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM access_grants WHERE source_request_id = $1", [r.id])).toBe(0);
  });

  test('applicants cannot read or change other people\'s requests (resource hiding)', async () => {
    const a = await newUser('owner-a');
    const b = await newUser('other-b');
    const r = (await as(a).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: HELPER_ANSWERS })).body.request;
    expect((await as(b).get(`/api/me/access-requests/${r.id}`)).status).toBe(404);
    expect((await as(b).post(`/api/me/access-requests/${r.id}/withdraw`, { expectedVersion: 1 })).status).toBe(404);
    expect((await as(b).patch(`/api/me/access-requests/${r.id}`, { expectedVersion: 1, answers: {} })).status).toBe(404);
  });

  test('stale version and invalid transitions are refused safely', async () => {
    const u = await newUser('stale');
    const r = (await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: {} })).body.request;
    const ok = await as(u).patch(`/api/me/access-requests/${r.id}`, { expectedVersion: 1, answers: { serviceCategories: ['tiling'] } });
    expect(ok.status).toBe(200);
    const stale = await as(u).patch(`/api/me/access-requests/${r.id}`, { expectedVersion: 1, answers: { serviceCategories: ['painting'] } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('request_version_conflict');
    expect(stale.body.current.version).toBe(2);
    const w = await as(u).post(`/api/me/access-requests/${r.id}/withdraw`, { expectedVersion: 2 });
    expect(w.body.request.status).toBe('withdrawn');
    expect((await as(u).post(`/api/me/access-requests/${r.id}/submit`, { expectedVersion: 3 })).body.code).toBe('invalid_transition');
    // A withdrawn request consumes nothing; a new application is allowed.
    expect((await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: {} })).status).toBe(201);
  });

  test('forged fields are rejected; non-requestable capabilities refused', async () => {
    const u = await newUser('forge');
    const res = await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: { role: 'admin' } });
    expect(res.status).toBe(400);
    expect(res.body.fields).toMatchObject({ role: 'unknown_field' });
    expect((await as(u).post('/api/me/access-requests', { capability: 'franchise.operate' })).status).toBe(403);
    expect((await as(u).post('/api/me/access-requests', { capability: 'admin' })).status).toBe(400);
    expect((await as(u).post('/api/me/access-requests', { capability: 'business.own', subject: { type: 'business', id: '999999999' } })).status).toBe(404);
  });

  test('revoke, suspend and reinstate change effective access on the next read without a new session (D4/D7)', async () => {
    const u = await newUser('revoke');
    const r = (await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: HELPER_ANSWERS, submit: true })).body.request;
    const { body: { grantId } } = await as(reviewer).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 1 });
    const list = await as(reviewer).get(`/api/admin/access-requests/users/${u}/grants`);
    expect(list.body.grants).toHaveLength(1);
    const sus = await as(reviewer).post(`/api/admin/access-requests/grants/${grantId}`, { action: 'suspend', expectedVersion: 1, reasonCode: 'policy_not_met' });
    expect(sus.status).toBe(200);
    expect((await as(u).get('/api/me/access')).body.access.personal).toEqual(['customer']);
    expect((await as(reviewer).post(`/api/admin/access-requests/grants/${grantId}`, { action: 'reinstate', expectedVersion: 2, reasonCode: 'review_complete' })).status).toBe(200);
    expect((await as(u).get('/api/me/access')).body.access.personal).toContain('helper.offer_services');
    expect((await as(reviewer).post(`/api/admin/access-requests/grants/${grantId}`, { action: 'revoke', expectedVersion: 2, reasonCode: 'policy_not_met' })).body.code).toBe('grant_version_conflict');
    expect((await as(reviewer).post(`/api/admin/access-requests/grants/${grantId}`, { action: 'revoke', expectedVersion: 3, reasonCode: 'policy_not_met' })).status).toBe(200);
    expect((await as(u).get('/api/me/access')).body.access.personal).toEqual(['customer']);
    expect(await count("SELECT COUNT(*) AS n FROM access_outbox WHERE grant_id = $1 AND event_type LIKE 'access_grant.%'", [grantId])).toBe(3);
  });

  test('outbox delivers once after commit, retries failures with backoff, never duplicates (WP-020)', async () => {
    const { processAccessOutbox, buildMessage } = require('../services/access/outboxWorker');
    // Drain anything earlier tests enqueued.
    await processAccessOutbox({ notify: async () => ({ success: true }) });
    const u = await newUser('outbox');
    await pool.query("UPDATE users SET preferred_language = 'ar' WHERE id = $1", [u]);
    const r = (await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services', answers: HELPER_ANSWERS, submit: true })).body.request;
    await as(reviewer).post(`/api/admin/access-requests/${r.id}/decision`, { decision: 'approve', expectedVersion: 1 });
    let calls = [];
    let fail = true;
    const flaky = async (msg) => { calls.push(msg); if (fail) throw new Error('smtp down'); return { success: true }; };
    const first = await processAccessOutbox({ notify: flaky });
    expect(first.failed).toBe(2);
    const { rows: pend } = await pool.query("SELECT status, attempts, last_error FROM access_outbox WHERE request_id = $1 ORDER BY id", [r.id]);
    expect(pend.every((p) => p.status === 'pending' && p.attempts === 1 && p.last_error === 'smtp down')).toBe(true);
    // Not due yet: nothing re-sent.
    calls = [];
    await processAccessOutbox({ notify: flaky });
    expect(calls.filter((c) => c.data.request_id === r.id)).toHaveLength(0);
    await pool.query("UPDATE access_outbox SET next_attempt_at = NOW() WHERE request_id = $1", [r.id]);
    fail = false;
    calls = [];
    const second = await processAccessOutbox({ notify: flaky });
    expect(second.sent).toBeGreaterThanOrEqual(2);
    const mine = calls.filter((c) => c.data.request_id === r.id);
    expect(mine.map((c) => c.data.event).sort()).toEqual(['access_request.approved', 'access_request.submitted']);
    expect(mine.every((c) => c.idempotencyKey.startsWith('access-outbox:') && c.action_url.startsWith('/settings/applications'))).toBe(true);
    expect(mine.find((c) => c.data.event === 'access_request.approved').title).toBe(buildMessage('access_request.approved', 'helper.offer_services', 'ar').title);
    calls = [];
    await processAccessOutbox({ notify: flaky });
    expect(calls.filter((c) => c.data.request_id === r.id)).toHaveLength(0);
    expect(await count('SELECT COUNT(*) AS n FROM access_grants WHERE source_request_id = $1', [r.id])).toBe(1);
  });

  test('flags off: APIs answer feature_disabled', async () => {
    const u = await newUser('flagoff');
    process.env.ACCESS_REQUESTS_ENABLED = 'false';
    process.env.ACCESS_PROJECTION_ENABLED = 'false';
    try {
      expect((await as(u).get('/api/me/access')).body.code).toBe('feature_disabled');
      expect((await as(u).post('/api/me/access-requests', { capability: 'helper.offer_services' })).status).toBe(503);
      process.env.ACCESS_PILOT_USER_IDS = u;
      expect((await as(u).get('/api/me/access')).status).toBe(200);
    } finally {
      process.env.ACCESS_REQUESTS_ENABLED = 'true';
      process.env.ACCESS_PROJECTION_ENABLED = 'true';
      delete process.env.ACCESS_PILOT_USER_IDS;
    }
  });
});
