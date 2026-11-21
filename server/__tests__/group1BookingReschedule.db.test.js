'use strict';

/**
 * Group 1 (Customer), item 14 — booking-level reschedule proposals.
 *
 * Against the real migrated schema, through the real booking controller:
 *   - a proposal on an accepted booking is a request: the booking window,
 *     the linked appointment, and the payment fields do not move while it
 *     is pending, and a second proposal supersedes the first;
 *   - the other party accepting moves the booking window AND the linked
 *     appointment to the proposed time, in one transaction;
 *   - declining leaves the booking exactly as it was (window, appointment,
 *     payment fields all unchanged);
 *   - a pending booking cannot use this path (409), a stranger 403s, and
 *     the proposer cannot answer their own proposal (409).
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
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
      && /^\/credit_statement_test$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 1 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group1-reschedule-test-secret';
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

// Each booking gets its own day: the appointment overlap guard rejects
// two bookings for the same helper on the same day. Days start at +2:
// createBookingRequest caps the confirmation deadline at the hours until
// the service start, so a tomorrow-10:00 booking with confirmationHours 24
// fails after 10:00 UTC.
let dayOffset = 1;
function nextDate() {
  dayOffset += 1;
  const d = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('Group 1 item 14: booking-level reschedule proposals', () => {
  let customer;
  let helper;
  let stranger;

  async function makeUser(role, { onboardingCompleted = false } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, $5)`,
      [id, `g1-${id.slice(0, 8)}@example.invalid`, role, role, onboardingCompleted],
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
      [userId, `acct_g1_${String(userId).replace(/-/g, '').slice(0, 20)}`],
    );
  }

  beforeAll(async () => {
    customer = await makeUser('customer');
    helper = await makeUser('helper', { onboardingCompleted: true });
    stranger = await makeUser('customer');
    await grantHelperOfferServices(helper);
    await activateHelper(helper);
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createBooking() {
    const res = mockRes();
    await bookingController.createBookingRequest({
      user: { id: customer },
      body: {
        helperId: helper,
        serviceName: 'Fix the sink',
        requestedDate: nextDate(),
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
        serviceLocation: '12 Main St',
        description: 'Leaky tap',
        confirmationHours: 24,
      },
    }, res);
    expect(res.statusCode).toBe(201);
    return res.payload.data.id;
  }

  async function acceptBooking(bookingId) {
    const res = mockRes();
    await bookingController.acceptBookingRequest({
      user: { id: helper, first_name: 'Test', last_name: 'Helper' },
      params: { bookingId },
      body: {},
    }, res);
    expect(res.statusCode).toBe(200);
    return res;
  }

  async function bookingRow(id) {
    const { rows } = await pool.query('SELECT * FROM booking_requests WHERE id = $1', [id]);
    return rows[0];
  }

  async function appointmentRow(id) {
    const { rows } = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
    return rows[0];
  }

  async function propose(bookingId, asUser, overrides = {}) {
    const res = mockRes();
    await bookingController.proposeReschedule({
      user: { id: asUser },
      params: { bookingId },
      body: {
        proposed_date: nextDate(),
        proposed_start_time: '14:00',
        proposed_end_time: '15:00',
        message: 'Can we move it to the afternoon?',
        ...overrides,
      },
    }, res);
    return res;
  }

  async function respond(bookingId, proposalId, asUser, action) {
    const res = mockRes();
    await bookingController.respondToReschedule({
      user: { id: asUser },
      params: { bookingId, proposalId },
      body: { action },
    }, res);
    return res;
  }

  test('propose leaves the booking, appointment, and payment fields untouched; accept moves window and appointment', async () => {
    const bookingId = await createBooking();
    await acceptBooking(bookingId);
    const before = await bookingRow(bookingId);
    expect(before.status).toBe('accepted');
    expect(before.appointment_id).toBeTruthy();
    const appointmentBefore = await appointmentRow(before.appointment_id);

    const proposed = await propose(bookingId, customer);
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.payload.proposal;
    expect(proposal.status).toBe('pending');
    expect(proposal.proposedByRole).toBe('customer');

    // Pending proposal moves nothing.
    const pending = await bookingRow(bookingId);
    expect(String(pending.requested_date).slice(0, 10)).toBe(String(before.requested_date).slice(0, 10));
    expect(String(pending.requested_start_time)).toBe(String(before.requested_start_time));
    expect(String(pending.requested_end_time)).toBe(String(before.requested_end_time));
    expect(pending.payment_status).toBe(before.payment_status);
    expect(pending.payment_amount_cents).toBe(before.payment_amount_cents);
    const appointmentPending = await appointmentRow(before.appointment_id);
    expect(new Date(appointmentPending.scheduled_start_time).getTime())
      .toBe(new Date(appointmentBefore.scheduled_start_time).getTime());

    // A second proposal supersedes the first.
    const second = await propose(bookingId, customer);
    expect(second.statusCode).toBe(201);
    const { rows: firstRows } = await pool.query(
      'SELECT status FROM booking_reschedule_proposals WHERE id = $1', [proposal.id],
    );
    expect(firstRows[0].status).toBe('superseded');

    // The other party accepts: window and appointment move together.
    const accepted = await respond(bookingId, second.payload.proposal.id, helper, 'accept');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.payload.proposal.status).toBe('accepted');
    const after = await bookingRow(bookingId);
    expect(new Date(after.requested_date).toISOString().slice(0, 10)).toBe(second.payload.proposal.proposedDate);
    expect(String(after.requested_start_time).slice(0, 5)).toBe('14:00');
    expect(String(after.requested_end_time).slice(0, 5)).toBe('15:00');
    const appointmentAfter = await appointmentRow(before.appointment_id);
    expect(new Date(appointmentAfter.scheduled_start_time).toISOString().slice(0, 10))
      .toBe(second.payload.proposal.proposedDate);
    expect(new Date(appointmentAfter.scheduled_start_time).toISOString().slice(11, 16)).toBe('14:00');
  });

  test('decline leaves the booking exactly as it was', async () => {
    const bookingId = await createBooking();
    await acceptBooking(bookingId);
    const before = await bookingRow(bookingId);
    const appointmentBefore = await appointmentRow(before.appointment_id);

    const proposed = await propose(bookingId, helper);
    expect(proposed.statusCode).toBe(201);
    expect(proposed.payload.proposal.proposedByRole).toBe('helper');

    const declined = await respond(bookingId, proposed.payload.proposal.id, customer, 'decline');
    expect(declined.statusCode).toBe(200);
    expect(declined.payload.proposal.status).toBe('declined');

    const after = await bookingRow(bookingId);
    expect(String(after.requested_date).slice(0, 10)).toBe(String(before.requested_date).slice(0, 10));
    expect(String(after.requested_start_time)).toBe(String(before.requested_start_time));
    expect(String(after.requested_end_time)).toBe(String(before.requested_end_time));
    expect(after.payment_status).toBe(before.payment_status);
    const appointmentAfter = await appointmentRow(before.appointment_id);
    expect(new Date(appointmentAfter.scheduled_start_time).getTime())
      .toBe(new Date(appointmentBefore.scheduled_start_time).getTime());
  });

  test('pending bookings, strangers, and self-responses are refused', async () => {
    const pendingId = await createBooking();
    const pendingPropose = await propose(pendingId, customer);
    expect(pendingPropose.statusCode).toBe(409);

    const bookingId = await createBooking();
    await acceptBooking(bookingId);
    const strangerPropose = await propose(bookingId, stranger);
    expect(strangerPropose.statusCode).toBe(403);

    const proposed = await propose(bookingId, customer);
    expect(proposed.statusCode).toBe(201);
    const selfRespond = await respond(bookingId, proposed.payload.proposal.id, customer, 'accept');
    expect(selfRespond.statusCode).toBe(409);

    const strangerRespond = await respond(bookingId, proposed.payload.proposal.id, stranger, 'accept');
    expect(strangerRespond.statusCode).toBe(403);
  });
});
