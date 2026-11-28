'use strict';

// Weekly batch item 53(b)(c): bookTimeSlot emailed only the customer about
// the booked slot, and the consultant's only notice was the row-creation
// one carrying the 1970-01-01 sentinel date. Booking a slot must now tell
// the consultant too, by email and by a dated in-app notice.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/consultingPaymentService', () => ({
  isScheduledSessionPaid: jest.fn().mockResolvedValue(true),
}));
jest.mock('../utils/email', () => ({
  sendEmailOrThrow: jest.fn().mockResolvedValue({}),
}));
jest.mock('../utils/emailTemplate', () => ({
  renderOxSteedEmail: jest.fn().mockReturnValue({ html: '<p>hi</p>', text: 'hi' }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/access/flags', () => ({
  consultantEnforcement: jest.fn().mockReturnValue('off'),
}));
jest.mock('../services/access/consultantGate', () => ({
  checkPayingAccess: jest.fn().mockResolvedValue({ allowed: true }),
  bookingDenial: jest.fn((decision) => ({ error: 'denied', decision })),
}));

const { sendEmailOrThrow } = require('../utils/email');
const { sendNotification } = require('../services/notificationService');
const { bookTimeSlot } = require('../controllers/consultantSchedulingController');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function routeBookSlot(date) {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.includes('FROM consulting_sessions_scheduled css')) {
      return { rows: [{
        id: 'sched-1', session_id: 55, consultant_assigned_id: 'consultant-1',
        user_id: 'client-1', email: 'client@example.invalid', first_name: 'Clara',
      }] };
    }
    if (t.includes('SELECT id FROM users')) return { rows: [{ id: 'consultant-1' }] };
    if (t.includes('get_consultant_available_slots')) return { rows: [{ '1': 1 }] };
    if (t.includes('UPDATE consulting_sessions_scheduled css_target')) {
      return { rows: [{ id: 'sched-1', session_id: 55, scheduled_date: date, scheduled_time: '09:00', status: 'confirmed' }] };
    }
    if (t.includes('SELECT first_name, last_name, email FROM users')) {
      return { rows: [{ first_name: 'Carmen', last_name: 'Consult', email: 'consultant@example.invalid' }] };
    }
    return { rows: [] };
  });
}

test('booking a slot emails the consultant and sends a dated in-app notice', async () => {
  const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  routeBookSlot(date);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await bookTimeSlot(
    {
      params: { sessionId: 'sched-1' },
      body: { consultantId: 'consultant-1', date, startTime: '09:00', timezone: 'America/New_York', durationMinutes: 60 },
      user: { id: 'client-1', role: 'customer' },
    },
    res,
  );
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'sched-1', status: 'confirmed' }));
  // The confirmation email goes out in setImmediate; flush it.
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(sendEmailOrThrow).toHaveBeenCalledTimes(2);
  const customerEmail = sendEmailOrThrow.mock.calls.find(([arg]) => arg.to === 'client@example.invalid');
  expect(customerEmail).toBeDefined();
  expect(customerEmail[0].subject).toBe('Your Consulting Session is Confirmed');
  const consultantEmail = sendEmailOrThrow.mock.calls.find(([arg]) => arg.to === 'consultant@example.invalid');
  expect(consultantEmail).toBeDefined();
  expect(consultantEmail[0].subject).toBe('A Consulting Session Was Booked');
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'consultant-1',
    type: 'consulting_session_scheduled',
    action_url: '/consulting/contractor-dashboard',
    idempotencyKey: 'consulting-session-booked:sched-1',
  }));
  const notice = sendNotification.mock.calls[0][0];
  expect(notice.body).toContain('Session booked for');
  expect(notice.data).toMatchObject({
    session_id: 55,
    scheduled_session_id: 'sched-1',
    consultant_id: 'consultant-1',
    scheduled_date: date,
    scheduled_time: '09:00',
  });
});
