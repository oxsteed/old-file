'use strict';

/**
 * DB tests: Phase 3 Track C employee portal availability and shift swaps
 * with target acceptance (goal goal_a0fc7c0f0394) against a real migrated
 * database.
 *
 * Proves, end to end through the staff schedule controller handlers:
 *   - a swap request starts 'requested' (waiting on the target) and is
 *     visible to both participants, not to uninvolved staff;
 *   - manager approve before the target accepts is a 409 and the shift
 *     stays with the requester;
 *   - only the named target can respond: a non-target gets 403 and the
 *     requester cannot respond as target;
 *   - target accept moves the request to 'target_accepted' and stamps
 *     target_responded_at; manager approve then succeeds and reassigns
 *     the shift to the target;
 *   - target decline closes the request as 'declined'; approve after a
 *     decline fails, and a second response is a 409;
 *   - a manager may reject after target acceptance; a decided request
 *     can no longer be approved;
 *   - availability replace round-trips through the client shape
 *     (day_of_week + wall-clock start/end) and the list read-back
 *     matches what was saved; the 42-window cap, dedupe, and
 *     end-after-start validation are enforced; another member's
 *     availability is manager-only to read.
 *
 * Deliberately NOT covered here (Phase 4 scope): conflict validation
 * at swap create/approve (overlap, time-off, availability, minors).
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantEmployeePortalSwapsAvailability.db.test.js
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantEmployeePortalTipsPay.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

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
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

// The workforce scope resolver is mocked to a null (unscoped) context,
// the same way businessStaffScheduleController.test.js does: scoping
// itself is covered by the store suite, and these tests prove the swap
// state machine and the availability endpoints against real rows.
jest.mock('../services/restaurantWorkforceScope', () => ({
  ...jest.requireActual('../services/restaurantWorkforceScope'),
  context: jest.fn(async () => null),
}));

const pool = require('../db');
const controller = require('../controllers/businessStaffScheduleController');

function mockReq({ params = {}, query = {}, body = {}, user = { id: 'nobody' } } = {}) {
  return { params, query, body, user, headers: {} };
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
  const tag = crypto.randomUUID().slice(0, 8);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `swap-${tag}@example.invalid`, first, last]
  );
  return id;
}

async function makeBusiness(ownerId, label) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, label]
  );
  return b.id;
}

async function addMember(businessId, ownerId, userId, role) {
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [businessId, ownerId, userId, role, `swap-member-${userId.slice(0, 8)}@example.invalid`]
  );
}

async function makeShift(businessId, userId, date) {
  const { rows: [s] } = await pool.query(
    `INSERT INTO business_staff_shifts
       (business_id, user_id, shift_date, start_time, end_time, role_label, published_at)
     VALUES ($1, $2, $3, '09:00', '17:00', 'Server', NOW()) RETURNING id`,
    [businessId, userId, date]
  );
  return s.id;
}

async function shiftAssignee(shiftId) {
  const { rows: [row] } = await pool.query(
    'SELECT user_id FROM business_staff_shifts WHERE id = $1', [shiftId]
  );
  return row.user_id;
}

ddescribe('Phase 3 Track C: swap target acceptance and availability', () => {
  let fx;
  let shiftId;

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const businessId = await makeBusiness(owner, 'Swap Bistro');
    const alice = await makeUser('Alice', 'Requester');
    const bob = await makeUser('Bob', 'Target');
    const carol = await makeUser('Carol', 'Bystander');
    await addMember(businessId, owner, alice, 'employee');
    await addMember(businessId, owner, bob, 'employee');
    await addMember(businessId, owner, carol, 'employee');
    fx = { owner, businessId, alice, bob, carol };
    shiftId = await makeShift(businessId, alice, '2026-11-07');
  });

  const swapReq = (userId, extra = {}) => mockReq({
    params: { businessId: String(fx.businessId) },
    user: { id: userId },
    ...extra,
  });

  async function createSwap(requester, target) {
    const { res, err } = await call(controller.createShiftSwapRequest, swapReq(requester, {
      params: { businessId: String(fx.businessId), shiftId: String(shiftId) },
      body: { target_user_id: target, note: 'Cover me please' },
    }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.payload.request.status).toBe('requested');
    return res.payload.request;
  }

  test('a swap request starts requested and is visible only to its participants', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const asAlice = await call(controller.listShiftSwapRequests, swapReq(fx.alice));
    expect(asAlice.err).toBeNull();
    expect(asAlice.res.payload.requests.map((r) => r.id)).toContain(request.id);
    const asBob = await call(controller.listShiftSwapRequests, swapReq(fx.bob));
    expect(asBob.res.payload.requests.map((r) => r.id)).toContain(request.id);
    const asCarol = await call(controller.listShiftSwapRequests, swapReq(fx.carol));
    expect(asCarol.err).toBeNull();
    expect(asCarol.res.payload.requests.map((r) => r.id)).not.toContain(request.id);
    // Clean up so later tests start from a known set.
    await pool.query('DELETE FROM business_shift_swap_requests WHERE id = $1', [request.id]);
  });

  test('manager approve before target acceptance is 409 and the shift stays put', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const { res, err } = await call(controller.approveShiftSwapRequest, swapReq(fx.owner, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
    }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(409);
    expect(res.payload.error).toMatch(/not accepted/i);
    expect(await shiftAssignee(shiftId)).toBe(fx.alice);
    const { rows } = await pool.query(
      'SELECT status FROM business_shift_swap_requests WHERE id = $1', [request.id]
    );
    expect(rows[0].status).toBe('requested');
    await pool.query('DELETE FROM business_shift_swap_requests WHERE id = $1', [request.id]);
  });

  test('a non-target cannot respond and the requester cannot respond as target', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const asCarol = await call(controller.respondShiftSwapRequest, swapReq(fx.carol, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'accept' },
    }));
    expect(asCarol.err).toBeNull();
    expect(asCarol.res.statusCode).toBe(403);
    const asAlice = await call(controller.respondShiftSwapRequest, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'accept' },
    }));
    expect(asAlice.err).toBeNull();
    expect(asAlice.res.statusCode).toBe(403);
    const { rows } = await pool.query(
      'SELECT status, target_responded_at FROM business_shift_swap_requests WHERE id = $1', [request.id]
    );
    expect(rows[0].status).toBe('requested');
    expect(rows[0].target_responded_at).toBeNull();
    await pool.query('DELETE FROM business_shift_swap_requests WHERE id = $1', [request.id]);
  });

  test('target accept then manager approve succeeds and reassigns the shift', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const accepted = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'accept' },
    }));
    expect(accepted.err).toBeNull();
    expect(accepted.res.statusCode).toBe(200);
    expect(accepted.res.payload.request.status).toBe('target_accepted');
    expect(accepted.res.payload.request.target_responded_at).not.toBeNull();

    const approved = await call(controller.approveShiftSwapRequest, swapReq(fx.owner, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
    }));
    expect(approved.err).toBeNull();
    expect(approved.res.statusCode).toBe(200);
    expect(approved.res.payload.request.status).toBe('approved');
    expect(await shiftAssignee(shiftId)).toBe(fx.bob);

    // A decided request can no longer be answered or approved.
    const late = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'decline' },
    }));
    expect(late.res.statusCode).toBe(409);
    const again = await call(controller.approveShiftSwapRequest, swapReq(fx.owner, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
    }));
    expect(again.res.statusCode).toBe(409);
    // Hand the shift back for the remaining tests.
    await pool.query('UPDATE business_staff_shifts SET user_id = $1 WHERE id = $2', [fx.alice, shiftId]);
  });

  test('target decline closes the request and approve after decline fails', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const declined = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'decline' },
    }));
    expect(declined.err).toBeNull();
    expect(declined.res.statusCode).toBe(200);
    expect(declined.res.payload.request.status).toBe('declined');
    expect(declined.res.payload.request.target_responded_at).not.toBeNull();
    const approved = await call(controller.approveShiftSwapRequest, swapReq(fx.owner, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
    }));
    expect(approved.err).toBeNull();
    expect(approved.res.statusCode).toBe(409);
    expect(await shiftAssignee(shiftId)).toBe(fx.alice);
    const second = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'accept' },
    }));
    expect(second.res.statusCode).toBe(409);
  });

  test('a manager may reject after target acceptance', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const accepted = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'accept' },
    }));
    expect(accepted.res.payload.request.status).toBe('target_accepted');
    const rejected = await call(controller.rejectShiftSwapRequest, swapReq(fx.owner, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
    }));
    expect(rejected.err).toBeNull();
    expect(rejected.res.statusCode).toBe(200);
    expect(rejected.res.payload.request.status).toBe('rejected');
    expect(await shiftAssignee(shiftId)).toBe(fx.alice);
  });

  test('respond validates the action and the request id', async () => {
    const request = await createSwap(fx.alice, fx.bob);
    const badAction = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: String(request.id) },
      body: { action: 'maybe' },
    }));
    expect(badAction.err).toBeNull();
    expect(badAction.res.statusCode).toBe(400);
    const missing = await call(controller.respondShiftSwapRequest, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId), requestId: '999999999' },
      body: { action: 'accept' },
    }));
    expect(missing.err).toBeNull();
    expect(missing.res.statusCode).toBe(404);
    await pool.query('DELETE FROM business_shift_swap_requests WHERE id = $1', [request.id]);
  });

  test('availability replace round-trips through the client shape', async () => {
    const windows = [
      { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
      { day_of_week: 3, start_time: '12:00', end_time: '20:00' },
    ];
    const saved = await call(controller.replaceAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
      body: { windows },
    }));
    expect(saved.err).toBeNull();
    expect(saved.res.statusCode).toBe(200);
    expect(saved.res.payload.windows).toHaveLength(2);
    const listed = await call(controller.listAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
    }));
    expect(listed.err).toBeNull();
    expect(listed.res.payload.windows.map((w) => ({
      day_of_week: w.day_of_week,
      start_time: String(w.start_time).slice(0, 5),
      end_time: String(w.end_time).slice(0, 5),
    }))).toEqual(windows);
    // Saving an empty list clears the availability.
    const cleared = await call(controller.replaceAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
      body: { windows: [] },
    }));
    expect(cleared.res.payload.windows).toEqual([]);
  });

  test('availability replace enforces the cap, dedupe, and end after start', async () => {
    const tooMany = await call(controller.replaceAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
      body: { windows: Array.from({ length: 43 }, (_, i) => ({ day_of_week: i % 7, start_time: '09:00', end_time: '10:00' })) },
    }));
    expect(tooMany.err).toBeNull();
    expect(tooMany.res.statusCode).toBe(400);
    const dupes = await call(controller.replaceAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
      body: { windows: [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
      ] },
    }));
    expect(dupes.res.statusCode).toBe(400);
    const inverted = await call(controller.replaceAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
      body: { windows: [{ day_of_week: 1, start_time: '17:00', end_time: '09:00' }] },
    }));
    expect(inverted.res.statusCode).toBe(400);
  });

  test('another member availability is manager-only to read', async () => {
    await call(controller.replaceAvailability, swapReq(fx.bob, {
      params: { businessId: String(fx.businessId) },
      body: { windows: [{ day_of_week: 5, start_time: '08:00', end_time: '12:00' }] },
    }));
    const asAlice = await call(controller.listAvailability, swapReq(fx.alice, {
      params: { businessId: String(fx.businessId) },
      query: { user_id: fx.bob },
    }));
    expect(asAlice.err).toBeNull();
    expect(asAlice.res.statusCode).toBe(403);
    const asOwner = await call(controller.listAvailability, swapReq(fx.owner, {
      params: { businessId: String(fx.businessId) },
      query: { user_id: fx.bob },
    }));
    expect(asOwner.err).toBeNull();
    expect(asOwner.res.statusCode).toBe(200);
    expect(asOwner.res.payload.windows).toHaveLength(1);
  });

  test('a non-member cannot replace availability', async () => {
    const stranger = await makeUser('Sam', 'Stranger');
    const { res, err } = await call(controller.replaceAvailability, swapReq(stranger, {
      params: { businessId: String(fx.businessId) },
      body: { windows: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }] },
    }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(403);
  });
});
