'use strict';

/**
 * Batch A (Groups 5-6, items 251-260): booking queue conflict surfacing,
 * booking dispatch, and dispatch/transfer candidates.
 *
 * Against the real migrated schema, through the real booking controller
 * and booking lifecycle:
 *   - 258 (G5-39): a pending business booking overlapping an existing
 *     business appointment carries hasSchedulingConflict in the incoming
 *     list, and accept fails 409 with code SCHEDULING_CONFLICT; a
 *     non-overlapping booking is not flagged.
 *   - 260 (G5-11): a manager dispatches a pending business booking to a
 *     member (dispatch_status='pending', member notified with
 *     booking_dispatched); a plain member 403s; a non-member target 400s;
 *     an accepted booking cannot be dispatched; the dispatched member's
 *     accept flips dispatch_status to 'confirmed'; a later transfer
 *     clears the dispatch state.
 *   - 257 (G5-12): transfer candidates rank business members with
 *     availability / time-off / overlap flags for the booking slot;
 *     non-managers 403; helper-owned bookings have no roster (400).
 *
 * DB: disposable loopback database credit_statement_test_pr804_d only; the
 * suite skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d)?$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Track D test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'batch-a-test-secret';
}

const pool = require('../db');
const bookingController = require('../controllers/bookingController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

// Each booking gets its own day so the appointment overlap guard never
// fires across tests. Days start at +2: createBookingRequest caps the
// confirmation deadline at the hours until the service start, so a
// tomorrow-10:00 booking with confirmationHours 24 fails after 10:00 UTC.
let dayOffset = 1;
function nextDate() {
  dayOffset += 1;
  const d = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('Batch A: booking conflicts, dispatch, transfer candidates', () => {
  let customer;
  let owner;
  let manager;
  let plainMember;
  let stranger;
  let business;
  let serviceId;

  async function makeUser(role, { onboardingCompleted = false } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `batcha-${id.slice(0, 8)}@example.invalid`, role, role, onboardingCompleted],
    );
    return id;
  }

  async function grantHelperOfferServices(userId) {
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [userId],
    );
  }

  async function activateHelper(userId) {
    await pool.query(
      `UPDATE users SET terms_accepted = TRUE, terms_accepted_at = NOW(), terms_version = '2026-01-01',
         id_verified = TRUE, identity_verified = TRUE, didit_status = 'verified',
         didit_verified_at = NOW(), w9_completed = TRUE WHERE id = $1`,
      [userId],
    );
    await pool.query(
      `INSERT INTO connect_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_complete)
       VALUES ($1, $2, TRUE, TRUE, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET charges_enabled = TRUE, payouts_enabled = TRUE, onboarding_complete = TRUE`,
      [userId, `acct_batcha_${String(userId).replace(/-/g, '').slice(0, 20)}`],
    );
  }

  beforeAll(async () => {
    customer = await makeUser('customer');
    owner = await makeUser('customer');
    manager = await makeUser('helper', { onboardingCompleted: true });
    plainMember = await makeUser('helper', { onboardingCompleted: true });
    stranger = await makeUser('customer');
    await grantHelperOfferServices(manager);
    await grantHelperOfferServices(plainMember);
    await activateHelper(manager);
    await activateHelper(plainMember);
    ({ rows: [business] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, 'BatchA Plumbing'],
    ));
    ({ rows: [{ id: serviceId }] } = await pool.query(
      `INSERT INTO business_services (business_id, name, base_price_cents, is_active)
       VALUES ($1, 'Fix the sink', 5000, TRUE) RETURNING id`,
      [business.id],
    ));
    for (const [memberId, role] of [[manager, 'manager'], [plainMember, 'employee']]) {
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [business.id, owner, memberId, `batcha-${memberId.slice(0, 8)}@example.invalid`, role],
      );
    }
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createBooking({ asUser, helperId, businessId, overrides = {} } = {}) {
    const res = mockRes();
    await bookingController.createBookingRequest({
      user: { id: asUser || customer },
      body: {
        helperId,
        ...(businessId ? { businessId } : {}),
        serviceName: 'Fix the sink',
        requestedDate: nextDate(),
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
        serviceLocation: '12 Main St',
        description: 'Leaky tap',
        confirmationHours: 24,
        ...overrides,
      },
    }, res);
    return res;
  }

  async function acceptBooking(bookingId, asUser) {
    const res = mockRes();
    await bookingController.acceptBookingRequest({
      user: { id: asUser, first_name: 'Test', last_name: 'Helper' },
      params: { bookingId },
      body: {},
    }, res);
    return res;
  }

  async function dispatchBooking(bookingId, asUser, memberId) {
    const res = mockRes();
    await bookingController.dispatchBookingRequest({
      user: { id: asUser, first_name: 'Test', last_name: 'Actor' },
      params: { bookingId },
      body: { memberId },
    }, res);
    return res;
  }

  async function listCandidates(bookingId, asUser) {
    const res = mockRes();
    await bookingController.listTransferCandidates({
      user: { id: asUser },
      params: { bookingId },
    }, res);
    return res;
  }

  async function incoming(asUser) {
    const res = mockRes();
    await bookingController.getIncomingBookingRequests({
      user: { id: asUser },
      query: {},
    }, res);
    return res;
  }

  async function bookingRow(id) {
    const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
    return rows[0];
  }

  test('258: overlapping pending booking is flagged in the inbox and accept 409s with the conflict code', async () => {
    const created = await createBooking({ helperId: manager, businessId: business.id });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    const date = new Date(created.payload.data.requestedDate).toISOString().slice(0, 10);
    // An existing business appointment overlapping the 10:00-11:00 slot.
    await pool.query(
      `INSERT INTO business_appointments (business_id, service_id, staff_id, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
      [business.id, serviceId, manager, `${date}T10:30:00Z`, `${date}T11:30:00Z`],
    );

    const list = await incoming(manager);
    expect(list.statusCode).toBe(200);
    const row = list.payload.data.find((r) => r.id === bookingId);
    expect(row).toBeDefined();
    expect(row.hasSchedulingConflict).toBe(true);

    const accepted = await acceptBooking(bookingId, manager);
    expect(accepted.statusCode).toBe(409);
    expect(accepted.payload.code).toBe('SCHEDULING_CONFLICT');

    // A booking on a free day is not flagged.
    const free = await createBooking({ helperId: manager, businessId: business.id });
    expect(free.statusCode).toBe(201);
    const freeId = free.payload.data.id;
    const freeList = await incoming(manager);
    const freeRow = freeList.payload.data.find((r) => r.id === freeId);
    expect(freeRow).toBeDefined();
    expect(freeRow.hasSchedulingConflict).toBe(false);
  });

  test('260: manager dispatches a pending booking; member confirms by accepting', async () => {
    const created = await createBooking({ helperId: manager, businessId: business.id });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;

    // A plain member cannot dispatch.
    expect((await dispatchBooking(bookingId, plainMember, plainMember)).statusCode).toBe(403);
    // The target must be a member of the business.
    const outsider = await dispatchBooking(bookingId, manager, stranger);
    expect(outsider.statusCode).toBe(400);
    expect(outsider.payload.code).toBe('dispatch_target_ineligible');

    const dispatched = await dispatchBooking(bookingId, manager, plainMember);
    expect(dispatched.statusCode).toBe(200);
    expect(dispatched.payload.data.helperId).toBe(plainMember);
    expect(dispatched.payload.data.dispatchStatus).toBe('pending');
    const row = await bookingRow(bookingId);
    expect(row.dispatch_status).toBe('pending');
    expect(row.dispatched_at).toBeTruthy();
    // The member was notified with a titled dispatch notice.
    const notes = (await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'booking_dispatched' ORDER BY created_at DESC LIMIT 1`,
      [plainMember],
    )).rows;
    expect(notes.length).toBe(1);
    expect(notes[0].data).toMatchObject({ bookingId });
    expect(notes[0].title).toBeTruthy();

    // The dispatched member confirms by accepting; the dispatch flips.
    const accepted = await acceptBooking(bookingId, plainMember);
    expect(accepted.statusCode).toBe(200);
    expect((await bookingRow(bookingId)).dispatch_status).toBe('confirmed');

    // An accepted booking cannot be dispatched.
    expect((await dispatchBooking(bookingId, manager, manager)).statusCode).toBe(400);

    // A later transfer clears the dispatch state.
    const res = mockRes();
    await bookingController.transferBookingRequest({
      user: { id: plainMember, first_name: 'Test', last_name: 'Member' },
      params: { bookingId },
      body: { newHelperId: manager, reason: 'Back to manager' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect((await bookingRow(bookingId)).dispatch_status).toBeNull();
  });

  test('260: only business bookings can be dispatched', async () => {
    const created = await createBooking({ helperId: manager });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    const res = await dispatchBooking(bookingId, manager, plainMember);
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('dispatch_target_ineligible');
  });

  test('257: transfer candidates carry time-off and overlap flags; non-managers and helper bookings are refused', async () => {
    const created = await createBooking({ helperId: manager, businessId: business.id });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    const date = new Date(created.payload.data.requestedDate).toISOString().slice(0, 10);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();

    // plainMember is on approved time off covering the booking date.
    await pool.query(
      `INSERT INTO business_time_off_requests (business_id, user_id, request_type, start_date, end_date, status)
       VALUES ($1, $2, 'vacation', $3, $3, 'approved')`,
      [business.id, plainMember, date],
    );
    // The manager has an overlapping appointment that day and full-day availability.
    await pool.query(
      `INSERT INTO business_appointments (business_id, service_id, staff_id, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
      [business.id, serviceId, manager, `${date}T10:30:00Z`, `${date}T11:30:00Z`],
    );
    await pool.query(
      `INSERT INTO business_staff_availability (business_id, user_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, '00:00', '23:59')`,
      [business.id, manager, dow],
    );

    const res = await listCandidates(bookingId, manager);
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(res.payload.data.candidates.map((c) => [c.user_id, c]));
    expect(byId[plainMember]).toMatchObject({ time_off: true, eligible: false });
    expect(byId[manager]).toMatchObject({ conflict: true, available: true, eligible: false });
    expect(byId[owner]).toBeDefined();

    // A plain member cannot list candidates.
    expect((await listCandidates(bookingId, plainMember)).statusCode).toBe(403);

    // A helper-owned booking has no member roster to rank.
    const personal = await createBooking({ helperId: manager });
    expect(personal.statusCode).toBe(201);
    expect((await listCandidates(personal.payload.data.id, manager)).statusCode).toBe(400);
  });
});
