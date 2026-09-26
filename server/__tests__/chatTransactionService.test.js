'use strict';

jest.mock('../db', () => ({ connect: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const pool = require('../db');
const { updateSessionStatus } = require('../services/chatTransactionService');

describe('chat transaction status updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('clears helper deadlines for every non-waiting status transition', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ session_status: 'waiting_for_helper', helper_id: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 'session-1', session_status: 'ai_fallback_pending' }] }),
    };
    pool.connect.mockResolvedValue(client);

    await updateSessionStatus(client, 'session-1', 'ai_fallback_pending', {
      ai_fallback_triggered_at: '2026-09-26T00:00:00.000Z',
    });

    const [sql, params] = client.query.mock.calls[1];
    expect(sql).toContain('helper_response_deadline = $');
    expect(params).toContain(null);
  });
});
