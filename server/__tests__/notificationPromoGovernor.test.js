'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/webPushService', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  sendToUser: jest.fn(),
}));
jest.mock('../services/mobilePushService', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  sendToUser: jest.fn(),
}));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');

const prefs = {
  email: null,
  first_name: 'Promo',
  is_banned: false,
  preferred_language: 'en',
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

test('promotional push is capped at 2 per rolling 7 days', async () => {
  // Governor query reports 2 promos already sent this week.
  db.query.mockResolvedValueOnce({ rows: [{ n: 2 }] });

  const result = await sendNotification({
    userId: 'user-1',
    type: 'promo_deal',
    title: 'Deal',
    body: 'A deal.',
    promotional: true,
  });

  expect(result).toMatchObject({ success: false, reason: 'promo_cap' });
  // Only the governor query ran; no notification row was inserted.
  expect(db.query).toHaveBeenCalledTimes(1);
});

test('promotional push under the cap proceeds', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ n: 1 }] })   // governor: 1 promo this week
    .mockResolvedValueOnce({ rows: [prefs] })       // prefs
    .mockResolvedValueOnce({ rows: [{ id: 'n-1' }] }); // insert

  const result = await sendNotification({
    userId: 'user-1',
    type: 'promo_deal',
    title: 'Deal',
    body: 'A deal.',
    promotional: true,
  });

  expect(result.success).toBe(true);
  // The insert carried is_promotional = true.
  const insertCall = db.query.mock.calls.find((c) => c[0].includes('INSERT INTO notifications'));
  expect(insertCall).toBeDefined();
  expect(insertCall[1][7]).toBe(true);
});

test('transactional notifications skip the governor', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [prefs] })
    .mockResolvedValueOnce({ rows: [{ id: 'n-2' }] });

  const result = await sendNotification({
    userId: 'user-1',
    type: 'food_order_accepted',
    title: 'Order confirmed',
    body: 'Confirmed.',
  });

  expect(result.success).toBe(true);
  const insertCall = db.query.mock.calls.find((c) => c[0].includes('INSERT INTO notifications'));
  expect(insertCall[1][7]).toBe(false);
});
