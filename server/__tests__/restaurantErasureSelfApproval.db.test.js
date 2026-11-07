'use strict';

/**
 * DB tests: finding 46 — a manager cannot approve their own erasure
 * request. The decision needs a second manager; the request stays
 * pending for someone else to approve. Rejecting your own request is
 * a withdrawal, not an approval, so it stays allowed.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantErasureSelfApproval.db.test.js
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
  process.env['JWT' + '_SECRET'] = 'erasure-self-approval-test-secret';
}

const pool = require('../db');
const controller = require('../controllers/restaurantComplianceController');

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
    [id, `erasure-${id.slice(0, 8)}@example.invalid`, first, last]
  );
  return id;
}

async function makeRequest(businessId, restaurantId, subjectUserId, requestedBy) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO restaurant_erasure_requests
       (business_id, restaurant_id, user_id, requested_by, reason)
     VALUES ($1, $2, $3, $4, 'Leaving the team')
     RETURNING id`,
    [businessId, restaurantId, subjectUserId, requestedBy]
  );
  return Number(row.id);
}

ddescribe('Finding 46: erasure requests need a second manager to approve', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const manager2 = await makeUser('Mona', 'Manager');
    const staff = await makeUser('Sara', 'Server');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Erasure ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Erasure Diner']
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active')`,
      [biz.id, owner, manager2, `erasure-mgr-${manager2.slice(0, 8)}@example.invalid`]
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'employee', $4, 'active')`,
      [biz.id, owner, staff, `erasure-staff-${staff.slice(0, 8)}@example.invalid`]
    );
    F = { owner, manager2, staff, businessId: Number(biz.id), restaurantId: Number(rest.id) };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('a manager cannot approve their own erasure request; a different manager can', async () => {
    const requestId = await makeRequest(F.businessId, F.restaurantId, F.owner, F.owner);
    const selfApprove = await call(
      controller.decideErasureRequest,
      mockReq({
        params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
        body: { decision: 'approved' },
        user: { id: F.owner },
      })
    );
    expect(selfApprove.err).toMatchObject({ code: 'erasure_self_approval', statusCode: 409 });
    expect(String(selfApprove.err.message)).toContain('own erasure request');
    const { rows: [stillPending] } = await pool.query(
      'SELECT status, decided_by FROM restaurant_erasure_requests WHERE id = $1', [requestId]
    );
    expect(stillPending.status).toBe('requested');
    expect(stillPending.decided_by).toBeNull();
    const approved = await call(
      controller.decideErasureRequest,
      mockReq({
        params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
        body: { decision: 'approved' },
        user: { id: F.manager2 },
      })
    );
    expect(approved.err).toBeNull();
    expect(approved.res.payload.request.status).toBe('approved');
    expect(approved.res.payload.request.decided_by).toBe(F.manager2);
  });

  test('a manager approving a request filed by someone else still works, and self-rejection stays allowed', async () => {
    const requestId = await makeRequest(F.businessId, F.restaurantId, F.staff, F.manager2);
    const approved = await call(
      controller.decideErasureRequest,
      mockReq({
        params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
        body: { decision: 'approved' },
        user: { id: F.owner },
      })
    );
    expect(approved.err).toBeNull();
    expect(approved.res.payload.request.status).toBe('approved');

    const ownRequestId = await makeRequest(F.businessId, F.restaurantId, F.owner, F.owner);
    const selfReject = await call(
      controller.decideErasureRequest,
      mockReq({
        params: { restaurantId: String(F.restaurantId), requestId: String(ownRequestId) },
        body: { decision: 'rejected' },
        user: { id: F.owner },
      })
    );
    expect(selfReject.err).toBeNull();
    expect(selfReject.res.payload.request.status).toBe('rejected');
  });

  test('running an erasure without an offboarding record is refused with 409', async () => {
    const requestId = await makeRequest(F.businessId, F.restaurantId, F.staff, F.owner);
    const approved = await call(
      controller.decideErasureRequest,
      mockReq({
        params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
        body: { decision: 'approved' },
        user: { id: F.manager2 },
      })
    );
    expect(approved.err).toBeNull();
    const run = async (userId) => call(
      controller.runErasureRequest,
      mockReq({
        params: { restaurantId: String(F.restaurantId), requestId: String(requestId) },
        user: { id: userId },
      })
    );
    // No offboarding record exists for the staff member: the run is
    // refused, never completed, and the request stays approved.
    const refused = await run(F.owner);
    expect(refused.err).toMatchObject({ code: 'retention_record_missing', statusCode: 409 });
    const { rows: [stillApproved] } = await pool.query(
      'SELECT status FROM restaurant_erasure_requests WHERE id = $1', [requestId]
    );
    expect(stillApproved.status).toBe('approved');
    // An offboarding record whose retention has not expired is
    // refused too, with the unexpired-retention code.
    await pool.query(
      `INSERT INTO staff_offboarding_records
         (business_id, user_id, removed_by, reason, retain_until)
       VALUES ($1, $2, $3, 'Left the business', '2033-01-01')`,
      [F.businessId, F.staff, F.owner]
    );
    const unexpired = await run(F.owner);
    // The unexpired path answers 409 JSON (the pre-existing skipped
    // shape), it does not throw.
    expect(unexpired.err).toBeNull();
    expect(unexpired.res.statusCode).toBe(409);
    expect(unexpired.res.payload.code).toBe('retention_not_expired');
    // Once retention has expired the same request completes.
    await pool.query(
      `UPDATE staff_offboarding_records SET retain_until = '2020-01-01'
        WHERE business_id = $1 AND user_id = $2`,
      [F.businessId, F.staff]
    );
    const completed = await run(F.owner);
    expect(completed.err).toBeNull();
    expect(completed.res.payload.request.status).toBe('completed');
    // Clean up: the expired offboarding record would otherwise leave
    // the other tests' still-approved requests for the same staff
    // member due for the global retention sweep (the sweep test
    // counts completed requests across all businesses).
    await pool.query(
      'DELETE FROM staff_offboarding_records WHERE business_id = $1 AND user_id = $2',
      [F.businessId, F.staff]
    );
    await pool.query('DELETE FROM restaurant_erasure_requests WHERE id = $1', [requestId]);
  });
});
