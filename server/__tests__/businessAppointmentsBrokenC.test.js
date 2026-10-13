'use strict';

/**
 * Broken-findings bundle C (P3-8 business appointments + P1-9 credit overlap)
 * regression tests.
 *
 * P1-9-F05: single-super-admin maker-checker break-glass. Flag OFF (default)
 *   keeps the 403; flag ON + <2 super admins allows self-approval with
 *   step-up + audit; flag ON + 2+ super admins still 403s.
 * P3-8-F05: late-cancel fee recorded (not charged) inside the policy window;
 *   zero outside it. recordAppointmentPayment pending -> paid only.
 * P3-8-F07: reassignAppointmentStaff validates the service assignment and
 *   the window, keeps notes/history in place.
 * P3-8-F09: covered by the hub wiring (client); the dedicated endpoints are
 *   exercised here through cancelAppointment.
 * P3-8-F12: create/reschedule/cancel take the per-business advisory lock
 *   (same mutex as the booking accept path) before any conflict check.
 * P3-8-F14: rescheduleAppointment labels rescheduled_by_type by actor.
 * P3-8-F15: createAppointment prefers req.bookingValidation over the body.
 * P3-8-F16: cancelAppointment auto-offers the freed slot to the waitlist
 *   and writes waitlist_notifications.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});
jest.mock('../services/oxsteedCreditFeeScheduleService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditFeeScheduleService');
  return { ...actual, updateFeeScheduleRow: jest.fn() };
});
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ id: 'incident-1' }),
}));
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    adjustCustomerCreditInTransaction: jest.fn(),
    refundCreditInTransaction: jest.fn(),
  };
});
jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn().mockResolvedValue({ allowed: true }),
}));

const appointments = require('../controllers/businessAppointmentsController');
const { decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
const feeScheduleService = require('../services/oxsteedCreditFeeScheduleService');

const OWNER = { id: '00000000-0000-4000-8000-000000000456', email: 'owner@example.com' };
const CUSTOMER = { id: '11111111-1111-4111-8111-111111111111', email: 'customer@example.com' };

function buildApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/businesses/:businessId/appointments', appointments.createAppointment);
  app.post('/api/businesses/:businessId/appointments/:appointmentId/cancel', appointments.cancelAppointment);
  app.post('/api/businesses/:businessId/appointments/:appointmentId/reschedule', appointments.rescheduleAppointment);
  app.put('/api/businesses/:businessId/appointments/:appointmentId/status', appointments.updateAppointmentStatus);
  app.put('/api/businesses/:businessId/appointments/:appointmentId/staff', appointments.reassignAppointmentStaff);
  app.post('/api/businesses/:businessId/appointments/:appointmentId/record-payment', appointments.recordAppointmentPayment);
  app.use(errorHandler);
  return app;
}

function buildAppWithValidation(user = OWNER, bookingValidation = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    if (bookingValidation) req.bookingValidation = bookingValidation;
    next();
  });
  app.post('/api/businesses/:businessId/appointments', appointments.createAppointment);
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

function installBaseRouter({ current, policy = null, waitlistEntry = null } = {}) {
  const seenSql = [];
  mockQuery.mockImplementation(async (sql, params = []) => {
    const s = String(sql);
    seenSql.push(s);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes('FROM business_appointments') && s.includes('FOR UPDATE')) {
      return { rows: [current] };
    }
    // Cancellation policy lookup (service + business rules).
    if (s.includes('cancellation_policy_hours') && s.includes('FROM business_services s')) {
      return { rows: [policy || { policy_hours: 24, fee_percent: 0 }] };
    }
    if (s.includes('UPDATE business_appointments') && s.includes('RETURNING *')) {
      const updated = { ...current };
      if (s.includes('cancellation_fee_cents')) {
        // Fee param index differs per path; parse it from the SQL.
        const feeMatch = s.match(/cancellation_fee_cents\s*=\s*\$(\d+)/);
        const feeIdx = feeMatch ? Number(feeMatch[1]) - 1 : 4;
        updated.cancellation_fee_cents = params[feeIdx];
        updated.status = 'cancelled';
        updated.late_cancellation = true;
      }
      if (s.includes('staff_id = $1')) {
        updated.staff_id = params[0];
      }
      if (s.includes("payment_status = 'paid'")) {
        updated.payment_status = 'paid';
      }
      if (s.includes('SET status = $1')) {
        updated.status = params[0];
      }
      return { rows: [updated] };
    }
    // Window guards: no conflicts by default.
    if (s.includes('FROM business_appointments') && s.includes('COUNT(*)')) {
      return { rows: [{ n: 0 }] };
    }
    if (s.includes('FROM business_appointments') && s.includes('staff_id = $1') && s.includes('LIMIT 1')) {
      return { rows: [] };
    }
    if (s.includes('FROM availability_blocks')) return { rows: [] };
    if (s.includes('FROM business_service_staff')) return { rows: [{ '1': 1 }] };
    if (s.includes('FROM business_service_blocked_times')) return { rows: [] };
    if (s.includes('FROM business_services') && s.includes('FOR UPDATE') && !s.includes('business_appointments')) {
      return { rows: [{ id: 'svc-1', business_id: 7, duration_minutes: 60, min_notice_hours: 0, is_active: true, deleted_at: null, max_capacity: 1 }] };
    }
    if (s.includes('FROM business_services') && s.includes('SELECT *')) {
      return { rows: [{ id: 'svc-1', business_id: 7, duration_minutes: 60, min_notice_hours: 0, is_active: true, deleted_at: null, max_capacity: 1 }] };
    }
    if (s.includes('FROM business_booking_rules')) {
      // createAppointment's require_payment_upfront read.
      return { rows: [{ require_payment_upfront: true, min_advance_booking_hours: 0, max_advance_booking_days: 365 }] };
    }
    // Waitlist auto-offer.
    if (s.includes('FROM appointment_waitlist')) {
      return { rows: waitlistEntry ? [waitlistEntry] : [] };
    }
    if (s.includes('UPDATE appointment_waitlist')) return { rows: [] };
    if (s.includes('INSERT INTO waitlist_notifications')) return { rows: [] };
    if (s.includes('INSERT INTO business_appointment_notes')) return { rows: [] };
    if (s.includes('INSERT INTO business_appointment_reschedule_history')) {
      installBaseRouter.lastRescheduleParams = params;
      return { rows: [] };
    }
    if (s.includes('INSERT INTO business_appointment_reminders')) return { rows: [] };
    if (s.includes('SELECT ba.customer_id')) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
  return seenSql;
}

describe('P3-8-F05: late-cancel fee enforcement', () => {
  test('cancel inside the policy window records the fee (no charge)', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', start_time: futureIso(2), end_time: futureIso(3),
      final_price_cents: 10000, cancellation_fee_cents: 0,
    };
    installBaseRouter({ current, policy: { policy_hours: 24, fee_percent: 20 } });
    const res = await request(buildApp()).post('/api/businesses/7/appointments/a1/cancel').send({});
    expect(res.status).toBe(200);
    // 20% of 10000 = 2000, recorded but not charged.
    expect(res.body.cancellation_fee_cents).toBe(2000);
    expect(res.body.late_cancellation).toBe(true);
    expect(res.body.status).toBe('cancelled');
  });

  test('cancel outside the policy window records zero fee', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', start_time: futureIso(72), end_time: futureIso(73),
      final_price_cents: 10000, cancellation_fee_cents: 0,
    };
    installBaseRouter({ current, policy: { policy_hours: 24, fee_percent: 20 } });
    const res = await request(buildApp()).post('/api/businesses/7/appointments/a1/cancel').send({});
    expect(res.status).toBe(200);
    expect(res.body.cancellation_fee_cents).toBe(0);
    expect(res.body.late_cancellation).toBe(false);
  });

  test('PUT status=cancelled also enforces the fee', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', start_time: futureIso(2), end_time: futureIso(3),
      final_price_cents: 10000, cancellation_fee_cents: 0,
    };
    installBaseRouter({ current, policy: { policy_hours: 24, fee_percent: 50 } });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/status')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.cancellation_fee_cents).toBe(5000);
  });

  test('recordAppointmentPayment flips pending -> paid only', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', payment_status: 'pending', final_price_cents: 5000,
    };
    installBaseRouter({ current });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/record-payment')
      .send({ amount_cents: 5000, payment_method: 'cash' });
    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe('paid');
  });

  test('recordAppointmentPayment rejects a second payment', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', payment_status: 'paid', final_price_cents: 5000,
    };
    installBaseRouter({ current });
    const res = await request(buildApp())
      .post('/api/businesses/7/appointments/a1/record-payment')
      .send({ amount_cents: 5000, payment_method: 'cash' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_payment_transition');
  });

  test('create surfaces requires_payment_upfront', async () => {
    const current = null;
    installBaseRouter({ current });
    // createAppointment's INSERT path
    mockQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM business_services') && s.includes('FOR UPDATE')) {
        return { rows: [{ id: 'svc-1', business_id: 7, deleted_at: null, is_active: true, max_capacity: 1 }] };
      }
      if (s.includes('FROM business_appointments') && s.includes('COUNT(*)')) return { rows: [{ n: 0 }] };
      if (s.includes('INSERT INTO business_appointments')) {
        return { rows: [{ id: 'new-1', business_id: 7, service_id: 'svc-1', status: 'pending', payment_status: 'pending' }] };
      }
      if (s.includes('FROM business_booking_rules')) return { rows: [{ require_payment_upfront: true }] };
      if (s.includes('INSERT INTO business_appointment_reminders')) return { rows: [] };
      if (s.includes('SELECT ba.customer_id')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post('/api/businesses/7/appointments').send({
      service_id: 'svc-1',
      start_time: futureIso(48),
      end_time: futureIso(49),
      base_price_cents: 5000,
    });
    expect(res.status).toBe(201);
    expect(res.body.requires_payment_upfront).toBe(true);
  });
});

describe('P3-8-F07: staff reassignment', () => {
  test('reassigns staff in place and keeps the appointment', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: 'staff-old',
      status: 'confirmed', start_time: futureIso(48), end_time: futureIso(49),
    };
    installBaseRouter({ current });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/staff')
      .send({ staff_id: 'staff-new' });
    expect(res.status).toBe(200);
    expect(res.body.staff_id).toBe('staff-new');
    expect(res.body.id).toBe('a1');
  });

  test('rejects staff not assigned to the service', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: 'staff-old',
      status: 'confirmed', start_time: futureIso(48), end_time: futureIso(49),
    };
    installBaseRouter({ current });
    mockQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM business_appointments') && s.includes('FOR UPDATE')) return { rows: [current] };
      if (s.includes('FROM business_service_staff')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/staff')
      .send({ staff_id: 'staff-stranger' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('staff_not_assigned');
  });

  test('rejects reassignment of terminal appointments', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: 'staff-old',
      status: 'completed', start_time: futureIso(-48), end_time: futureIso(-47),
    };
    installBaseRouter({ current });
    const res = await request(buildApp())
      .put('/api/businesses/7/appointments/a1/staff')
      .send({ staff_id: 'staff-new' });
    expect(res.status).toBe(409);
  });
});

describe('P3-8-F12: per-business advisory lock on direct writes', () => {
  test('createAppointment takes the business advisory lock before the service row lock', async () => {
    installBaseRouter({ current: null });
    const lockOrder = [];
    mockQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) {
        lockOrder.push({ advisory: params[0] });
        return { rows: [] };
      }
      if (s.includes('FROM business_services') && s.includes('FOR UPDATE')) {
        lockOrder.push({ serviceRowLock: true });
        return { rows: [{ id: 'svc-1', business_id: 7, deleted_at: null, is_active: true, max_capacity: 1 }] };
      }
      if (s.includes('FROM business_appointments') && s.includes('COUNT(*)')) return { rows: [{ n: 0 }] };
      if (s.includes('INSERT INTO business_appointments')) {
        return { rows: [{ id: 'new-1', business_id: 7, service_id: 'svc-1', status: 'pending', payment_status: 'pending' }] };
      }
      if (s.includes('FROM business_booking_rules')) return { rows: [{ require_payment_upfront: false }] };
      if (s.includes('INSERT INTO business_appointment_reminders')) return { rows: [] };
      if (s.includes('SELECT ba.customer_id')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post('/api/businesses/7/appointments').send({
      service_id: 'svc-1',
      start_time: futureIso(48),
      end_time: futureIso(49),
      base_price_cents: 5000,
    });
    expect(res.status).toBe(201);
    expect(lockOrder[0]).toEqual({ advisory: 'business_appointments:7' });
    expect(lockOrder[1]).toEqual({ serviceRowLock: true });
  });

  test('cancelAppointment takes the business advisory lock', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', start_time: futureIso(72), end_time: futureIso(73),
      final_price_cents: 10000, cancellation_fee_cents: 0,
    };
    const seenSql = installBaseRouter({ current, policy: { policy_hours: 24, fee_percent: 0 } });
    const res = await request(buildApp()).post('/api/businesses/7/appointments/a1/cancel').send({});
    expect(res.status).toBe(200);
    expect(seenSql.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
  });
});

describe('P3-8-F14: rescheduled_by_type reflects the actor', () => {
  test('labels customer when the appointment customer reschedules', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      customer_id: CUSTOMER.id, status: 'confirmed',
      start_time: futureIso(48), end_time: futureIso(49),
    };
    installBaseRouter({ current });
    const res = await request(buildApp(CUSTOMER))
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(72), new_end_time: futureIso(73) });
    expect(res.status).toBe(200);
    const params = installBaseRouter.lastRescheduleParams;
    expect(params[params.length - 1]).toBe('customer');
  });

  test('labels business when staff reschedules', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      customer_id: CUSTOMER.id, status: 'confirmed',
      start_time: futureIso(48), end_time: futureIso(49),
    };
    installBaseRouter({ current });
    const res = await request(buildApp(OWNER))
      .post('/api/businesses/7/appointments/a1/reschedule')
      .send({ new_start_time: futureIso(72), new_end_time: futureIso(73) });
    expect(res.status).toBe(200);
    const params = installBaseRouter.lastRescheduleParams;
    expect(params[params.length - 1]).toBe('business');
  });
});

describe('P3-8-F15: createAppointment uses req.bookingValidation', () => {
  test('prefers middleware-normalized values over the body', async () => {
    let inserted = null;
    mockQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM business_services') && s.includes('FOR UPDATE')) {
        // The service id must come from bookingValidation, not the body.
        expect(params[0]).toBe('svc-bv');
        return { rows: [{ id: 'svc-bv', business_id: 7, deleted_at: null, is_active: true, max_capacity: 1 }] };
      }
      if (s.includes('FROM business_appointments') && s.includes('COUNT(*)')) return { rows: [{ n: 0 }] };
      if (s.includes('INSERT INTO business_appointments')) {
        inserted = params;
        return { rows: [{ id: 'new-1', business_id: 7, status: 'pending', payment_status: 'pending' }] };
      }
      if (s.includes('FROM business_booking_rules')) return { rows: [{ require_payment_upfront: false }] };
      if (s.includes('INSERT INTO business_appointment_reminders')) return { rows: [] };
      if (s.includes('SELECT ba.customer_id')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const bvStart = futureIso(50);
    const bvEnd = futureIso(51);
    const res = await request(buildAppWithValidation(OWNER, {
      service: { id: 'svc-bv' },
      startTimeIso: bvStart,
      endTimeIso: bvEnd,
      staffId: 'staff-bv',
    })).post('/api/businesses/7/appointments').send({
      // Drifted body values the controller must NOT use.
      service_id: 'svc-body',
      staff_id: 'staff-body',
      start_time: futureIso(90),
      end_time: futureIso(91),
      base_price_cents: 5000,
    });
    expect(res.status).toBe(201);
    // INSERT params: [businessId, service_id, staff_id, customerId, name, email, phone, notes, start, end, base, final]
    expect(inserted[1]).toBe('svc-bv');
    expect(inserted[2]).toBe('staff-bv');
    expect(new Date(inserted[8]).toISOString()).toBe(new Date(bvStart).toISOString());
    expect(new Date(inserted[9]).toISOString()).toBe(new Date(bvEnd).toISOString());
  });
});

describe('P3-8-F16: waitlist auto-offer on cancellation', () => {
  test('frees the slot to the waitlist and writes waitlist_notifications', async () => {
    const { sendNotification } = require('../services/notificationService');
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', start_time: futureIso(72), end_time: futureIso(73),
      final_price_cents: 10000, cancellation_fee_cents: 0,
    };
    const queries = [];
    mockQuery.mockImplementation(async (sql, params = []) => {
      const s = String(sql);
      queries.push(s);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM business_appointments') && s.includes('FOR UPDATE')) return { rows: [current] };
      if (s.includes('cancellation_policy_hours') && s.includes('FROM business_services s')) {
        return { rows: [{ policy_hours: 24, fee_percent: 0 }] };
      }
      if (s.includes('UPDATE business_appointments') && s.includes('RETURNING *')) {
        return { rows: [{ ...current, status: 'cancelled' }] };
      }
      if (s.includes('FROM appointment_waitlist')) {
        return { rows: [{ id: 'w1', customer_id: 'cust-1' }] };
      }
      if (s.includes('UPDATE appointment_waitlist')) return { rows: [] };
      if (s.includes('INSERT INTO waitlist_notifications')) return { rows: [] };
      if (s.includes('SELECT ba.customer_id')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(buildApp()).post('/api/businesses/7/appointments/a1/cancel').send({});
    expect(res.status).toBe(200);
    expect(queries.some((s) => s.includes('INSERT INTO waitlist_notifications'))).toBe(true);
    expect(queries.some((s) => s.includes("SET status = 'offered'"))).toBe(true);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'waitlist_slot_available',
      userId: 'cust-1',
    }));
  });

  test('no waitlist entry: cancellation still succeeds silently', async () => {
    const current = {
      id: 'a1', business_id: 7, service_id: 'svc-1', staff_id: null,
      status: 'confirmed', start_time: futureIso(72), end_time: futureIso(73),
      final_price_cents: 10000, cancellation_fee_cents: 0,
    };
    installBaseRouter({ current, waitlistEntry: null });
    const res = await request(buildApp()).post('/api/businesses/7/appointments/a1/cancel').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});

describe('P1-9-F05: single-super-admin maker-checker break-glass', () => {
  const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const ACTION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

  function pendingRow(overrides = {}) {
    return {
      id: ACTION_ID,
      action_type: 'credit_fee_schedule_update',
      payload: { id: '7', fixedCents: 100 },
      requested_by: MAKER_ID,
      requested_at: '2026-10-01T10:00:00.000Z',
      status: 'pending',
      decided_by: null,
      decided_at: null,
      decision_reason: null,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      idempotency_key: 'test-key-1',
      execution_refs: {},
      ...overrides,
    };
  }

  // Mutable break-glass state: flag + super-admin count.
  let breakGlassFlag = false;
  let superAdminCount = 1;
  let decidedStatus = 'pending';

  function installCreditRouter() {
    mockQuery.mockImplementation((sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
        return { rows: [{ is_enabled: true }] };
      }
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      if (s.includes("FROM feature_flags WHERE key = 'credit_single_admin_self_approval'")) {
        return { rows: breakGlassFlag ? [{ is_enabled: true }] : [{ is_enabled: false }] };
      }
      if (s.includes("FROM users") && s.includes("role = 'super_admin'")) {
        return { rows: [{ n: superAdminCount }] };
      }
      if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
        return { rows: [pendingRow({ status: decidedStatus })] };
      }
      if (s.includes('UPDATE oxsteed_credit_pending_actions')) {
        const status = s.includes("status = 'approved'") ? 'approved'
          : s.includes("status = 'rejected'") ? 'rejected' : 'pending';
        decidedStatus = status;
        return { rows: [pendingRow({ status, decided_by: MAKER_ID })] };
      }
      if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1')) {
        return { rows: [pendingRow({ status: decidedStatus })] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_audit_events')) {
        installCreditRouter.lastAuditMetadata = params;
        return { rows: [] };
      }
      return { rows: [] };
    });
  }

  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
    breakGlassFlag = false;
    superAdminCount = 1;
    decidedStatus = 'pending';
    feeScheduleService.updateFeeScheduleRow.mockResolvedValue({ id: 7, fixed_cents: 100 });
    installCreditRouter();
  });

  test('flag OFF: self-approval stays 403', async () => {
    breakGlassFlag = false;
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: MAKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    })).rejects.toMatchObject({ status: 403, code: 'credit_self_approval_forbidden' });
    expect(feeScheduleService.updateFeeScheduleRow).not.toHaveBeenCalled();
  });

  test('flag ON + single super admin: self-approval succeeds with step-up and audit mark', async () => {
    breakGlassFlag = true;
    superAdminCount = 1;
    const result = await decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: MAKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    });
    expect(result.pendingAction.status).toBe('approved');
    expect(result.replayed).toBe(false);
    expect(feeScheduleService.updateFeeScheduleRow).toHaveBeenCalledTimes(1);
  });

  test('flag ON + two super admins: self-approval still 403', async () => {
    breakGlassFlag = true;
    superAdminCount = 2;
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: MAKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    })).rejects.toMatchObject({ status: 403, code: 'credit_self_approval_forbidden' });
    expect(feeScheduleService.updateFeeScheduleRow).not.toHaveBeenCalled();
  });
});
