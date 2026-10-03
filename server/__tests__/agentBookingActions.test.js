'use strict';

/**
 * server/__tests__/agentBookingActions.test.js
 *
 * Agent-initiated booking cancellation:
 *  - grant gating: 403 without the `issue_refunds` grant
 *  - reason is required: 400 on empty/missing reason
 *  - happy path: pending -> cancelled / accepted -> accepted_cancelled,
 *    linked appointment cancelled, audit row with admin actor + reason,
 *    notifications to BOTH parties
 *  - idempotent: already-cancelled returns 200 with already_cancelled,
 *    no re-apply and no re-notify
 *  - fail closed: non-cancellable states 409; concurrent state change
 *    rolls back with no audit write
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

// Pass-through auth so the REAL grant middleware is exercised.
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  },
}));
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, _res, next) => {
      req.user = req.user || { id: 'admin-1', role: 'admin' };
      req.isSuper = false;
      next();
    },
  };
});
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const agentBookingRoutes = require('../routes/agentBookingActions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/bookings', agentBookingRoutes);
  return app;
}

const grantRows = (rows) => ({ rows });

const baseBooking = (overrides = {}) => ({
  id: 'b1',
  customer_id: 'cust-1',
  helper_id: 'help-1',
  business_id: null,
  service_name: 'Deep clean',
  requested_date: '2026-10-06',
  status: 'pending',
  appointment_id: null,
  business_appointment_id: null,
  helper_response_reason: null,
  ...overrides,
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('POST /api/agent/bookings/:bookingId/cancel', () => {
  test('rejects 403 when the admin lacks the issue_refunds grant', async () => {
    mockQuery.mockResolvedValueOnce(grantRows([])); // grant check finds nothing

    const res = await request(buildApp())
      .post('/api/agent/bookings/b1/cancel')
      .send({ reason: 'Customer asked to cancel via support' });

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1); // stopped at the gate: no booking read
  });

  test('rejects 400 when reason is missing or empty', async () => {
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }]))
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }]))
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }]));

    for (const body of [{}, { reason: '' }, { reason: '   ' }]) {
      const res = await request(buildApp())
        .post('/api/agent/bookings/b1/cancel')
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('reason_required');
    }
    // Grant check ran each time, but no booking was ever read.
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  test('404s on unknown booking', async () => {
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }]))
      .mockResolvedValueOnce(grantRows([])); // SELECT booking: none

    const res = await request(buildApp())
      .post('/api/agent/bookings/nope/cancel')
      .send({ reason: 'spam' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('cancels a pending booking: status, audit (admin actor + reason), both parties notified', async () => {
    const booking = baseBooking({ status: 'pending' });
    const updated = { ...booking, status: 'cancelled' };
    // NOTE: __tests__/setup.js replaces withTransaction with a linear
    // pool.query runner, so mock queues omit BEGIN/COMMIT here.
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }])) // grant
      .mockResolvedValueOnce({ rows: [booking] })                     // SELECT booking
      .mockResolvedValueOnce({ rows: [updated] })                     // UPDATE booking_requests
      .mockResolvedValueOnce({ rows: [] });                           // INSERT audit

    const res = await request(buildApp())
      .post('/api/agent/bookings/b1/cancel')
      .send({ reason: 'Customer requested cancellation through support' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('cancelled');

    const updateCall = mockQuery.mock.calls.find((c) =>
      c[0].includes('UPDATE booking_requests')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('status = $2');
    expect(updateCall[1]).toEqual(expect.arrayContaining(['b1', 'cancelled', 'pending']));

    const auditCall = mockQuery.mock.calls.find((c) =>
      c[0].includes('INSERT INTO booking_request_audit_log')
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1]).toEqual(
      expect.arrayContaining(['b1', 'admin_booking_cancel', 'admin-1', 'pending', 'cancelled'])
    );
    expect(auditCall[1][5]).toContain('Customer requested cancellation through support');

    // Both parties notified via the shared notification infra.
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const notified = sendNotification.mock.calls.map((c) => c[0].userId).sort();
    expect(notified).toEqual(['cust-1', 'help-1']);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'booking_cancelled' })
    );
    expect(broadcastToUser).toHaveBeenCalledWith(
      'cust-1',
      'booking:updated',
      expect.objectContaining({ status: 'cancelled' })
    );
    expect(broadcastToUser).toHaveBeenCalledWith(
      'help-1',
      'booking:updated',
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  test('cancels an accepted booking and its linked appointment', async () => {
    const booking = baseBooking({ status: 'accepted', appointment_id: 'appt-9' });
    const updated = { ...booking, status: 'accepted_cancelled' };
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }])) // grant
      .mockResolvedValueOnce({ rows: [booking] })                     // SELECT booking
      .mockResolvedValueOnce({ rows: [updated] })                     // UPDATE booking_requests
      .mockResolvedValueOnce({ rows: [{ id: 'appt-9' }] })            // cancel linked appointment
      .mockResolvedValueOnce({ rows: [] });                           // INSERT audit

    const res = await request(buildApp())
      .post('/api/agent/bookings/b1/cancel')
      .send({ reason: 'Duplicate booking' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted_cancelled');

    const apptCall = mockQuery.mock.calls.find((c) =>
      c[0].includes("SET status = 'cancelled'") && c[0].includes('appointments')
    );
    expect(apptCall).toBeDefined();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  test('idempotent: already-cancelled booking returns 200 without re-applying or re-notifying', async () => {
    const booking = baseBooking({ status: 'cancelled' });
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }])) // grant
      .mockResolvedValueOnce({ rows: [booking] });                     // SELECT booking

    const res = await request(buildApp())
      .post('/api/agent/bookings/b1/cancel')
      .send({ reason: 'trying again' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.already_cancelled).toBe(true);

    // No UPDATE, no audit INSERT, no notifications.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(
      mockQuery.mock.calls.some((c) => c[0].includes('UPDATE booking_requests'))
    ).toBe(false);
    expect(
      mockQuery.mock.calls.some((c) => c[0].includes('INSERT INTO booking_request_audit_log'))
    ).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(broadcastToUser).not.toHaveBeenCalled();
  });

  test('rejects 409 on a non-cancellable state (fail closed, no writes)', async () => {
    const booking = baseBooking({ status: 'completed' });
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }])) // grant
      .mockResolvedValueOnce({ rows: [booking] });                     // SELECT booking

    const res = await request(buildApp())
      .post('/api/agent/bookings/b1/cancel')
      .send({ reason: 'nope' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('booking_not_cancellable');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('fail closed: concurrent state change writes nothing and notifies nobody', async () => {
    const booking = baseBooking({ status: 'pending' });
    mockQuery
      .mockResolvedValueOnce(grantRows([{ id: 11, region_id: null }])) // grant
      .mockResolvedValueOnce({ rows: [booking] })                     // SELECT booking
      .mockResolvedValueOnce({ rows: [] });                           // UPDATE: state changed, 0 rows

    const res = await request(buildApp())
      .post('/api/agent/bookings/b1/cancel')
      .send({ reason: 'race' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('state_conflict');
    expect(
      mockQuery.mock.calls.some((c) => c[0].includes('INSERT INTO booking_request_audit_log'))
    ).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
