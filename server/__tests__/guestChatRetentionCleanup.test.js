'use strict';

jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
const { cleanupGuestChatRetention, retentionDays } = require('../jobs/guestChatRetentionCleanup');

test('deletes stale guest sessions in batches until a short batch (P1-267)', async () => {
  const db = { query: jest.fn().mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 500 }).mockResolvedValueOnce({ rowCount: 3 }) };
  const result = await cleanupGuestChatRetention({ db, env: {} });
  expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM order_sms_budgets/);
  expect(result).toEqual({ success: true, deleted: 503, retentionDays: 180 });
  expect(db.query).toHaveBeenCalledTimes(3);
  expect(db.query.mock.calls[1][0]).toMatch(/DELETE FROM guest_profile_chat_inbound/);
  expect(db.query.mock.calls[1][0]).toMatch(/COALESCE\(last_activity_at, created_at\)/);
  expect(db.query.mock.calls[1][1]).toEqual([180]);
});

test('retention days honour env with a 30-day floor', () => {
  expect(retentionDays({ GUEST_CHAT_RETENTION_DAYS: '90' })).toBe(90);
  expect(retentionDays({ GUEST_CHAT_RETENTION_DAYS: '5' })).toBe(180);
  expect(retentionDays({})).toBe(180);
});
