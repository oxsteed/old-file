'use strict';

/**
 * PR #804 Track B (G-30): a guest (verified guest session) or a signed-in
 * customer can cancel their own booking request through
 * POST /api/chat/booking-requests/:id/customer-cancel. The provider cannot
 * use the customer path, and strangers cannot cancel someone else's
 * booking. Skips unless STATEMENT_TEST_DATABASE_URL is the disposable
 * Track B database.
 */

jest.unmock('pg');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_pr804_b$/.test(url.pathname);
  } catch { return false; }
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;
if (CAN_RUN_DB) process.env.DATABASE_URL = RAW_URL;

jest.setTimeout(60000);

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

ddescribe('guest and customer booking cancel (real database)', () => {
  let pool;
  let app;
  let chatCtrl;
  let customer;
  let helper;
  let stranger;

  beforeAll(async () => {
    pool = require('../db');
    chatCtrl = require('../controllers/chatBookingRequestsController');
    app = express();
    app.use(express.json());
    app.use('/api/chat', require('../routes/chat'));
    app.use(require('../middleware/errorHandler').errorHandler);

    const makeUser = async (role) => {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
         VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
        [id, `t${id}@example.invalid`, role],
      );
      return { id, role };
    };
    customer = await makeUser('customer');
    helper = await makeUser('helper');
    stranger = await makeUser('customer');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const auth = (call, user) => call.set('Authorization', `Bearer ${tokenFor(user)}`);

  async function seedBooking({ status = 'pending', customerId = null, guestSessionId = null } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, service_name, requested_date, requested_start_time, requested_end_time,
          status, conversation_id, guest_session_id)
       VALUES ($1, $2, 'Fixture haircut', '2026-12-01', '09:00', '10:00', $3, NULL, $4)
       RETURNING *`,
      [customerId, helper.id, status, guestSessionId],
    );
    return rows[0];
  }

  async function bookingStatus(id) {
    const { rows } = await pool.query('SELECT status FROM booking_requests WHERE id = $1', [id]);
    return rows[0]?.status;
  }

  test('signed-in customer cancels a pending booking', async () => {
    const booking = await seedBooking({ customerId: customer.id });
    const res = await auth(
      request(app).post(`/api/chat/booking-requests/${booking.id}/customer-cancel`), customer,
    ).send({ reason: 'Plans changed.' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.status).toBe('cancelled');
    expect(await bookingStatus(booking.id)).toBe('cancelled');

    const { rows } = await pool.query(
      `SELECT action, old_status, new_status FROM booking_request_audit_log
        WHERE booking_request_id = $1 AND action = 'cancelled'`,
      [booking.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ old_status: 'pending', new_status: 'cancelled' });
  });

  test('signed-in customer cancels an accepted booking as accepted_cancelled', async () => {
    const booking = await seedBooking({ status: 'accepted', customerId: customer.id });
    const res = await auth(
      request(app).post(`/api/chat/booking-requests/${booking.id}/customer-cancel`), customer,
    ).send({});
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('accepted_cancelled');
    expect(await bookingStatus(booking.id)).toBe('accepted_cancelled');
  });

  test('a verified guest cancels their own booking from the guest session', async () => {
    const guestSessionId = crypto.randomUUID();
    const booking = await seedBooking({ guestSessionId });
    const res = fakeRes();
    let nextError = null;
    await chatCtrl.customerCancelBookingRequest({
      params: { id: booking.id },
      body: { reason: 'Guest plans changed.' },
      guestSession: { id: guestSessionId },
      get: () => undefined,
    }, res, (err) => { nextError = err; });
    expect(nextError).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.status).toBe('cancelled');
    expect(await bookingStatus(booking.id)).toBe('cancelled');
  });

  test('the provider cannot use the customer-cancel path', async () => {
    const booking = await seedBooking({ customerId: customer.id });
    const res = await auth(
      request(app).post(`/api/chat/booking-requests/${booking.id}/customer-cancel`), helper,
    ).send({});
    expect(res.status).toBe(403);
    expect(await bookingStatus(booking.id)).toBe('pending');
  });

  test('another customer cannot cancel someone else’s booking', async () => {
    const booking = await seedBooking({ customerId: customer.id });
    const res = await auth(
      request(app).post(`/api/chat/booking-requests/${booking.id}/customer-cancel`), stranger,
    ).send({});
    expect(res.status).toBe(403);
    expect(await bookingStatus(booking.id)).toBe('pending');
  });

  test('cancelling twice is a conflict and an unknown id is a 404', async () => {
    const booking = await seedBooking({ customerId: customer.id });
    const first = await auth(
      request(app).post(`/api/chat/booking-requests/${booking.id}/customer-cancel`), customer,
    ).send({});
    expect(first.status).toBe(200);
    const second = await auth(
      request(app).post(`/api/chat/booking-requests/${booking.id}/customer-cancel`), customer,
    ).send({});
    expect(second.status).toBe(409);

    const missing = await auth(
      request(app).post(`/api/chat/booking-requests/${crypto.randomUUID()}/customer-cancel`), customer,
    ).send({});
    expect(missing.status).toBe(404);
  });
});
