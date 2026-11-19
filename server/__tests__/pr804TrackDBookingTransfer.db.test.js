'use strict';

/**
 * PR #804 Track D, G-37 (no transfer path when a helper is deactivated
 * or a team member leaves).
 *
 * Against the real migrated schema, through the real booking controller
 * and the real staff-offboarding service:
 *   - transfer of an accepted booking to an activated helper preserves
 *     the booking, its deposit columns, and its appointment; only the
 *     provider moves (booking, appointment, and thread helper_id);
 *   - an ineligible target (no helper.offer_services grant) 400s;
 *   - a non-provider 403s; a non-accepted booking 400s;
 *   - offboarding a business member reassigns their open business
 *     bookings + appointments to the business owner, records the counts,
 *     and leaves their personal (non-business) bookings untouched.
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
  process.env['JWT' + '_SECRET'] = 'pr804-track-d-test-secret';
}

const pool = require('../db');
const bookingController = require('../controllers/bookingController');
const { applyStaffOffboarding } = require('../services/staffOffboarding');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

// The appointment overlap guard rejects two bookings for the same helper
// on the same day; each booking gets its own day.
let dayOffset = 0;
function nextDate() {
  dayOffset += 1;
  const d = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('G-37 provider transfer + offboarding reassignment', () => {
  let customer;
  let helperA;
  let helperB;
  let noGrantHelper;
  let stranger;

  async function makeUser(role, { onboardingCompleted = false } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `pr804d-${id.slice(0, 8)}@example.invalid`, role, role, onboardingCompleted],
    );
    return id;
  }

  async function grantHelperOfferServices(userId) {
    // Domain 6 enforce contract: access.can() is the only path when
    // enforcement is 'enforce', so seed the backfilled grant.
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [userId],
    );
  }

  beforeAll(async () => {
    customer = await makeUser('customer');
    helperA = await makeUser('helper', { onboardingCompleted: true });
    helperB = await makeUser('helper', { onboardingCompleted: true });
    noGrantHelper = await makeUser('helper', { onboardingCompleted: true });
    stranger = await makeUser('customer');
    await grantHelperOfferServices(helperA);
    await grantHelperOfferServices(helperB);
    // noGrantHelper deliberately holds no grant.
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

  async function bookingRow(id) {
    const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
    return rows[0];
  }

  test('G-37: transfer preserves booking, deposit, and appointment; only the provider moves', async () => {
    const created = await createBooking({ helperId: helperA });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;

    const accepted = await acceptBooking(bookingId, helperA);
    expect(accepted.statusCode).toBe(200);
    const before = await bookingRow(bookingId);
    expect(before.status).toBe('accepted');
    expect(before.helper_id).toBe(helperA);
    expect(before.appointment_id).toBeTruthy();
    const appointmentBefore = (await pool.query(
      'SELECT * FROM appointments WHERE id = $1', [before.appointment_id],
    )).rows[0];
    expect(appointmentBefore.helper_id).toBe(helperA);

    const res = mockRes();
    await bookingController.transferBookingRequest({
      user: { id: helperA, first_name: 'Test', last_name: 'Helper' },
      params: { bookingId },
      body: { newHelperId: helperB, reason: 'On leave' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.data.helperId).toBe(helperB);

    const after = await bookingRow(bookingId);
    expect(after.status).toBe('accepted');
    expect(after.helper_id).toBe(helperB);
    // Every column except the provider, the transfer reason it writes,
    // and the updated timestamp is byte-identical: the deposit and all
    // payment columns are untouched.
    for (const key of Object.keys(before)) {
      if (key === 'helper_id' || key === 'updated_at' || key === 'helper_response_reason') continue;
      expect(after[key]).toEqual(before[key]);
    }
    const appointmentAfter = (await pool.query(
      'SELECT * FROM appointments WHERE id = $1', [before.appointment_id],
    )).rows[0];
    expect(appointmentAfter.helper_id).toBe(helperB);
    expect(appointmentAfter.status).toBe(appointmentBefore.status);
    // The customer was notified of the transfer.
    const notes = (await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'booking_transferred' ORDER BY created_at DESC LIMIT 1`,
      [customer],
    )).rows;
    expect(notes.length).toBe(1);
    expect(notes[0].data).toMatchObject({ bookingId, newHelperId: helperB });
  });

  test('G-37: ineligible target, non-provider, and non-accepted booking are refused', async () => {
    const created = await createBooking({ helperId: helperA });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    const accepted = await acceptBooking(bookingId, helperA);
    expect(accepted.statusCode).toBe(200);

    // Target holds no helper.offer_services grant.
    const ineligible = mockRes();
    await bookingController.transferBookingRequest({
      user: { id: helperA, first_name: 'Test', last_name: 'Helper' },
      params: { bookingId },
      body: { newHelperId: noGrantHelper },
    }, ineligible);
    expect(ineligible.statusCode).toBe(400);
    expect(ineligible.payload.error).toMatch(/not an activated helper/);

    // A stranger is not the provider.
    const forbidden = mockRes();
    await bookingController.transferBookingRequest({
      user: { id: stranger, first_name: 'Test', last_name: 'Stranger' },
      params: { bookingId },
      body: { newHelperId: helperB },
    }, forbidden);
    expect(forbidden.statusCode).toBe(403);

    // A pending booking cannot be transferred.
    const pending = await createBooking({ helperId: helperA });
    expect(pending.statusCode).toBe(201);
    const pendingId = pending.payload.data.id;
    const notAccepted = mockRes();
    await bookingController.transferBookingRequest({
      user: { id: helperA, first_name: 'Test', last_name: 'Helper' },
      params: { bookingId: pendingId },
      body: { newHelperId: helperB },
    }, notAccepted);
    expect(notAccepted.statusCode).toBe(400);
    expect(notAccepted.payload.error).toMatch(/Only accepted bookings/);
  });

  test('G-37: offboarding reassigns business bookings + appointments to the owner, not personal bookings', async () => {
    const owner = await makeUser('customer');
    const departing = await makeUser('helper', { onboardingCompleted: true });
    await grantHelperOfferServices(departing);
    const { rows: [business] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, 'Pr804 Plumbing'],
    );
    // Business accept resolves the service by name and prices against it.
    await pool.query(
      `INSERT INTO business_services (business_id, name, base_price_cents, is_active)
       VALUES ($1, 'Fix the sink', 5000, TRUE)`,
      [business.id],
    );
    const { rows: [membership] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
       VALUES ($1, $2, $3, $4, 'employee', 'active') RETURNING id`,
      [business.id, owner, departing, `pr804d-member-${departing.slice(0, 8)}@example.invalid`],
    );

    // Open business booking owned by the departing member.
    const bizCreated = await createBooking({ helperId: departing, businessId: business.id });
    expect(bizCreated.statusCode).toBe(201);
    const bizBookingId = bizCreated.payload.data.id;
    const bizAccepted = await acceptBooking(bizBookingId, departing);
    expect(bizAccepted.statusCode).toBe(200);
    const bizBefore = await bookingRow(bizBookingId);
    // Business bookings link their appointment through
    // business_appointment_id, not appointment_id.
    expect(bizBefore.business_appointment_id).toBeTruthy();
    const bizApptBefore = (await pool.query(
      'SELECT * FROM business_appointments WHERE id = $1', [bizBefore.business_appointment_id],
    )).rows[0];
    expect(bizApptBefore.staff_id).toBe(departing);

    // Personal (non-business) booking for the same member: untouched.
    const personalCreated = await createBooking({ helperId: departing });
    expect(personalCreated.statusCode).toBe(201);
    const personalId = personalCreated.payload.data.id;
    const personalAccepted = await acceptBooking(personalId, departing);
    expect(personalAccepted.statusCode).toBe(200);

    const client = await pool.connect();
    try {
      const result = await applyStaffOffboarding(client, {
        businessId: business.id,
        membershipId: membership.id,
        userId: departing,
        removedBy: owner,
        reason: 'Left the team',
      });
      expect(result.bookingsReassigned).toBe(1);
      expect(result.appointmentsReassigned).toBe(1);
      expect(result.reassignedToUserId).toBe(owner);
      expect(result.offboardingRecord.bookings_reassigned).toBe(1);
      expect(result.offboardingRecord.appointments_reassigned).toBe(1);
    } finally {
      client.release();
    }

    const bizAfter = await bookingRow(bizBookingId);
    expect(bizAfter.helper_id).toBe(owner);
    expect(bizAfter.status).toBe('accepted');
    const bizApptAfter = (await pool.query(
      'SELECT * FROM business_appointments WHERE id = $1', [bizBefore.business_appointment_id],
    )).rows[0];
    expect(bizApptAfter.staff_id).toBe(owner);

    const personalAfter = await bookingRow(personalId);
    expect(personalAfter.helper_id).toBe(departing);
  });
});
