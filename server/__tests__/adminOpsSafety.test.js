'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn().mockResolvedValue({ persisted: true }) }));
const { notifySOS, escalateUnacknowledgedSOS } = require('../services/safetySOSService');
const { sendNotification } = require('../services/notificationService');
const { recordIncident } = require('../services/incidentStore');
beforeEach(() => { resetMocks(); jest.clearAllMocks(); });
test('SOS targets on-call staff first and escalates to the active fallback pool', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'oncall', on_call: true }, { id: 'super', on_call: false }] });
  const event = { id: 1, user_id: 'customer' };
  await notifySOS(event);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification.mock.calls[0][0].userId).toBe('oncall');
  expect(mockQuery.mock.calls[0][0]).toContain('u.is_active=TRUE');
  expect(mockQuery.mock.calls[0][0]).toContain("'super_admin'");
  sendNotification.mockClear(); await notifySOS(event, { escalation: true });
  expect(sendNotification).toHaveBeenCalledTimes(2);
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'safety-sos:1' }));
});
test('no available operator raises a durable critical incident', async () => {
  mockQuery.mockResolvedValue({ rows: [] }); await notifySOS({ id: 2, user_id: 'customer' });
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'safety-sos:2', severity: 'critical' }));
});
test('escalation excludes acknowledged events and atomically claims a bounded batch', async () => {
  mockQuery.mockResolvedValue({ rows: [] }); await escalateUnacknowledgedSOS({ limit: 1000 });
  expect(mockQuery.mock.calls[0][0]).toContain('acknowledged_at IS NULL');
  expect(mockQuery.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED LIMIT $1');
  expect(mockQuery.mock.calls[0][1]).toEqual([100]);
});
