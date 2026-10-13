'use strict';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/chatTransactionService', () => ({
  withChatTransaction: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../services/socketService', () => ({ broadcastGuestChatMessage: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({}) }));

const cron = require('node-cron');
const db = require('../db');
const { withChatTransaction } = require('../services/chatTransactionService');
const { startGuestChatSessionTimeoutJob, runGuestChatSessionTimeoutPass, fallbackMessage } = require('../jobs/guestChatSessionTimeout');
const { broadcastGuestChatMessage } = require('../services/socketService');
const { sendNotification } = require('../services/notificationService');

describe('guest chat session timeout job', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('clears the helper deadline when moving a session to AI fallback', async () => {
    db.query.mockResolvedValue({
      rows: [{ id: 'session-1', guest_name: 'Guest' }],
    });

    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            session_status: 'waiting_for_helper',
            helper_response_deadline: new Date(Date.now() - 60_000),
            verification_status: 'verified',
          }],
        })
        .mockResolvedValue({ rows: [] }),
    };
    withChatTransaction.mockImplementation(async (callback) => callback(client));

    startGuestChatSessionTimeoutJob();
    const scheduledCallback = cron.schedule.mock.calls[0][1];
    await scheduledCallback();

    const updateCall = client.query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE guest_profile_chat_inbound')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('helper_response_deadline = NULL');
    expect(updateCall[1]).toEqual(['ai_fallback_pending', 'session-1']);

    const monitoringCall = client.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO chat_monitoring_log')
    );
    expect(monitoringCall[1][1]).toBe('ai_fallback_triggered_timeout');
  });

  test('posts a localized system_ai fallback, activates AI support and notifies the helper (P1-264)', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'session-2', guest_name: 'Guest' }] });
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [{ session_status: 'waiting_for_helper', helper_response_deadline: new Date(Date.now() - 1000), verification_status: 'verified' }] };
        }
        if (sql.includes('LEFT JOIN users h')) return { rows: [{ helper_id: 'helper-1', helper_first_name: 'Rosa', guest_language: 'es' }] };
        if (sql.includes('INSERT INTO guest_profile_chat_messages')) return { rows: [{ id: 77, created_at: new Date() }] };
        return { rows: [] };
      }),
    };
    withChatTransaction.mockImplementation(async (callback) => callback(client));
    await runGuestChatSessionTimeoutPass();

    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO guest_profile_chat_messages'));
    expect(insert[0]).toContain("'system_ai'");
    expect(insert[1][1]).toMatch(/^Rosa aún no ha respondido/);
    const activate = client.query.mock.calls.find(([sql]) => sql.includes("SET session_status = 'ai_support_active'"));
    expect(activate).toBeDefined();
    expect(broadcastGuestChatMessage).toHaveBeenCalledWith('session-2', expect.objectContaining({ senderType: 'system_ai', messageId: 77 }));
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'helper-1', idempotencyKey: 'guest-chat-fallback:session-2' }));
  });

  test('skips sessions a helper already claimed', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 's3' }] });
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ session_status: 'helper_assigned', verification_status: 'verified' }] }) };
    withChatTransaction.mockImplementation(async (callback) => callback(client));
    await runGuestChatSessionTimeoutPass();
    expect(broadcastGuestChatMessage).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('fallback text falls back to English and a generic name', () => {
    expect(fallbackMessage('xx', '')).toMatch(/^The helper hasn't replied yet/);
    expect(fallbackMessage('ar', 'Ali')).toContain('Ali');
  });
});
