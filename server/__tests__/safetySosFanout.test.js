'use strict';

/**
 * Notifications audit item 18: SOS fan-out is unbounded — every admin on
 * the first send (when no on-call admin exists) and every admin again on
 * every escalation sweep. Cap the first send to the on-call admins (one
 * fallback tier of the pool when nobody is on call), cap each escalation
 * to one tier, and rotate tiers so an admin is not re-notified while
 * un-notified admins remain.
 */

const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({
    success: true, notificationId: 'notif-1',
    delivered: { inApp: true, push: true, email: false, emailQueued: false },
  }),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true }),
}));

const { notifySOS } = require('../services/safetySOSService');
const { sendNotification } = require('../services/notificationService');

function admins(count, onCallCount) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: `admin-${String(i + 1).padStart(2, '0')}`, on_call: i < onCallCount, preferred_language: 'en' });
  }
  return rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

describe('item 18: bounded SOS fan-out', () => {
  test('first send goes only to on-call admins, capped', async () => {
    mockQuery.mockResolvedValue({ rows: admins(12, 3) });
    await notifySOS({ id: 1, user_id: 'customer' });
    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(sendNotification.mock.calls.map(([a]) => a.userId)).toEqual(['admin-01', 'admin-02', 'admin-03']);
    expect(mockQuery.mock.calls[0][0]).toMatch(/LIMIT/);
  });

  test('first send with nobody on call notifies one fallback tier, not everyone', async () => {
    mockQuery.mockResolvedValue({ rows: admins(12, 0) });
    await notifySOS({ id: 1, user_id: 'customer' });
    expect(sendNotification).toHaveBeenCalledTimes(5);
    expect(sendNotification.mock.calls.map(([a]) => a.userId)).toEqual(
      ['admin-01', 'admin-02', 'admin-03', 'admin-04', 'admin-05']);
  });

  test('escalation notifies the next tier, not everyone again', async () => {
    mockQuery.mockResolvedValue({ rows: admins(12, 3) });
    await notifySOS({ id: 1, user_id: 'customer', escalation_count: 1 }, { escalation: true });
    expect(sendNotification.mock.calls.map(([a]) => a.userId)).toEqual(
      ['admin-06', 'admin-07', 'admin-08', 'admin-09', 'admin-10']);
  });

  test('a later escalation moves to the next tier, then wraps only after the pool is exhausted', async () => {
    mockQuery.mockResolvedValue({ rows: admins(12, 3) });
    await notifySOS({ id: 1, user_id: 'customer', escalation_count: 2 }, { escalation: true });
    expect(sendNotification.mock.calls.map(([a]) => a.userId)).toEqual(['admin-11', 'admin-12']);
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: admins(12, 3) });
    await notifySOS({ id: 1, user_id: 'customer', escalation_count: 3 }, { escalation: true });
    expect(sendNotification.mock.calls.map(([a]) => a.userId)).toEqual(
      ['admin-01', 'admin-02', 'admin-03', 'admin-04', 'admin-05']);
  });

  test('the admin query itself is bounded', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await notifySOS({ id: 1, user_id: 'customer' });
    expect(mockQuery.mock.calls[0][0]).toMatch(/LIMIT \$\d+/);
  });
});
