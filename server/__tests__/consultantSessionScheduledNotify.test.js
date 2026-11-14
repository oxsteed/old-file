'use strict';

// Notifications audit item 53: createScheduledSession set
// consultant_assigned_id with no sendNotification/email/socket call, so
// the assigned consultant was never told a session was scheduled.
// Reproduction: a fresh scheduled row creates no consultant notice; a
// retried (already-scheduled) click must not notify twice.

jest.mock('../services/modePlatformApprovalService', () => ({
  canPerformAction: jest.fn().mockResolvedValue({ allowed: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { mockQuery, resetMocks } = require('./setup');
const { sendNotification } = require('../services/notificationService');
const schedulingCtrl = require('../controllers/consultantSchedulingController');
const { tNotif } = require('../utils/i18n');

function res() {
  const r = { statusCode: 200 };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  return r;
}

const CONSULTANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ROW = { id: 1, user_id: OWNER_ID, consultant_assigned_id: CONSULTANT_ID };
const PLACEHOLDER_ROW = {
  id: 99, session_id: 1, scheduled_date: '1970-01-01', scheduled_time: '00:00:00',
  duration_minutes: 120, consultant_assigned_id: CONSULTANT_ID, meeting_link: null,
  timezone: 'America/New_York', status: 'pending_confirmation',
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('a fresh scheduled row notifies the assigned consultant (in-app + email leg)', async () => {
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
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: CONSULTANT_ID,
    type: 'consulting_session_scheduled',
    action_url: '/consulting/contractor-dashboard',
    idempotencyKey: 'consulting-session-scheduled:1',
  }));
  expect(sendNotification.mock.calls[0][0].data).toMatchObject({
    session_id: 1,
    scheduled_session_id: 99,
  });
});

test('a retried click returns the existing row and does not notify again', async () => {
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
  expect(r.body).toMatchObject({ alreadyScheduled: true });
  expect(sendNotification).not.toHaveBeenCalled();
});

test('no consultant assigned means no consultant notice', async () => {
  const unassigned = { id: 1, user_id: OWNER_ID, consultant_assigned_id: null };
  const row = { ...PLACEHOLDER_ROW, consultant_assigned_id: null };
  mockQuery
    .mockResolvedValueOnce({ rows: [unassigned] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [row] });
  const r = res();
  await schedulingCtrl.createScheduledSession(
    { user: { id: OWNER_ID, role: 'customer' }, body: { consultingSessionId: 1 } },
    r,
  );
  expect(r.statusCode).toBe(201);
  expect(sendNotification).not.toHaveBeenCalled();
});

test('the session-scheduled notice has copy in every language', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const text = tNotif('consulting_session_scheduled', lang, { sessionId: 1 });
    expect(text.title).toBeTruthy();
    expect(text.body).toBeTruthy();
  }
});
