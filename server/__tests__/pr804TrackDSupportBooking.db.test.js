'use strict';

/**
 * PR #804 Track D, G-36 (support cannot open a booking to help).
 *
 * Support gets a read-only detail route, GET /api/admin/support/bookings/:id
 * (requireAdmin + manage_support), returning the booking, its appointment,
 * and payment status. GET /api/bookings/:id stays customer/provider only
 * and is NOT widened.
 *
 * Payment internals are redacted by construction: the controller selects
 * columns explicitly and never selects stripe_payment_intent_id or
 * stripe_refund_id. This suite plants sentinel values in both columns
 * and asserts they never appear anywhere in the response payload.
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
const supportController = require('../controllers/supportController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

ddescribe('G-36 support booking detail', () => {
  let adminId;
  let customerId;
  let helperId;
  let bookingId;
  let appointmentId;

  beforeAll(async () => {
    async function makeUser(email, role) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Test', 'User', $3, TRUE, TRUE)`,
        [id, email, role]
      );
      return id;
    }
    adminId = await makeUser(`g36-admin-${Date.now()}@example.com`, 'admin');
    customerId = await makeUser(`g36-customer-${Date.now()}@example.com`, 'customer');
    helperId = await makeUser(`g36-helper-${Date.now()}@example.com`, 'helper');

    const { rows: [appt] } = await pool.query(
      `INSERT INTO appointments
         (customer_id, helper_id, service_description, scheduled_start_time, scheduled_end_time, status)
       VALUES ($1, $2, 'Fix the sink', NOW() + interval '1 day', NOW() + interval '1 day 1 hour', 'confirmed')
       RETURNING id`,
      [customerId, helperId]
    );
    appointmentId = appt.id;

    const { rows: [booking] } = await pool.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, service_name, requested_date, requested_start_time,
          requested_end_time, status, appointment_id, payment_requirement,
          payment_amount_cents, gross_amount_cents, payment_status,
          stripe_payment_intent_id, stripe_refund_id)
       VALUES ($1, $2, 'Fix the sink', CURRENT_DATE + 1, '10:00', '11:00',
          'accepted', $3, 'deposit', 2500, 10000, 'paid',
          'pi_SENTINEL_INTENT_123', 're_SENTINEL_REFUND_456')
       RETURNING id`,
      [customerId, helperId, appointmentId]
    );
    bookingId = booking.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM booking_requests WHERE id = $1', [bookingId]);
    await pool.query('DELETE FROM appointments WHERE id = $1', [appointmentId]);
    // NOTE: users are left in place (see G-17 test note: DELETE FROM users
    // fails on this schema because of the no-delete rules on
    // oxsteed_credit_partner_funding_records).
    await pool.end();
  });

  test('admin sees booking, appointment, and payment status, no payment internals', async () => {
    const { res, err } = await call(supportController.getSupportBooking, {
      user: { id: adminId, role: 'admin' },
      params: { bookingId },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.payload.booking.id).toBe(bookingId);
    expect(res.payload.booking.status).toBe('accepted');
    expect(res.payload.booking.serviceName).toBe('Fix the sink');
    expect(res.payload.booking.customer.id).toBe(customerId);
    expect(res.payload.booking.helper.id).toBe(helperId);
    expect(res.payload.appointment.id).toBe(String(appointmentId));
    expect(res.payload.appointment.status).toBe('confirmed');
    expect(res.payload.payment.status).toBe('paid');
    expect(res.payload.payment.amountCents).toBe(2500);
    expect(res.payload.payment.grossAmountCents).toBe(10000);
    const serialized = JSON.stringify(res.payload);
    expect(serialized).not.toContain('SENTINEL_INTENT');
    expect(serialized).not.toContain('SENTINEL_REFUND');
    expect(serialized).not.toContain('stripe_payment_intent_id');
    expect(serialized).not.toContain('stripe_refund_id');
  });

  test('non-admin cannot open the support route', async () => {
    const { res } = await call(supportController.getSupportBooking, {
      user: { id: customerId, role: 'customer' },
      params: { bookingId },
    });
    expect(res.statusCode).toBe(403);
  });

  test('unknown booking 404s', async () => {
    const { res } = await call(supportController.getSupportBooking, {
      user: { id: adminId, role: 'admin' },
      params: { bookingId: crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });
});
