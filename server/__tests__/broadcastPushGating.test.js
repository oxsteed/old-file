'use strict';

/**
 * Notifications audit item 13: broadcast in-app delivery ignores all user
 * preferences; broadcast push double-fires and mis-gates mobile.
 *  - in-app must honour a broadcast/in-app opt-out (global unsubscribe_all
 *    today; the per-type in_app_business_broadcast key when it exists).
 *  - push must dedupe Web Push vs native push (first-success-wins, like the
 *    main sendNotification path) instead of firing both in parallel.
 *  - broadcast push must gate on push_notifications only; web_push_enabled
 *    applies to the web leg alone, not to mobile.
 */

const core = require('../services/delivery/core');
const svc = require('../services/broadcastDeliveryService');

function fakeDb(ctx, calls) {
  return {
    query: jest.fn(async (sql, params) => {
      calls.push(String(sql));
      if (String(sql).includes('FROM business_broadcast_recipients')) {
        return { rows: [ctx] };
      }
      if (String(sql).includes('INSERT INTO notifications')) {
        return { rows: [{ id: 99 }] };
      }
      if (String(sql).includes('UPDATE business_broadcast_deliveries SET')) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

const baseCtx = {
  recipient_id: 1, user_id: 'user-1', email: 'user@example.invalid',
  tracking_token: 'a'.repeat(40), business_id: 9, broadcast_id: 5,
  subject: 'Sale', message: 'Hello', tracked_links: [], business_name: 'Cafe',
  preferred_language: 'en', unsubscribe_all: false,
  unsubscribed_from_bulk_emails: false, marketing_emails: true,
  email_notifications: true, push_notifications: true, web_push_enabled: true,
  suppressed: false, prefs_json: null,
};

function delivery(channel, id = 1) {
  return { id, recipient_id: 1, broadcast_id: 5, channel, attempts: 1, lease_token: 'lease-1' };
}

describe('item 13: broadcast in-app honours opt-outs', () => {
  test('unsubscribe_all skips the in-app leg instead of creating a row', async () => {
    const calls = [];
    const db = fakeDb({ ...baseCtx, unsubscribe_all: true }, calls);
    const result = await svc.deliverOne(db, delivery('in_app'), {});
    expect(result).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO notifications'))).toBe(false);
    const completeCall = db.query.mock.calls.find(([sql]) => sql.includes('UPDATE business_broadcast_deliveries SET'));
    expect(completeCall[1]).toContain('skipped');
    expect(completeCall[1]).toContain('broadcast_opted_out');
  });

  test('per-type in_app_business_broadcast=false skips the in-app leg', async () => {
    const calls = [];
    const db = fakeDb({ ...baseCtx, prefs_json: { in_app_business_broadcast: false } }, calls);
    await svc.deliverOne(db, delivery('in_app'), {});
    expect(calls.some((sql) => sql.includes('INSERT INTO notifications'))).toBe(false);
  });

  test('in-app still delivers when no opt-out is set', async () => {
    const calls = [];
    const db = fakeDb({ ...baseCtx }, calls);
    await svc.deliverOne(db, delivery('in_app'), {});
    expect(calls.some((sql) => sql.includes('INSERT INTO notifications'))).toBe(true);
  });
});

describe('item 13: broadcast push gating and dedupe', () => {
  test('web_push_enabled=false no longer kills mobile broadcast push', async () => {
    const calls = [];
    const db = fakeDb({ ...baseCtx, web_push_enabled: false }, calls);
    const webPush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    const mobilePush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    await svc.deliverOne(db, delivery('push'), { webPush, mobilePush });
    expect(webPush.sendToUser).not.toHaveBeenCalled();
    expect(mobilePush.sendToUser).toHaveBeenCalledTimes(1);
    const completeCall = db.query.mock.calls.find(([sql]) => sql.includes('UPDATE business_broadcast_deliveries SET'));
    expect(completeCall[1]).toContain('sent');
  });

  test('push_notifications=false skips push entirely', async () => {
    const calls = [];
    const db = fakeDb({ ...baseCtx, push_notifications: false }, calls);
    const webPush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    const mobilePush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    await svc.deliverOne(db, delivery('push'), { webPush, mobilePush });
    expect(webPush.sendToUser).not.toHaveBeenCalled();
    expect(mobilePush.sendToUser).not.toHaveBeenCalled();
  });

  test('core.sendPush is first-success-wins: a web ack skips the mobile leg', async () => {
    const webPush = { sendToUser: jest.fn(async () => ({ sent: 2, failed: 0 })) };
    const mobilePush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    const result = await core.sendPush('user-1', { title: 't', body: 'b' }, { webPush, mobilePush });
    expect(result.sent).toBe(2);
    expect(mobilePush.sendToUser).not.toHaveBeenCalled();
  });

  test('core.sendPush falls through to mobile when web reaches nobody', async () => {
    const webPush = { sendToUser: jest.fn(async () => ({ sent: 0, failed: 0 })) };
    const mobilePush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    const result = await core.sendPush('user-1', { title: 't', body: 'b' }, { webPush, mobilePush });
    expect(result.sent).toBe(1);
    expect(mobilePush.sendToUser).toHaveBeenCalledTimes(1);
  });

  test('core.sendPush skips the web leg when webPushEnabled is false', async () => {
    const webPush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    const mobilePush = { sendToUser: jest.fn(async () => ({ sent: 1, failed: 0 })) };
    const result = await core.sendPush('user-1', { title: 't', body: 'b' }, { webPush, mobilePush, webPushEnabled: false });
    expect(webPush.sendToUser).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);
  });
});
