'use strict';

// Notifications audit N8: businessMembersController.insertNotification
// re-implemented the preference gate with only the canonical per-type
// column, so the in-app master toggle and the per-type opt-out rows
// were ignored and a user who turned in-app off still got team
// notifications. It now calls the shared prefAllows.
// Reproduction: a prefs row with in_app_notifications=false (or a
// notification_type_opt_outs row for the type) still inserts a row.

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
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});

const { insertNotification } = require('../controllers/businessMembersController');

const TYPE = 'business_member_invited';

function fakeClient({ prefsRow = null, optOuts = [], prefsThrow = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (text.startsWith('SAVEPOINT') || text.startsWith('RELEASE SAVEPOINT') || text.startsWith('ROLLBACK TO SAVEPOINT')) {
        return { rows: [] };
      }
      if (text.includes('SELECT np.* FROM notification_preferences')) {
        if (prefsThrow) throw new Error('prefs down');
        return { rows: prefsRow ? [prefsRow] : [] };
      }
      if (text.includes('FROM notification_type_opt_outs')) return { rows: optOuts };
      if (text.includes('INSERT INTO notifications')) return { rows: [{ id: 5 }] };
      if (text.includes('SELECT id FROM notifications WHERE delivery_key')) return { rows: [{ id: 5 }] };
      return { rows: [] };
    },
  };
}

const notified = (client) => client.calls.some((sql) => sql.includes('INSERT INTO notifications'));

test('master in-app toggle off means no team notification', async () => {
  const client = fakeClient({ prefsRow: { in_app_notifications: false } });
  const id = await insertNotification(client, {
    userId: 'user-1', type: TYPE, title: 'Invited', body: 'You were invited', data: {},
  });
  expect(id).toBeNull();
  expect(notified(client)).toBe(false);
});

test('a per-type in-app opt-out means no team notification', async () => {
  const client = fakeClient({
    prefsRow: { in_app_notifications: true },
    optOuts: [{ type: TYPE, channel: 'in_app' }],
  });
  const id = await insertNotification(client, {
    userId: 'user-1', type: TYPE, title: 'Invited', body: 'You were invited', data: {},
  });
  expect(id).toBeNull();
  expect(notified(client)).toBe(false);
});

test('canonical per-type column off still blocks (previous behaviour kept)', async () => {
  const client = fakeClient({ prefsRow: { in_app_business_member_invited: false } });
  const id = await insertNotification(client, {
    userId: 'user-1', type: TYPE, title: 'Invited', body: 'You were invited', data: {},
  });
  expect(id).toBeNull();
  expect(notified(client)).toBe(false);
});

test('no prefs row and no opt-outs still notifies', async () => {
  const client = fakeClient();
  const id = await insertNotification(client, {
    userId: 'user-1', type: TYPE, title: 'Invited', body: 'You were invited', data: {},
  });
  expect(id).toBe(5);
  expect(notified(client)).toBe(true);
});

test('a prefs lookup failure falls through to insert (membership change never fails on prefs)', async () => {
  const client = fakeClient({ prefsThrow: true });
  const id = await insertNotification(client, {
    userId: 'user-1', type: TYPE, title: 'Invited', body: 'You were invited', data: {},
  });
  expect(id).toBe(5);
  expect(notified(client)).toBe(true);
});
