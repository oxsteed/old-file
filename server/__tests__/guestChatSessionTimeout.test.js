'use strict';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/chatTransactionService', () => ({
  withChatTransaction: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const cron = require('node-cron');
const db = require('../db');
const { withChatTransaction } = require('../services/chatTransactionService');
const { startGuestChatSessionTimeoutJob } = require('../jobs/guestChatSessionTimeout');

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
  });
});
