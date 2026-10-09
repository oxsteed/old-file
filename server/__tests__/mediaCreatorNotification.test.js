"use strict";
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
const { mockQuery, resetMocks } = require('./setup');
const { queueCreatorNotification, deliverCreatorNotification } = require('../services/mediaCreatorNotificationService');
const { sendNotification } = require('../services/notificationService');
const { tNotif } = require('../utils/i18n');
const { broadcastToUser } = require('../services/socketService');
beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

test.each(['en','es','fr','ht','ar'])('persists creator updates in %s with a stable delivery key', async language => {
  mockQuery.mockResolvedValueOnce({ rows: [{ preferred_language: language }] }).mockResolvedValueOnce({ rows: [{ id: 'n-1', title: tNotif('media_creator_update',language).title, data: { event: 'award' } }] });
  const notification = await queueCreatorNotification({ query: mockQuery }, { userId: 'creator', event: 'award', referenceId: 'app-1' });
  expect(notification.idempotencyKey).toBe('media_creator:award:app-1:creator:');
  const values = mockQuery.mock.calls[1][1];
  expect(values[1]).toBe(tNotif('media_creator_update',language).title);
  expect(values[2]).toBe(tNotif('media_creator_update',language).body);
  expect(mockQuery.mock.calls[1][0]).toContain('ON CONFLICT (delivery_key)');
});

test('honors the shared in-app creator-update preference', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ preferred_language: 'en', in_app_media_creator_update: false }] });
  expect(await queueCreatorNotification({ query: mockQuery }, { userId: 'creator', event: 'award', referenceId: 'app-1' })).toBeNull();
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('delivers committed events through existing realtime and notification services', async () => {
  await deliverCreatorNotification({ id: 'n-1', userId: 'creator', idempotencyKey: 'key', title: 'Creator work update', data: { event: 'award' } });
  expect(broadcastToUser).toHaveBeenCalledWith('creator','notification:new',expect.objectContaining({ id: 'n-1' }));
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'creator', type: 'media_creator_update', action_url: '/media/creator', idempotencyKey: 'key' }));
});
