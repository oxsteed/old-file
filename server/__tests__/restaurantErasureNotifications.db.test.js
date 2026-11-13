'use strict';

/**
 * DB tests: money-flows W3 — the erasure lifecycle sends no notification
 * at any step. Each step must notify the right party:
 *
 *   - createErasureRequest notifies the business managers (owner + managers)
 *   - decideErasureRequest notifies the requester (approved / rejected)
 *   - runErasureRequest notifies the requester on completion
 *   - the weekly retention sweep notifies the requester on completion,
 *     both for approved requests and for auto-anonymized staff
 *
 * A requested erasure sitting undecided must surface to managers: the
 * create step is what makes that visible.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantErasureNotifications.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'erasure-notifications-test-secret';
}

const pool = require('../db');
const controller = require('../controllers/restaurantComplianceController');
const { sweep } = require('../jobs/restaurantRetentionJob');

jest.setTimeout(60000);

function mockReq({ params = {}, query = {}, body = {}, user = { id: 'nobody' } } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

async function makeUser(first, last) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `erasure-notif-${id.slice(0, 8)}@example.invalid`, first, last]
  );
  return id;
}

async function notificationsFor(userId, type) {
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at`,
    [userId, type]
  );
  return rows;
}

ddescribe('Money-flows W3: erasure lifecycle notifications', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const manager2 = await makeUser('Mona', 'Manager');
    const staff = await makeUser('Sara', 'Server');
    const sweepStaff = await makeUser('Sue', 'Sweep');
    const autoStaff = await makeUser('Alex', 'Auto');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `ErasureNotif ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Erasure Notif Diner']
    );
    for (const [memberId, role] of [[manager2, 'manager'], [staff, 'employee'], [sweepStaff, 'employee'], [autoStaff, 'employee']]) {
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [biz.id, owner, memberId, role, `erasure-notif-${memberId.slice(0, 8)}@example.invalid`]
      );
    }
    // Expired retention for the staff member (run path), the sweep
    // member (sweep path) and the auto-anonymized member (sweep path
    // only). The sweep member is a different person from the run-path
    // member: a completed erasure row already exists for the run-path
    // member, and the completed-rows dedupe (money-flows W10) forbids
    // a second completed row for the same person.
    for (const userId of [staff, sweepStaff, autoStaff]) {
      await pool.query(
        `INSERT INTO staff_offboarding_records
           (business_id, user_id, removed_by, reason, retain_until)
         VALUES ($1, $2, $3, 'Left the business', '2020-01-01')`,
        [biz.id, userId, owner]
      );
    }
    F = { owner, manager2, staff, sweepStaff, autoStaff, businessId: Number(biz.id), restaurantId: Number(rest.id) };
  });

  afterAll(async () => {
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [[F.owner, F.manager2, F.staff, F.sweepStaff, F.autoStaff]]).catch(() => {});
    await pool.query('DELETE FROM restaurant_erasure_requests WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM staff_offboarding_records WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[F.owner, F.manager2, F.staff, F.sweepStaff, F.autoStaff]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('create notifies managers; decide notifies the requester; run notifies the requester on completion', async () => {
    // 1. Staff requests erasure for themselves.
    const created = await call(controller.createErasureRequest, mockReq({
      params: { restaurantId: String(F.restaurantId) },
      body: { reason: 'Leaving the team' },
      user: { id: F.staff },
    }));
    expect(created.err).toBeNull();
    expect(created.res.statusCode).toBe(201);
    const requestId = Number(created.res.payload.request.id);

    // The undecided request surfaces to both managers immediately.
    const ownerNotes = await notificationsFor(F.owner, 'restaurant_erasure_requested');
    const managerNotes = await notificationsFor(F.manager2, 'restaurant_erasure_requested');
    expect(ownerNotes.length).toBeGreaterThanOrEqual(1);
    expect(managerNotes.length).toBeGreaterThanOrEqual(1);
    expect(ownerNotes[0].data.erasure_request_id).toBe(requestId);
    expect(managerNotes[0].data.erasure_request_id).toBe(requestId);
    // The requester is not a manager here, so they get no manager notice.
    expect(await notificationsFor(F.staff, 'restaurant_erasure_requested')).toHaveLength(0);

    // 2. A second manager approves; the requester is told.
    const decided = await call(controller.decideErasureRequest, mockReq({
      params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
      body: { decision: 'approved' },
      user: { id: F.manager2 },
    }));
    expect(decided.err).toBeNull();
    const decidedNotes = await notificationsFor(F.staff, 'restaurant_erasure_decided');
    expect(decidedNotes.length).toBeGreaterThanOrEqual(1);
    expect(decidedNotes[0].data.erasure_request_id).toBe(requestId);
    expect(decidedNotes[0].data.decision).toBe('approved');

    // 3. A manager runs the approved erasure; the requester is told it completed.
    const run = await call(controller.runErasureRequest, mockReq({
      params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
      user: { id: F.manager2 },
    }));
    expect(run.err).toBeNull();
    expect(run.res.payload.request.status).toBe('completed');
    const completedNotes = await notificationsFor(F.staff, 'restaurant_erasure_completed');
    expect(completedNotes.length).toBeGreaterThanOrEqual(1);
    expect(completedNotes[0].data.erasure_request_id).toBe(requestId);
  });

  test('a rejected request notifies the requester of the rejection', async () => {
    const created = await call(controller.createErasureRequest, mockReq({
      params: { restaurantId: String(F.restaurantId) },
      body: { reason: 'Changed my mind test' },
      user: { id: F.staff },
    }));
    expect(created.err).toBeNull();
    const requestId = Number(created.res.payload.request.id);
    const decided = await call(controller.decideErasureRequest, mockReq({
      params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
      body: { decision: 'rejected' },
      user: { id: F.manager2 },
    }));
    expect(decided.err).toBeNull();
    const notes = await notificationsFor(F.staff, 'restaurant_erasure_decided');
    const rejected = notes.filter((n) => n.data.erasure_request_id === requestId);
    expect(rejected.length).toBe(1);
    expect(rejected[0].data.decision).toBe('rejected');
  });

  test('the retention sweep notifies the subject when it completes an erasure', async () => {
    // Approved request past retention, completed by the sweep (not the manual run).
    const { rows: [{ id: sweepRequestId }] } = await pool.query(
      `INSERT INTO restaurant_erasure_requests
         (business_id, restaurant_id, user_id, requested_by, status, reason)
       VALUES ($1, $2, $3, $3, 'approved', 'Sweep completion') RETURNING id`,
      [F.businessId, F.restaurantId, F.sweepStaff]
    );
    const beforeAuto = await notificationsFor(F.autoStaff, 'restaurant_erasure_completed');
    const result = await sweep(pool);
    // The sweep covers the whole shared database, so only assert on
    // this suite's own request: sibling tracks may leave due requests
    // of their own behind.
    expect(result.errors.filter((e) => Number(e.request_id) === Number(sweepRequestId))).toEqual([]);
    expect(result.completedRequests).toBeGreaterThanOrEqual(1);
    expect(result.autoAnonymized).toBeGreaterThanOrEqual(1);
    const { rows: [request] } = await pool.query(
      'SELECT status FROM restaurant_erasure_requests WHERE id = $1', [sweepRequestId]
    );
    expect(request.status).toBe('completed');
    const sweepNotes = await notificationsFor(F.sweepStaff, 'restaurant_erasure_completed');
    const forRequest = sweepNotes.filter((n) => n.data.erasure_request_id === Number(sweepRequestId));
    expect(forRequest.length).toBe(1);
    // The auto-anonymized member (no request of their own) is also told.
    const autoNotes = await notificationsFor(F.autoStaff, 'restaurant_erasure_completed');
    expect(autoNotes.length).toBeGreaterThan(beforeAuto.length);
  });
});
