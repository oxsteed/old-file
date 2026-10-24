'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/restaurantGiftCardFulfillment', () => ({ enabled: () => true }));
const email = require('../utils/email');
email.emailDeliveryAvailable = () => true;
const { processGiftCardDelivery, statusPollMinutes } = require('../services/restaurantGiftCardDelivery');
const alerts = require('../services/incidentAlertService');
const { dispatchPendingIncidentNotifications } = require('../jobs/incidentNotificationDispatch');
const savedChannels = alerts.alertChannels;
afterAll(() => { alerts.alertChannels = savedChannels; clearInterval(alerts.monitorTimer); });
beforeEach(() => resetMocks());
test('accepted email is polled beyond the send-idempotency window with backoff, without resending', async () => {
  const db = { query: jest.fn().mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 1, status: 'accepted', provider_id: 'fixture', status_poll_count: 4, first_attempt_at: new Date(Date.now()-26*3600000) }] })
    .mockResolvedValueOnce({ rowCount: 1 }) };
  const inspect = jest.fn().mockResolvedValue({ success: true, event: 'sent' }), send = jest.fn();
  await processGiftCardDelivery({ db, send, inspect });
  expect(inspect).toHaveBeenCalledWith('fixture');
  expect(send).not.toHaveBeenCalled();
  expect(db.query.mock.calls[2][1][6]).toBe(240);
  expect([0,1,2,3,4,10].map(statusPollMinutes)).toEqual([15,30,60,120,240,240]);
});
test('the sweeper dispatches an incident left claimed by a non-dispatching caller', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, type: 'audit_failure', severity: 'critical' }] })
    .mockResolvedValueOnce({ rows: [{ id: 9 }] }).mockResolvedValueOnce({ rowCount: 1 });
  const channel = jest.fn().mockResolvedValue(true); alerts.alertChannels = [channel];
  expect((await dispatchPendingIncidentNotifications()).dispatched).toBe(1);
  expect(channel).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  expect(mockQuery.mock.calls[2][1][2]).toBe(true);
});
test('failed external delivery does not increment the notification count', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 9 }] }).mockResolvedValueOnce({ rowCount: 1 });
  alerts.alertChannels = [jest.fn().mockResolvedValue(undefined), jest.fn().mockRejectedValue(new Error('provider down'))];
  expect((await alerts.dispatchRecordedIncident({ id: 9, type: 'audit_failure', severity: 'critical' })).dispatched).toBe(false);
  expect(mockQuery.mock.calls[1][1][2]).toBe(false);
});
test('a durable lease held by another dispatcher suppresses duplicate notifications', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const channel = jest.fn().mockResolvedValue(true); alerts.alertChannels = [channel];
  expect((await alerts.dispatchRecordedIncident({ id: 9, type: 'audit_failure', severity: 'critical' })).suppressed).toBe(true);
  expect(channel).not.toHaveBeenCalled();
});
