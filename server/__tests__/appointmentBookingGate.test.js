'use strict';

// Review P1-6-F03: the customer appointment API must honor the helper's
// "allow booking" switch (helper_profiles.allow_booking = false → 403).

const { mockQuery, resetMocks } = require('./setup');
const { createAppointment } = require('../controllers/appointmentController');
const { AppError } = require('../utils/apiError');

const HELPER_ID = '00000000-0000-4000-8000-0000000000aa';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000bb';

beforeEach(() => resetMocks());

function validReq() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    user: { id: CUSTOMER_ID },
    body: {
      helper_id: HELPER_ID,
      service_description: 'Fix the leaking sink',
      scheduled_start_time: start.toISOString(),
      scheduled_end_time: end.toISOString(),
    },
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function baseDb(allowBooking) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM users/.test(sql)) {
      return { rows: [{ id: HELPER_ID, role: 'helper', is_active: true, deleted_at: null }] };
    }
    if (/FROM helper_profiles/.test(sql)) {
      return allowBooking == null ? { rows: [] } : { rows: [{ allow_booking: allowBooking }] };
    }
    if (/INSERT INTO appointments/.test(sql)) {
      return { rows: [{ id: 'appt-1', helper_id: HELPER_ID, customer_id: CUSTOMER_ID, status: 'requested' }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('appointmentController.createAppointment booking gate (P1-6-F03)', () => {
  test('403s when the helper switched booking off', async () => {
    baseDb(false);
    const next = jest.fn();
    await createAppointment(validReq(), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('booking_disabled');
    // The appointment insert must never run.
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO appointments/.test(sql))).toBe(false);
  });

  test('proceeds when booking is allowed', async () => {
    baseDb(true);
    const next = jest.fn();
    await createAppointment(validReq(), mockRes(), next);

    const bookingDisabled = next.mock.calls.some(
      ([err]) => err && err.code === 'booking_disabled'
    );
    expect(bookingDisabled).toBe(false);
    // The flow reached the appointment insert.
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO appointments/.test(sql))).toBe(true);
  });

  test('proceeds when the helper has no profile row (default allow)', async () => {
    baseDb(null);
    const next = jest.fn();
    await createAppointment(validReq(), mockRes(), next);

    const bookingDisabled = next.mock.calls.some(
      ([err]) => err && err.code === 'booking_disabled'
    );
    expect(bookingDisabled).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO appointments/.test(sql))).toBe(true);
  });
});
