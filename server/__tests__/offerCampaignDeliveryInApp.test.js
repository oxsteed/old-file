'use strict';

// Notifications audit item 11 (offer leg): deliver() used to insert
// the in-app row directly via core.sendInApp, bypassing the master
// in-app toggle and the per-type opt-outs. It now routes through the
// shared sendNotification path (in-app only, same delivery key).
// Reproduction: a user with in-app off gets the row anyway (marked
// sent); after the fix the delivery skips with in_app_opted_out.

jest.mock('../growth/gate', () => ({
  allow: jest.fn().mockResolvedValue({ allowed: true, context: { user: { country: 'US' } } }),
}));
jest.mock('../growth/access', () => ({
  scope: jest.fn().mockResolvedValue({ global: true }),
  predicate: jest.fn().mockReturnValue('TRUE'),
}));
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

const { mockQuery, resetMocks } = require('./setup');
const { deliver } = require('../jobs/offerCampaignDelivery');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CTX = {
  user_id: USER_ID,
  campaign_status: 'sending',
  approved_by: 'admin-1',
  copy: { en: { title: 'Offer!', body: 'Save now' } },
  channels: ['in_app'],
  is_personalized: true,
  type: 'offer',
  offer_status: 'active',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  partner_id: null,
  countries: ['US'],
  allowed_channels: ['in_app'],
  offer_push: true,
  offer_in_app: true,
  timezone: 'America/New_York',
  preferred_language: 'en',
  created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
  push_notifications: true,
  web_push_enabled: true,
};
const DELIVERY = { id: 11, recipient_id: 21, campaign_id: 31, channel: 'in_app', attempts: 0, lease_token: 'lease-1' };

let insertFails = false;

function fakeConn() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('FROM offer_campaign_recipients')) return { rows: [{ ...CTX }] };
      if (text.includes('FROM marketing_suppressions')) return { rows: [] };
      if (text.includes('FROM marketing_contact_log')) return { rows: [{ weekly: 0, monthly: 0, seen: 0 }] };
      if (text.includes('FROM platform_settings')) return { rows: [] };
      if (text.includes('UPDATE offer_campaign_deliveries')) return { rowCount: 1 };
      if (text.includes('INSERT INTO marketing_contact_log')) return { rowCount: 1 };
      return { rows: [] };
    },
  };
}

function finishCalls(conn) {
  return conn.calls.filter((c) => c.text.includes('UPDATE offer_campaign_deliveries'));
}

function prefsRow(over = {}) {
  return {
    email: 'user@example.invalid',
    first_name: 'User',
    is_banned: false,
    preferred_language: 'en',
    in_app_notifications: true,
    push_notifications: true,
    web_push_enabled: false,
    quiet_hours_enabled: false,
    ...over,
  };
}

const OLD_FLAG = process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED;
const OLD_PEPPER = process.env.GROWTH_SUBJECT_PEPPER;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  insertFails = false;
  process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED = 'true';
  process.env.GROWTH_SUBJECT_PEPPER = 'test-pepper-0000000000000000000000';
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM users u')) return { rows: [prefsRow()] };
    if (text.includes('INSERT INTO notifications')) {
      if (insertFails) throw new Error('boom');
      return { rows: [{ id: 42, is_push_sent: false, is_email_sent: false }] };
    }
    return { rows: [], rowCount: 0 };
  });
});

afterAll(() => {
  if (OLD_FLAG === undefined) delete process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED;
  else process.env.GROWTH_CAMPAIGN_DELIVERY_ENABLED = OLD_FLAG;
  if (OLD_PEPPER === undefined) delete process.env.GROWTH_SUBJECT_PEPPER;
  else process.env.GROWTH_SUBJECT_PEPPER = OLD_PEPPER;
});

test('in-app offer routes through sendNotification and marks sent with its id', async () => {
  const conn = fakeConn();
  await deliver(conn, { ...DELIVERY });
  const insert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO notifications'));
  expect(insert).toBeTruthy();
  expect(insert[1]).toEqual([USER_ID, 'growth_offer', 'Offer!', 'Save now',
    expect.stringContaining('"delivery_id":"11"'), '/offers/11', 'growth-offer:11', false]);
  const finish = finishCalls(conn);
  expect(finish).toHaveLength(1);
  expect(finish[0].params).toEqual([11, 'lease-1', 'sent', null, 42, 0]);
});

test('master in-app off skips with in_app_opted_out and never marks sent', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM users u')) return { rows: [prefsRow({ in_app_notifications: false })] };
    if (text.includes('INSERT INTO notifications')) {
      return { rows: [{ id: 42, is_push_sent: false, is_email_sent: false }] };
    }
    return { rows: [], rowCount: 0 };
  });
  const conn = fakeConn();
  await deliver(conn, { ...DELIVERY });
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notifications'))).toBe(false);
  const finish = finishCalls(conn);
  expect(finish).toHaveLength(1);
  expect(finish[0].params).toEqual([11, 'lease-1', 'skipped', 'in_app_opted_out', null, 0]);
});

test('a failed central send throws so the caller retries instead of marking sent', async () => {
  insertFails = true;
  const conn = fakeConn();
  await expect(deliver(conn, { ...DELIVERY })).rejects.toThrow('boom');
  expect(finishCalls(conn)).toHaveLength(0);
});
