'use strict';

/**
 * Notifications audit item 26: 51 of 153 sendNotification call sites pass
 * no idempotency key, so any retry duplicates in-app, push, and email. The
 * fix is at the boundary: sendNotification auto-derives a deterministic
 * key from type + recipient + entity id / payload hash when the caller
 * passes none. It must NEVER dedupe genuinely distinct events: different
 * entity ids and different payloads for the same entity must get different
 * keys, while an identical retry gets the same key.
 */

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
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok' }]),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(false);
  return { Expo };
});
jest.mock('../utils/emailTemplate', () => ({
  renderOxSteedEmail: jest.fn(() => ({ html: '<p>synthetic</p>', text: 'synthetic' })),
}));

const db = require('../db');
const { sendNotification, deriveIdempotencyKey } = require('../services/notificationService');

const prefs = {
  email: 'customer@example.invalid',
  first_name: 'Casey',
  is_banned: false,
  preferred_language: 'en',
  push_notifications: true,
  web_push_enabled: false,
  quiet_hours_enabled: false,
};

// Fake DB: prefs lookup always succeeds; the notifications INSERT honours
// ON CONFLICT (delivery_key) — a repeated key inserts nothing and the
// follow-up lookup returns the first row, exactly like production.
function installDbFake() {
  const insertedByKey = new Map();
  const insertKeys = [];
  db.query.mockImplementation(async (sql, params) => {
    if (typeof sql === 'string' && sql.includes('FROM users')) {
      return { rows: [{ ...prefs }] };
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO notifications')) {
      const key = params && params[6];
      insertKeys.push(key);
      if (key && insertedByKey.has(key)) return { rows: [] };
      const row = { id: `notif-${insertedByKey.size + 1}`, is_push_sent: false, is_email_sent: false };
      if (key) insertedByKey.set(key, row);
      return { rows: [row] };
    }
    if (typeof sql === 'string' && sql.includes('WHERE delivery_key = $1')) {
      const row = insertedByKey.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    return { rows: [], rowCount: 0 };
  });
  return { insertedByKey, insertKeys };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

describe('item 26: boundary idempotency derivation', () => {
  test('an identical keyless retry reuses the derived key and the same row', async () => {
    const { insertKeys } = installDbFake();
    const args = {
      userId: 'customer-1', type: 'booking_accepted', title: 'Booking accepted',
      body: 'Your booking was accepted.', data: { bookingId: 'b-1' }, action_url: '/bookings/b-1',
    };
    const first = await sendNotification(args);
    const second = await sendNotification(args);
    expect(first.notificationId).toBe(second.notificationId);
    expect(insertKeys).toHaveLength(2);
    expect(insertKeys[0]).toBeTruthy();
    expect(insertKeys[1]).toBe(insertKeys[0]);
  });

  test('distinct entity ids for the same type get distinct keys', async () => {
    const { insertKeys } = installDbFake();
    await sendNotification({ userId: 'customer-1', type: 'booking_accepted', title: 't', body: 'b', data: { bookingId: 'b-1' } });
    await sendNotification({ userId: 'customer-1', type: 'booking_accepted', title: 't', body: 'b', data: { bookingId: 'b-2' } });
    expect(insertKeys[0]).not.toBe(insertKeys[1]);
  });

  test('different payloads for the same entity get distinct keys', async () => {
    const { insertKeys } = installDbFake();
    await sendNotification({ userId: 'customer-1', type: 'booking_accepted', title: 't', body: 'first', data: { bookingId: 'b-1' } });
    await sendNotification({ userId: 'customer-1', type: 'booking_accepted', title: 't', body: 'second', data: { bookingId: 'b-1' } });
    expect(insertKeys[0]).not.toBe(insertKeys[1]);
  });

  test('deriveIdempotencyKey is deterministic and entity-scoped', () => {
    const now = Date.now();
    const a = deriveIdempotencyKey({ type: 'booking_accepted', userId: 'u1', data: { bookingId: 'b-1' }, title: 't', body: 'b', now });
    const b = deriveIdempotencyKey({ type: 'booking_accepted', userId: 'u1', data: { bookingId: 'b-1' }, title: 't', body: 'b', now });
    const otherEntity = deriveIdempotencyKey({ type: 'booking_accepted', userId: 'u1', data: { bookingId: 'b-2' }, title: 't', body: 'b', now });
    const otherUser = deriveIdempotencyKey({ type: 'booking_accepted', userId: 'u2', data: { bookingId: 'b-1' }, title: 't', body: 'b', now });
    expect(a).toBe(b);
    expect(a).not.toBe(otherEntity);
    expect(a).not.toBe(otherUser);
    expect(a.length).toBeLessThanOrEqual(255);
  });

  test('payload-only derivation (no entity id) dedupes within a bucket, not across buckets', () => {
    // Pinned mid-bucket: 12:07 UTC sits inside the 12:00-12:15 bucket,
    // so +60s stays in it and +60min leaves it. A live Date.now() flaked
    // when the run landed in the last minute of a bucket (CI run
    // 43732204512: now 15:59:11 UTC, now+60s crossed into the next bucket).
    const now = Date.UTC(2026, 10, 15, 12, 7, 0);
    const a = deriveIdempotencyKey({ type: 'reminder', userId: 'u1', data: { note: 'same' }, title: 't', body: 'b', now });
    const sameBucket = deriveIdempotencyKey({ type: 'reminder', userId: 'u1', data: { note: 'same' }, title: 't', body: 'b', now: now + 60 * 1000 });
    const laterBucket = deriveIdempotencyKey({ type: 'reminder', userId: 'u1', data: { note: 'same' }, title: 't', body: 'b', now: now + 60 * 60 * 1000 });
    expect(a).toBe(sameBucket);
    expect(a).not.toBe(laterBucket);
  });

  test('item 26: entity-scoped derivation dedupes within a bucket, not across buckets', () => {
    // The entity path used to carry no time component, so two distinct
    // events for one entity with identical payloads collapsed forever.
    // Same pinned mid-bucket shape as the payload-only test above.
    const now = Date.UTC(2026, 10, 15, 12, 7, 0);
    const args = { type: 'booking_accepted', userId: 'u1', data: { bookingId: 'b-1' }, title: 't', body: 'b' };
    const a = deriveIdempotencyKey({ ...args, now });
    const sameBucket = deriveIdempotencyKey({ ...args, now: now + 60 * 1000 });
    const laterBucket = deriveIdempotencyKey({ ...args, now: now + 60 * 60 * 1000 });
    expect(a).toBe(sameBucket);
    expect(a).not.toBe(laterBucket);
  });

  test('N5: a long entity value no longer truncates the payload hash off', () => {
    // Repro: with a 300-char entity value the old layout
    // `...:<field>:<value>:<hash>` sliced the hash off past 255 chars,
    // so two events for the same entity with different payloads
    // collapsed to one key and the second was silently deduped away.
    const now = Date.now();
    const longEntity = 'b-'.repeat(150);
    const first = deriveIdempotencyKey({ type: 'booking_accepted', userId: 'u1', data: { bookingId: longEntity }, title: 't', body: 'first', now });
    const second = deriveIdempotencyKey({ type: 'booking_accepted', userId: 'u1', data: { bookingId: longEntity }, title: 't', body: 'second', now });
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(255);
    expect(second.length).toBeLessThanOrEqual(255);
    // The hash sits before the entity value, so it survives truncation:
    // the two keys differ in the hash segment, not only past char 255.
    expect(first.slice(0, 60)).not.toBe(second.slice(0, 60));
  });

  test('N5: a caller-supplied sequence distinguishes identical no-entity events in one bucket', () => {
    const now = Date.now();
    const args = { type: 'reminder', userId: 'u1', data: { note: 'same' }, title: 't', body: 'b', now };
    const noSequence = deriveIdempotencyKey(args);
    const seq1 = deriveIdempotencyKey({ ...args, sequence: 'evt-1' });
    const seq1Again = deriveIdempotencyKey({ ...args, sequence: 'evt-1' });
    const seq2 = deriveIdempotencyKey({ ...args, sequence: 'evt-2' });
    // Same sequence replays to the same key (a retry still dedupes);
    // a different sequence is a different event even with identical
    // content in the same 15-minute bucket.
    expect(seq1).toBe(seq1Again);
    expect(seq1).not.toBe(seq2);
    expect(seq1).not.toBe(noSequence);
    expect(seq2).not.toBe(noSequence);
  });

  test('N5: two identical keyless sends with different sequences both deliver', async () => {
    const { insertKeys, insertedByKey } = installDbFake();
    const args = {
      userId: 'customer-1', type: 'reminder', title: 't',
      body: 'b', data: { note: 'same' },
    };
    const first = await sendNotification({ ...args, sequence: 'evt-1' });
    const second = await sendNotification({ ...args, sequence: 'evt-2' });
    const replay = await sendNotification({ ...args, sequence: 'evt-1' });
    expect(insertKeys[0]).not.toBe(insertKeys[1]);
    expect(insertKeys[2]).toBe(insertKeys[0]);
    expect(first.notificationId).not.toBe(second.notificationId);
    expect(replay.notificationId).toBe(first.notificationId);
    expect(insertedByKey.size).toBe(2);
  });
});
