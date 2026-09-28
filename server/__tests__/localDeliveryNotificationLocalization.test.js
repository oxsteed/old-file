'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
jest.mock('../services/webPushService', () => ({ isConfigured: () => false }));
jest.mock('../services/mobilePushService', () => ({ isConfigured: () => false }));
jest.mock('expo-server-sdk', () => ({ Expo: jest.fn() }));

const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const { tNotif } = require('../utils/i18n');

test.each(['en', 'es', 'fr', 'ht', 'ar'])('notification service stores and broadcasts %s copy without an English appendix', async (language) => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.query.mockResolvedValueOnce({ rows: [{ preferred_language: language, email: null }] })
    .mockResolvedValueOnce({ rows: [{ id: 'notification-1' }] });
  const type = 'delivery:delivery_approaching';
  const expected = tNotif(type, language);
  await expect(sendNotification({
    userId: 'recipient', type, body: '(DEL-81)',
    action_url: '/delivery/jobs/81', idempotencyKey: 'delivery-event:901:recipient',
  })).resolves.toMatchObject({ success: true });
  expect(db.query.mock.calls[1][1]).toEqual([
    'recipient', type, expected.title, expected.body + ' (DEL-81)', '{}',
    '/delivery/jobs/81', 'delivery-event:901:recipient',
  ]);
  expect(broadcastToUser).toHaveBeenCalledWith('recipient', 'notification:new', expect.objectContaining({
    title: expected.title, body: expected.body + ' (DEL-81)',
  }));
});
