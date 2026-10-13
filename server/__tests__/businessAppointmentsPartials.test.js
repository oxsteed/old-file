'use strict';

/**
 * Partial-findings bundle J (P3-8 business appointments) regression tests.
 *
 * F04: updateAppointmentStatus transition table is complete and no other
 *      endpoint mutates status around it (cancelAppointment locks terminal
 *      states too).
 * F06: the status endpoint records cancelled_at / cancelled_by when the hub
 *      cancels through PUT .../status='cancelled'.
 * F08: rescheduleAppointment enforces the create-path booking rules
 *      (service bookable, duration match, min/max advance, blocked times,
 *      no past times) and rejects terminal states.
 * F13: autoPostExpiredBooking links a paid deposit to the posted job and
 *      kicks the deposit refund instead of stranding it.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/bookingDepositService', () => ({
  settleTerminalBookingSoon: jest.fn(),
  settleTerminalBooking: jest.fn(),
}));

const appointments = require('../controllers/businessAppointmentsController');
const lifecycle = require('../services/bookingRequestLifecycle');
const bookingDeposits = require('../services/bookingDepositService');

const OWNER = { id: '00000000-0000-4000-8000-000000000456', email: 'owner@example.com' };

function buildApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.put('/api/businesses/:businessId/appointments/:appointmentId/status', appointments.updateAppointmentStatus);
  app.post('/api/businesses/:businessId/appointments/:appointmentId/cancel', appointments.cancelAppointment);
  app.post('/api/businesses/:businessId/appointments/:appointmentId/reschedule', appointments.rescheduleAppointment);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function futureIso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();
}

describe('F04: status transitions', () => {
  test('updateAppointmentStatus rejects pending -> completed (invalid jump)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'pending' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/status')
      .send({ status: 'completed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status_transition');
  });

  test('updateAppointmentStatus locks terminal states (completed -> cancelled rejected)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'completed' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/status')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status_transition');
  });

  test('updateAppointmentStatus allows confirmed -> in_progress', async () => {
    const updated = { id: 'a1', business_id: 7, status: 'in_progress' };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'confirmed' }] };
      }
      if (sql.startsWith('UPDATE business_appointments SET status')) {
        return { rows: [updated] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/status')
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  test('cancelAppointment rejects cancelling a completed appointment', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'completed' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/cancel')
      .send({ reason: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status_transition');
    // No cancellation write may have been issued.
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      sql.includes("SET status = 'cancelled'"),
    );
    expect(writes).toHaveLength(0);
  });

  test('cancelAppointment rejects cancelling a no_show appointment', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'no_show' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/cancel')
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status_transition');
  });

  test('cancelAppointment cancels a confirmed appointment with audit fields', async () => {
    const cancelled = {
      id: 'a1', business_id: 7, status: 'cancelled',
      cancelled_at: new Date().toISOString(), cancelled_by: 'business',
    };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'confirmed' }] };
      }
      if (sql.includes("SET status = 'cancelled'")) {
        return { rows: [cancelled] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/cancel')
      .send({ reason: 'customer asked' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancelled_at).toBeTruthy();
    expect(res.body.cancelled_by).toBe('business');
  });
});

describe('F06: status endpoint records cancellation audit fields', () => {
  test("PUT status='cancelled' writes cancelled_at/cancelled_by", async () => {
    let updateSql = null;
    let updateParams = null;
    const updated = {
      id: 'a1', business_id: 7, status: 'cancelled',
      cancelled_at: new Date().toISOString(), cancelled_by: 'business',
    };
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'confirmed' }] };
      }
      if (sql.startsWith('UPDATE business_appointments SET status')) {
        updateSql = sql;
        updateParams = params;
        return { rows: [updated] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/status')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(updateSql).toContain('cancelled_at');
    expect(updateSql).toContain('cancelled_by');
    expect(updateParams).toContain('business');
    expect(res.body.cancelled_at).toBeTruthy();
  });

  test('non-cancel transitions do not touch cancellation fields', async () => {
    let updateSql = null;
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'pending' }] };
      }
      if (sql.startsWith('UPDATE business_appointments SET status')) {
        updateSql = sql;
        return { rows: [{ id: 'a1', business_id: 7, status: 'confirmed' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/status')
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(updateSql).not.toContain('cancelled_at');
  });
});

describe('F08: reschedule enforces booking rules', () => {
  function mockRescheduleGuards({ origStatus = 'confirmed', blocked = false, rulesRow = null } = {}) {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM business_appointments') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: 'a1', business_id: 7, service_id: 5, staff_id: null,
            status: origStatus, start_time: futureIso(24), end_time: futureIso(25),
          }],
        };
      }
      if (sql.includes('FROM business_services') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ id: 5, duration_minutes: 60, min_notice_hours: 2, is_active: true, deleted_at: null }],
        };
      }
      if (sql.includes('FROM business_booking_rules')) {
        return { rows: rulesRow ? [rulesRow] : [] };
      }
      if (sql.includes('FROM business_service_blocked_times')) {
        return { rows: blocked ? [{ '1': 1 }] : [] };
      }
      if (sql.includes('SELECT max_capacity FROM business_services')) {
        return { rows: [{ max_capacity: 1 }] };
      }
      if (sql.includes('COUNT(*)') && sql.includes('FROM business_appointments')) {
        return { rows: [{ n: 0 }] };
      }
      if (sql.startsWith('UPDATE business_appointments')) {
        return { rows: [{ id: 'a1', business_id: 7, status: 'confirmed' }] };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('rejects rescheduling a completed appointment', async () => {
    mockRescheduleGuards({ origStatus: 'completed' });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(30), new_end_time: futureIso(31) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status_transition');
  });

  test('rejects rescheduling a no_show appointment', async () => {
    mockRescheduleGuards({ origStatus: 'no_show' });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(30), new_end_time: futureIso(31) });
    expect(res.status).toBe(409);
  });

  test('rejects a window whose duration does not match the service', async () => {
    mockRescheduleGuards();
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(30), new_end_time: futureIso(30.5) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('duration_mismatch');
  });

  test('rejects a window in the past', async () => {
    mockRescheduleGuards();
    const pastStart = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: pastStart, new_end_time: pastEnd });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('past_time');
  });

  test('rejects a window inside the minimum notice period', async () => {
    mockRescheduleGuards();
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(1), new_end_time: futureIso(2) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('min_notice_violated');
  });

  test('rejects a window on blocked business time', async () => {
    mockRescheduleGuards({ blocked: true });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(30), new_end_time: futureIso(31) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('time_blocked');
  });

  test('accepts a rule-clean reschedule', async () => {
    mockRescheduleGuards();
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(30), new_end_time: futureIso(31) });
    expect(res.status).toBe(200);
  });
});

describe('F13: auto-post links the paid deposit to the job', () => {
  const BOOKING_ID = 'b1';
  function mockAutoPost({ paymentStatus = 'paid', amountCents = 2500, intentId = 'pi_123' } = {}) {
    const booking = {
      id: BOOKING_ID,
      status: 'pending',
      auto_post_on_expiry: true,
      customer_id: 'cust-1',
      expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
      service_name: 'Deep clean',
      description: 'Please clean the kitchen.',
      requested_date: '2026-10-20',
      requested_start_time: '09:00',
      requested_end_time: '10:00',
      service_location: null,
      payment_status: paymentStatus,
      payment_amount_cents: amountCents,
      stripe_payment_intent_id: intentId,
    };
    let jobDescription = null;
    let jobUpdateParams = null;
    let auditMetadata = null;
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM booking_requests') && sql.includes('FOR UPDATE')) {
        return { rows: [booking] };
      }
      if (sql.includes('INSERT INTO jobs')) {
        jobDescription = params[2];
        return { rows: [{ id: 'job-1' }] };
      }
      if (sql.includes('UPDATE jobs') && sql.includes('source_booking_request_id')) {
        jobUpdateParams = params;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SET status = 'expired'")) {
        return { rows: [{ ...booking, status: 'expired', converted_to_job_id: 'job-1' }] };
      }
      if (sql.includes('INSERT INTO booking_request_audit_log')) {
        auditMetadata = JSON.parse(params[1]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    return {
      get jobDescription() { return jobDescription; },
      get jobUpdateParams() { return jobUpdateParams; },
      get auditMetadata() { return auditMetadata; },
    };
  }

  test('paid deposit is linked to the posted job and refunded', async () => {
    const spies = mockAutoPost();
    const result = await lifecycle.autoPostExpiredBooking(BOOKING_ID);
    expect(result.jobId).toBe('job-1');
    // Structured linkage on the job row.
    expect(spies.jobUpdateParams).toEqual(['job-1', BOOKING_ID, 2500]);
    // Customer-visible deposit line on the posted job.
    expect(spies.jobDescription).toContain('$25.00');
    expect(spies.jobDescription).toContain('refunded');
    // Audit trail carries the handoff.
    expect(spies.auditMetadata).toMatchObject({
      jobId: 'job-1',
      depositCents: 2500,
      depositRefundInitiated: true,
    });
    // The deposit refund is kicked explicitly, not left for the sweeper.
    expect(bookingDeposits.settleTerminalBookingSoon).toHaveBeenCalledWith(BOOKING_ID, 'auto_posted');
  });

  test('booking without a deposit posts with no linkage and no refund kick', async () => {
    const spies = mockAutoPost({ paymentStatus: 'not_required', amountCents: 0, intentId: null });
    const result = await lifecycle.autoPostExpiredBooking(BOOKING_ID);
    expect(result.jobId).toBe('job-1');
    expect(spies.jobUpdateParams).toBeNull();
    expect(spies.jobDescription).not.toContain('deposit');
    expect(spies.auditMetadata).toMatchObject({ depositCents: 0, depositRefundInitiated: false });
    expect(bookingDeposits.settleTerminalBookingSoon).not.toHaveBeenCalled();
  });

  test('ineligible booking returns null and settles nothing', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM booking_requests') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            id: BOOKING_ID, status: 'accepted', auto_post_on_expiry: true,
            customer_id: 'cust-1', expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
            payment_status: 'paid', payment_amount_cents: 2500, stripe_payment_intent_id: 'pi_123',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await lifecycle.autoPostExpiredBooking(BOOKING_ID);
    expect(result).toBeNull();
    expect(bookingDeposits.settleTerminalBookingSoon).not.toHaveBeenCalled();
  });
});
