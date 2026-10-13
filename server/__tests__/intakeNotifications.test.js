'use strict';

/**
 * intakeNotifications.test.js
 *
 * Review P2-9-F04: every submitted intake must notify the business owner so
 * intakes are observable. The helper never throws: notification failure must
 * not fail intake creation.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { notifyIntakeReceived } = require('../utils/intakeNotifications');

const OWNER_ID = '00000000-0000-4000-8000-000000000111';

beforeEach(() => {
  jest.clearAllMocks();
  sendNotification.mockResolvedValue({ success: true, notificationId: 'n1' });
});

test('notifies the business owner with the intake type and ops-tab deep link', async () => {
  db.query.mockResolvedValue({ rows: [{ user_id: OWNER_ID, business_name: 'Glow Studio' }] });

  const result = await notifyIntakeReceived({ businessId: 42, intakeId: 7, area: 'beauty' });

  expect(result.success).toBe(true);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    userId: OWNER_ID,
    type: 'intake_request_received',
    action_url: '/business/42/workspace/beauty-ops',
    idempotencyKey: 'intake-received:beauty:7',
  }));
  expect(sendNotification.mock.calls[0][0].data).toMatchObject({
    business_id: '42',
    intake_id: '7',
    area: 'beauty',
  });
});

test('maintenance intakes deep-link to the maintenance tab', async () => {
  db.query.mockResolvedValue({ rows: [{ user_id: OWNER_ID, business_name: 'Sunset Apts' }] });

  await notifyIntakeReceived({ businessId: 9, intakeId: 3, area: 'maintenance' });

  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
    action_url: '/business/9/workspace/maintenance',
  }));
});

test('no owner: returns no_owner without notifying', async () => {
  db.query.mockResolvedValue({ rows: [{ user_id: null, business_name: 'Ghost Biz' }] });

  const result = await notifyIntakeReceived({ businessId: 42, intakeId: 7, area: 'trades' });

  expect(result.success).toBe(false);
  expect(result.reason).toBe('no_owner');
  expect(sendNotification).not.toHaveBeenCalled();
});

test('notification failure never throws (intake creation must not fail)', async () => {
  db.query.mockRejectedValue(new Error('db down'));

  const result = await notifyIntakeReceived({ businessId: 42, intakeId: 7, area: 'creative' });

  expect(result.success).toBe(false);
  await expect(
    notifyIntakeReceived({ businessId: 42, intakeId: 7, area: 'creative' })
  ).resolves.toBeDefined();
});

test('sendNotification failure is swallowed, not thrown', async () => {
  db.query.mockResolvedValue({ rows: [{ user_id: OWNER_ID, business_name: 'Glow Studio' }] });
  sendNotification.mockRejectedValue(new Error('push exploded'));

  const result = await notifyIntakeReceived({ businessId: 42, intakeId: 7, area: 'continuity' });

  expect(result.success).toBe(false);
});
