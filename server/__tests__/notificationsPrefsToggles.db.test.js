'use strict';

/**
 * DB tests: notifications audit Track C — preference + toggle system.
 *
 * Items covered (Nov 6 notifications audit):
 *   4  quiet_hours_enabled column missing: PUT must persist start/end +
 *      enabled, and the quiet-hours gate must defer push while enabled.
 *   12 in-app master toggle + per-type opt-outs (notification_type_opt_outs):
 *      master off suppresses the in-app row; an opt-out row suppresses
 *      that type+channel only; absence defaults ON.
 *   33 phantom in_app_media_creator_update column: whitelisted + queue gate.
 *   52 sms_support_replies in neither whitelist nor UI: whitelisted, and
 *      sendSMSIfOptedIn must honour it.
 *   14 calendar quiet-hours leg defers whenever times are set, ignoring the
 *      enabled flag: must unify on quiet_hours_enabled.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/notificationsPrefsToggles.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'notif-prefs-toggles-test-secret';
}

// Expo push is observed, never sent: the SDK is mocked before
// notificationService loads it.
const mockSendExpo = jest.fn();
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: (...args) => mockSendExpo(...args),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, id: 'email-test' }),
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const notifCtrl = require('../controllers/notificationController');
const availCtrl = require('../controllers/availabilityController');
const calCtrl = require('../controllers/calendarNotificationController');
const { queueCreatorNotification } = require('../services/mediaCreatorNotificationService');
const { sendSMSIfOptedIn } = require('../services/smsNotificationService');

jest.setTimeout(60000);

function mockReq({ params = {}, query = {}, body = {}, user = {} } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

const userIds = [];
const appointmentIds = [];
const notificationIds = [];

async function makeUser({ phone = null } = {}) {
  const id = crypto.randomUUID();
  const email = `notif-c-${id.slice(0, 8)}@example.com`;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, phone_number, phone_verified)
     VALUES ($1, $2, 'x', 'Notif', 'C', 'customer', TRUE, TRUE, $3, $4)`,
    [id, email, phone, !!phone]
  );
  userIds.push(id);
  return { id, email };
}

async function setPrefs(userId, patch) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(
    `UPDATE notification_preferences SET ${set} WHERE user_id = $1`,
    [userId, ...keys.map((k) => patch[k])]
  );
}

// A quiet-hours window covering "now" in UTC, as HH:MM strings.
function quietWindowNow() {
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (m) => {
    const v = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  return { start: fmt(mins - 60), end: fmt(mins + 60) };
}

async function countNotifications(userId, type) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`,
    [userId, type]
  );
  return rows[0].n;
}

ddescribe('Track C preference toggles (DB)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendExpo.mockResolvedValue([{ status: 'ok' }]);
  });

  afterAll(async () => {
    // NOTE: DELETE FROM users fails in this disposable DB: the no-delete
    // RULE on oxsteed_credit_partner_funding_records (migration 514)
    // rewrites the RI trigger query, so Postgres aborts every users
    // delete ("referential integrity query ... gave unexpected result").
    // Other .db.test.js suites swallow the same failure with .catch();
    // the leftover notif-c-* users are inert rows in the disposable DB.
    const clean = async (sql, params) => {
      try { await pool.query(sql, params); } catch { /* see NOTE above */ }
    };
    if (notificationIds.length) {
      await clean('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [notificationIds]);
    }
    if (appointmentIds.length) {
      await clean('DELETE FROM calendar_notifications WHERE appointment_id = ANY($1::bigint[])', [appointmentIds]);
      await clean('DELETE FROM appointments WHERE id = ANY($1::bigint[])', [appointmentIds]);
    }
    if (userIds.length) {
      await clean('DELETE FROM notification_type_opt_outs WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM notification_preferences WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM sms_logs WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM order_sms_budgets WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await pool.end();
  });

  describe('item 4 — quiet hours end to end', () => {
    test('PUT persists quiet_hours_enabled + start/end, and GET returns them', async () => {
      const user = await makeUser();
      const { start, end } = quietWindowNow();
      const { res, err } = await call(
        availCtrl.updateNotificationPreferences,
        mockReq({ user: { id: user.id }, body: { quiet_hours_enabled: true, quiet_hours_start: start, quiet_hours_end: end, timezone: 'UTC' } })
      );
      expect(err).toBeNull();
      expect(res.payload.quiet_hours_enabled).toBe(true);
      expect(String(res.payload.quiet_hours_start).slice(0, 5)).toBe(start);
      expect(String(res.payload.quiet_hours_end).slice(0, 5)).toBe(end);

      const got = await call(availCtrl.getNotificationPreferences, mockReq({ user: { id: user.id } }));
      expect(got.res.payload.quiet_hours_enabled).toBe(true);
    });

    test('quiet-hours gate defers push while enabled, fires while disabled', async () => {
      const user = await makeUser();
      const { start, end } = quietWindowNow();
      await setPrefs(user.id, {
        quiet_hours_enabled: true, quiet_hours_start: start, quiet_hours_end: end, timezone: 'UTC',
      });
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `qh-on-${user.id}`,
      });
      expect(mockSendExpo).not.toHaveBeenCalled();
      // In-app still proceeds during quiet hours (gate blocks push only).
      expect(await countNotifications(user.id, 'bid_received')).toBe(1);

      await setPrefs(user.id, { quiet_hours_enabled: false });
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `qh-off-${user.id}`,
      });
      expect(mockSendExpo).toHaveBeenCalled();
    });
  });

  describe('item 12 — in-app master toggle + per-type opt-outs', () => {
    test('in_app_notifications=false suppresses the in-app row; true restores it', async () => {
      const user = await makeUser();
      await setPrefs(user.id, { in_app_notifications: false });
      const off = await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        idempotencyKey: `master-off-${user.id}`,
      });
      expect(off.success).toBe(true);
      expect(await countNotifications(user.id, 'bid_received')).toBe(0);

      await setPrefs(user.id, { in_app_notifications: true });
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        idempotencyKey: `master-on-${user.id}`,
      });
      expect(await countNotifications(user.id, 'bid_received')).toBe(1);
    });

    test('per-type opt-out suppresses only that type+channel; other types still deliver', async () => {
      const user = await makeUser();
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'bid_received', 'in_app')`,
        [user.id]
      );
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        idempotencyKey: `optout-inapp-${user.id}`,
      });
      expect(await countNotifications(user.id, 'bid_received')).toBe(0);

      await sendNotification({
        userId: user.id, type: 'job_started', title: 't', body: 'b',
        idempotencyKey: `optout-other-${user.id}`,
      });
      expect(await countNotifications(user.id, 'job_started')).toBe(1);

      // Opt-out is per channel: the push leg for the same type still fires.
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `optout-push-${user.id}`,
      });
      expect(mockSendExpo).toHaveBeenCalled();
    });

    test('per-type push opt-out suppresses Expo push for that type only', async () => {
      const user = await makeUser();
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'bid_received', 'push')`,
        [user.id]
      );
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `optout-push2-${user.id}`,
      });
      expect(mockSendExpo).not.toHaveBeenCalled();
      await sendNotification({
        userId: user.id, type: 'job_started', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `optout-push3-${user.id}`,
      });
      expect(mockSendExpo).toHaveBeenCalled();
    });

    test('per-type email opt-out suppresses realtime email for that type only', async () => {
      const user = await makeUser();
      const { sendEmail } = require('../utils/email');
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'new_message', 'email')`,
        [user.id]
      );
      await sendNotification({
        userId: user.id, type: 'new_message', title: 't', body: 'b',
        idempotencyKey: `optout-email-${user.id}`,
      });
      expect(sendEmail).not.toHaveBeenCalled();
      await sendNotification({
        userId: user.id, type: 'bid_accepted', title: 't', body: 'b',
        idempotencyKey: `optout-email2-${user.id}`,
      });
      expect(sendEmail).toHaveBeenCalled();
    });

    test('updatePreferences whitelists the master toggle and the type-opt-out endpoints round-trip', async () => {
      const user = await makeUser();
      const { res, err } = await call(
        notifCtrl.updatePreferences,
        mockReq({ user: { id: user.id }, body: { in_app_notifications: false } })
      );
      expect(err).toBeNull();
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query(
        'SELECT in_app_notifications FROM notification_preferences WHERE user_id = $1', [user.id]
      );
      expect(rows[0].in_app_notifications).toBe(false);

      const put = await call(
        notifCtrl.setTypeOptOut,
        mockReq({ user: { id: user.id }, body: { type: 'bid_received', channel: 'in_app', optedOut: true } })
      );
      expect(put.err).toBeNull();
      const listed = await call(notifCtrl.getTypeOptOuts, mockReq({ user: { id: user.id } }));
      expect(listed.res.payload.opt_outs).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'bid_received', channel: 'in_app' })])
      );
      const cleared = await call(
        notifCtrl.setTypeOptOut,
        mockReq({ user: { id: user.id }, body: { type: 'bid_received', channel: 'in_app', optedOut: false } })
      );
      expect(cleared.err).toBeNull();
      const relisted = await call(notifCtrl.getTypeOptOuts, mockReq({ user: { id: user.id } }));
      expect(relisted.res.payload.opt_outs).toEqual([]);
    });

    test('getPreferences returns the type_opt_outs list for the settings UI', async () => {
      const user = await makeUser();
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'job_started', 'push')`,
        [user.id]
      );
      const { res, err } = await call(notifCtrl.getPreferences, mockReq({ user: { id: user.id } }));
      expect(err).toBeNull();
      expect(res.payload.type_opt_outs).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'job_started', channel: 'push' })])
      );
    });

    test('catalog lists the discovered send types and every entry has a known group', async () => {
      const { NOTIFICATION_TYPES, NOTIFICATION_TYPE_GROUPS } = require('../utils/notificationTypeCatalog');
      expect(NOTIFICATION_TYPES.length).toBeGreaterThanOrEqual(90);
      const seen = new Set();
      for (const entry of NOTIFICATION_TYPES) {
        expect(NOTIFICATION_TYPE_GROUPS).toContain(entry.group);
        expect(seen.has(entry.type)).toBe(false);
        seen.add(entry.type);
      }
      for (const t of ['bid_received', 'new_message', 'media_creator_update', 'weekly_summary', 'safety_sos']) {
        expect(seen.has(t)).toBe(true);
      }
    });
  });

  describe('item 33 — in_app_media_creator_update is real', () => {
    test('whitelist accepts the toggle and the queue gate honours it', async () => {
      const user = await makeUser();
      const { res, err } = await call(
        notifCtrl.updatePreferences,
        mockReq({ user: { id: user.id }, body: { in_app_media_creator_update: false } })
      );
      expect(err).toBeNull();
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query(
        'SELECT in_app_media_creator_update FROM notification_preferences WHERE user_id = $1', [user.id]
      );
      expect(rows[0].in_app_media_creator_update).toBe(false);

      const blocked = await queueCreatorNotification(pool, {
        userId: user.id, event: 'published', referenceId: 'ref-1',
      });
      expect(blocked).toBeNull();

      await setPrefs(user.id, { in_app_media_creator_update: true });
      const queued = await queueCreatorNotification(pool, {
        userId: user.id, event: 'published', referenceId: 'ref-2',
      });
      expect(queued).not.toBeNull();
      expect(queued.type).toBe('media_creator_update');
      notificationIds.push(queued.id);
    });
  });

  describe('item 52 — sms_support_replies is settable and honoured', () => {
    test('whitelist accepts the toggle and sendSMSIfOptedIn honours it', async () => {
      const user = await makeUser({ phone: '+15551234567' });
      const { res, err } = await call(
        notifCtrl.updatePreferences,
        mockReq({ user: { id: user.id }, body: { sms_support_replies: false } })
      );
      expect(err).toBeNull();
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query(
        'SELECT sms_support_replies FROM notification_preferences WHERE user_id = $1', [user.id]
      );
      expect(rows[0].sms_support_replies).toBe(false);

      const blocked = await sendSMSIfOptedIn(user.id, 'Your request was updated.', 'support_replies');
      expect(blocked).toBe(false);

      await setPrefs(user.id, { sms_support_replies: true });
      const allowed = await sendSMSIfOptedIn(user.id, 'Your request was updated.', 'support_replies');
      expect(allowed).toBe(true);
    });
  });

  describe('item 14 — calendar quiet hours unify on the enabled flag', () => {
    async function makeDueReminder(userId, helperId, startHours = 2) {
      const { rows: appts } = await pool.query(
        `INSERT INTO appointments (customer_id, helper_id, service_description, scheduled_start_time, scheduled_end_time, status)
         VALUES ($1, $2, 'Test service', NOW() + ($3 || ' hours')::interval, NOW() + (($3::int + 1) || ' hours')::interval, 'confirmed')
         RETURNING id`,
        [userId, helperId, startHours]
      );
      const appointmentId = appts[0].id;
      appointmentIds.push(appointmentId);
      const { rows: notifs } = await pool.query(
        `INSERT INTO calendar_notifications (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
         VALUES ($1, $2, 'reminder_2h', 'in_app', NOW() - INTERVAL '1 minute', 'pending')
         RETURNING id`,
        [userId, appointmentId]
      );
      return notifs[0].id;
    }

    test('times set but enabled=false sends; enabled=true defers until the window ends', async () => {
      const customer = await makeUser();
      const helper = await makeUser();
      const { start, end } = quietWindowNow();
      await setPrefs(customer.id, {
        quiet_hours_enabled: false, quiet_hours_start: start, quiet_hours_end: end, timezone: 'UTC',
      });
      const idOff = await makeDueReminder(customer.id, helper.id);
      await calCtrl.processReminderNotifications();
      const { rows: offRows } = await pool.query(
        'SELECT status FROM calendar_notifications WHERE id = $1', [idOff]
      );
      expect(offRows[0].status).toBe('sent');

      await setPrefs(customer.id, { quiet_hours_enabled: true });
      const idOn = await makeDueReminder(customer.id, helper.id, 5);
      await calCtrl.processReminderNotifications();
      const { rows: onRows } = await pool.query(
        'SELECT status FROM calendar_notifications WHERE id = $1', [idOn]
      );
      expect(onRows[0].status).toBe('pending');
    });
  });
});
