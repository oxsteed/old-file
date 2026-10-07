'use strict';

/**
 * P1 SMS privacy + consent tests (items 9 and 10).
 *
 * (a) sendDirectSMS refuses numbers on the STOP opt-out list.
 * (b) sendDirectSMS enforces a per-phone rate limit (5 per 15 minutes).
 * (c) sendDirectSMS with requireVerified:true refuses unverified recipients.
 * (d) sms_logs stores SHA-256 hash + redacted preview, never the full body,
 *     and the logs list API returns preview/hash, not the body.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const smsNotificationService = require('../services/smsNotificationService');
const smsNotificationController = require('../controllers/smsNotificationController');

beforeEach(() => resetMocks());

const PHONE = '+15551234567';
const BODY = 'Your order #7 at Ox Burger Lab is ready for pickup. Track: https://oxsteed.example/food/track/abc123';

const EXPECTED_HASH = crypto.createHash('sha256').update(BODY, 'utf8').digest('hex');
const EXPECTED_PREVIEW = BODY.replace(/\s+/g, ' ').trim().slice(0, 20) + '...';

function mockHappyPathSends() {
  // 1) sms_opt_outs lookup -> not opted out
  mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  // 2) rate-limit count -> 0 sends in the window
  mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });
  // 3) INSERT INTO sms_logs (default empty from resetMocks covers the rest)
}

describe('sendDirectSMS consent governor (item 10)', () => {
  test('(a) refuses a number on the STOP opt-out list and never sends', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }], rowCount: 1 });

    const result = await smsNotificationService.sendDirectSMS(PHONE, BODY);

    expect(result).toBeNull();
    // Only the opt-out lookup ran; no rate-limit check, no INSERT, no send.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('sms_opt_outs');
  });

  test('(b) refuses when the per-phone rate limit is exceeded', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // not opted out
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 }); // 5 already sent

    const result = await smsNotificationService.sendDirectSMS(PHONE, BODY);

    expect(result).toBeNull();
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO sms_logs'));
    expect(inserts).toHaveLength(0);
  });

  test('(c) refuses an unverified recipient when verification is required', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // not opted out
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no verified user owns the number

    const result = await smsNotificationService.sendDirectSMS(PHONE, BODY, { requireVerified: true });

    expect(result).toBeNull();
    const inserts = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO sms_logs'));
    expect(inserts).toHaveLength(0);
  });

  test('(c) allows a verified recipient when verification is required', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // not opted out
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }], rowCount: 1 }); // verified user owns number
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 }); // under rate limit

    const result = await smsNotificationService.sendDirectSMS(PHONE, BODY, { requireVerified: true });

    // Twilio creds are unset in tests, so the mock transport is used.
    expect(result).toEqual({ sid: 'mock_sid', status: 'queued' });
  });

  test('(d) the send is logged with hash + preview, never the full body', async () => {
    mockHappyPathSends();

    await smsNotificationService.sendDirectSMS(PHONE, BODY);

    const insertCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO sms_logs'));
    expect(insertCalls).toHaveLength(1);
    const [sql, params] = insertCalls[0];
    expect(sql).toContain('message_hash');
    expect(sql).toContain('message_preview');
    expect(sql).toContain("'[redacted]'"); // body column hard-coded to the marker literal

    // params: [phone, hash, preview, type, sid, status] (NULL/'[redacted]' are SQL literals)
    const [phone, hash, preview] = params;
    expect(phone).toBe(PHONE);
    expect(hash).toBe(EXPECTED_HASH);
    expect(preview).toBe(EXPECTED_PREVIEW);

    // The full body must not appear anywhere in the logged params.
    const flat = params.map(String).join(' ');
    expect(flat).not.toContain('Track: https://oxsteed.example');
  });
});

describe('sms_logs read path (item 9)', () => {
  test('(d) getSMSLogs selects hash/preview and never reads message_body', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        notification_type: 'order_created',
        message_hash: 'deadbeef',
        message_preview: 'Order #42 confirmed...',
        status: 'queued',
        sent_at: '2026-10-06T12:00:00Z',
      }],
      rowCount: 1,
    });

    const logs = await smsNotificationService.getSMSLogs('user-123');

    expect(mockQuery.mock.calls[0][0]).toContain('message_hash');
    expect(mockQuery.mock.calls[0][0]).toContain('message_preview');
    expect(mockQuery.mock.calls[0][0]).not.toContain('message_body');
    expect(logs[0]).not.toHaveProperty('message_body');
    expect(logs[0].message_hash).toBe('deadbeef');
  });

  test('(d) GET /sms/logs returns preview + hash, never the full body', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        notification_type: 'order_created',
        message_hash: 'deadbeef',
        message_preview: 'Order #42 confirmed...',
        status: 'queued',
        sent_at: '2026-10-06T12:00:00Z',
      }],
      rowCount: 1,
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'user-123' }; next(); });
    app.get('/api/notifications/sms/logs', smsNotificationController.getSMSLogs);

    const res = await request(app).get('/api/notifications/sms/logs');

    expect(res.status).toBe(200);
    const row = res.body.data[0];
    expect(row).toEqual({
      id: 1,
      type: 'order_created',
      preview: 'Order #42 confirmed...',
      messageHash: 'deadbeef',
      status: 'queued',
      sentAt: '2026-10-06T12:00:00Z',
    });
    expect(row).not.toHaveProperty('message');
  });
});
