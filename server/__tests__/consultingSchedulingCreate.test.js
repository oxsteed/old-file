'use strict';

// Minimal consulting booking path: POST /scheduling/sessions creates the
// pending_confirmation scheduled row, that row satisfies the payment-intent
// "must be scheduled" check, and book-slot flips it to confirmed.

jest.mock('../services/modePlatformApprovalService', () => ({
  canPerformAction: jest.fn().mockResolvedValue({ allowed: true }),
}));

const { mockQuery, resetMocks } = require('./setup');
const stripeMock = require('stripe').__mockInstance;
const schedulingCtrl = require('../controllers/consultantSchedulingController');
const paymentCtrl = require('../controllers/consultingPaymentController');

function res() {
  const r = { statusCode: 200 };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  return r;
}

const CONSULTANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ROW = { id: 1, user_id: OWNER_ID, consultant_assigned_id: CONSULTANT_ID };
const PLACEHOLDER_ROW = {
  id: 99, session_id: 1, scheduled_date: '1970-01-01', scheduled_time: '00:00:00',
  duration_minutes: 120, consultant_assigned_id: CONSULTANT_ID, meeting_link: null,
  timezone: 'America/New_York', status: 'pending_confirmation',
};

beforeEach(() => {
  resetMocks();
  stripeMock.paymentIntents.create.mockReset();
  stripeMock.paymentIntents.retrieve.mockReset();
});

describe('POST /scheduling/sessions (createScheduledSession)', () => {
  test('creates a pending_confirmation row for the session owner and returns its id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SESSION_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: CONSULTANT_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [PLACEHOLDER_ROW] });
    const r = res();
    await schedulingCtrl.createScheduledSession(
      { user: { id: OWNER_ID, role: 'customer' }, body: { consultingSessionId: 1, consultantId: CONSULTANT_ID } },
      r,
    );
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ id: 99, status: 'pending_confirmation' });
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO consulting_sessions_scheduled/.test(sql));
    expect(insert).toBeDefined();
    expect(insert[0]).toMatch(/'1970-01-01'/);
    expect(insert[0]).toMatch(/'pending_confirmation'/);
    expect(insert[1]).toEqual([1, CONSULTANT_ID]);
  });

  test('403 for a caller who does not own the session, and no row is created', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SESSION_ROW] });
    const r = res();
    await schedulingCtrl.createScheduledSession(
      { user: { id: OTHER_ID, role: 'customer' }, body: { consultingSessionId: 1, consultantId: CONSULTANT_ID } },
      r,
    );
    expect(r.statusCode).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO consulting_sessions_scheduled/.test(sql))).toBe(false);
  });

  test('404 for an unknown session', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await schedulingCtrl.createScheduledSession(
      { user: { id: OWNER_ID, role: 'customer' }, body: { consultingSessionId: 999, consultantId: CONSULTANT_ID } },
      r,
    );
    expect(r.statusCode).toBe(404);
  });

  test('returns the existing row instead of inserting a duplicate', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SESSION_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: CONSULTANT_ID }] })
      .mockResolvedValueOnce({ rows: [PLACEHOLDER_ROW] });
    const r = res();
    await schedulingCtrl.createScheduledSession(
      { user: { id: OWNER_ID, role: 'customer' }, body: { consultingSessionId: 1, consultantId: CONSULTANT_ID } },
      r,
    );
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ id: 99, alreadyScheduled: true });
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO consulting_sessions_scheduled/.test(sql))).toBe(false);
  });

  test('rejects an inactive or soft-deleted consultant before creating the payment placeholder', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SESSION_ROW] })
      .mockResolvedValueOnce({ rows: [] });
    const r = res();
    await schedulingCtrl.createScheduledSession(
      { user: { id: OWNER_ID, role: 'customer' }, body: { consultingSessionId: 1, consultantId: CONSULTANT_ID } },
      r,
    );
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'Consultant not found' });
    expect(mockQuery.mock.calls[1][0]).toContain('is_active = TRUE');
    expect(mockQuery.mock.calls[1][0]).toContain('deleted_at IS NULL');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO consulting_sessions_scheduled/.test(sql))).toBe(false);
  });

  test('400 for a malformed preferredDate, and no row is created', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [SESSION_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: CONSULTANT_ID }] });
    const r = res();
    await schedulingCtrl.createScheduledSession(
      { user: { id: OWNER_ID, role: 'customer' }, body: { consultingSessionId: 1, consultantId: CONSULTANT_ID, preferredDate: 'not-a-date' } },
      r,
    );
    expect(r.statusCode).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO consulting_sessions_scheduled/.test(sql))).toBe(false);
  });
});

describe('placeholder row unblocks the rest of the chain', () => {
  test('payment-intent no longer 400s "must be scheduled" once the row exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, user_id: OWNER_ID, scheduled_id: 99 }] })
      .mockResolvedValueOnce({ rows: [] }) // no processing payment
      .mockResolvedValueOnce({ rows: [] }) // no completed payment
      .mockResolvedValueOnce({ rows: [{ id: 2, service_tier: 'foundation', package_name: 'Foundation', base_price: 10000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 55, session_scheduled_id: 99 }] }); // payment INSERT
    stripeMock.paymentIntents.create.mockResolvedValueOnce({ id: 'pi_1', client_secret: 'sec_test' });
    const r = res();
    await paymentCtrl.createPaymentIntent(
      { user: { id: OWNER_ID, role: 'customer' }, body: { sessionId: 1, packageId: 2 } },
      r,
    );
    expect(r.statusCode).toBe(200);
    expect(r.body.clientSecret).toBe('sec_test');
    expect(r.body.payment.session_scheduled_id).toBe(99);
  });

  test('book-slot flips the placeholder row to confirmed', async () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM consulting_sessions_scheduled css\s+JOIN consulting_sessions/.test(sql)) {
        return { rows: [{ id: 99, session_id: 1, user_id: OWNER_ID, email: 'owner@example.com', first_name: 'Owner' }] };
      }
      if (/FROM consulting_payments\s+WHERE session_scheduled_id/.test(sql)) return { rows: [{ 1: 1 }] };
      if (/SELECT id FROM users\s+WHERE id = \$1 AND is_active = TRUE AND deleted_at IS NULL/.test(sql)) return { rows: [{ id: CONSULTANT_ID }] };
      if (/FROM get_consultant_available_slots/.test(sql)) return { rows: [{ 1: 1 }] };
      if (/UPDATE consulting_sessions_scheduled css_target/.test(sql)) {
        return { rows: [{ id: 99, session_id: 1, scheduled_date: future, scheduled_time: '10:00', status: 'confirmed' }] };
      }
      if (/FROM users WHERE id/.test(sql)) return { rows: [{ first_name: 'Casey', last_name: 'Consultant' }] };
      return { rows: [] };
    });
    const r = res();
    await schedulingCtrl.bookTimeSlot(
      { params: { sessionId: '99' }, user: { id: OWNER_ID, role: 'customer' },
        body: { consultantId: CONSULTANT_ID, date: future, startTime: '10:00', durationMinutes: 120 } },
      r,
    );
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ id: 99, status: 'confirmed', scheduled_date: future, scheduled_time: '10:00' });
    const update = mockQuery.mock.calls.find(([sql]) => /UPDATE consulting_sessions_scheduled css_target/.test(sql));
    expect(update[1]).toEqual([future, '10:00', 120, null, 'America/New_York', CONSULTANT_ID, '99', '10:00', '12:00']);
    // Drain the fire-and-forget confirmation email so it cannot leak into
    // the next test's mock queue.
    await new Promise((resolve) => setImmediate(resolve));
  });

  test('customer cannot move a scheduled session to another consultant', async () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 99,
      session_id: 1,
      consultant_assigned_id: CONSULTANT_ID,
      user_id: OWNER_ID,
      email: 'owner@example.com',
      first_name: 'Owner',
    }] });
    const r = res();
    await schedulingCtrl.bookTimeSlot(
      { params: { sessionId: '99' }, user: { id: OWNER_ID, role: 'customer' },
        body: {
          consultantId: OTHER_ID,
          date: future,
          startTime: '10:00',
          durationMinutes: 120,
        } },
      r,
    );
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'Consultant does not match the assigned consultant' });
    expect(mockQuery.mock.calls).toHaveLength(1);
  });

  test('book-slot rejects an inactive or soft-deleted consultant before payment or availability checks', async () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 99, session_id: 1, user_id: OWNER_ID, email: 'owner@example.com', first_name: 'Owner' }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = res();
    await schedulingCtrl.bookTimeSlot(
      { params: { sessionId: '99' }, user: { id: OWNER_ID, role: 'customer' },
        body: { consultantId: CONSULTANT_ID, date: future, startTime: '10:00', durationMinutes: 120 } },
      r,
    );
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'Consultant not found' });
    expect(mockQuery.mock.calls[1][0]).toContain('deleted_at IS NULL');
    expect(mockQuery.mock.calls.some(([sql]) => /FROM consulting_payments/.test(sql))).toBe(false);
  });
});
