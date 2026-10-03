'use strict';

/**
 * Fix 6 (guest-chat spam cannon), Fix 15 (getSession column list),
 * Fix 21 (dead resolveSession guest branch).
 *
 * - POST /api/guest-chat/sessions and follow-up messages must not broadcast
 *   to helpers/admins (or fire push notifications) while the guest email is
 *   unverified. Sessions stay functional for the guest.
 * - GET /api/guest-chat/sessions/:sessionId returns an explicit guest-facing
 *   column list, never SELECT *.
 * - resolveSession no longer has a guest branch: only the assigned helper
 *   (authenticated staff) can resolve.
 */

const { mockQuery, resetMocks } = require('./setup');

// chatTransactionService runs real transactions against the mocked pg pool;
// run the operation inline against mockQuery so tests queue mocks linearly.
jest.mock('../services/chatTransactionService', () => ({
  withChatTransaction: jest.fn((operation) => operation({
    query: (...args) => mockQuery(...args),
    release: jest.fn(),
  })),
  updateSessionStatus: jest.fn().mockResolvedValue({}),
  logChatEvent: jest.fn().mockResolvedValue({}),
  queueMessageIfTransitioning: jest.fn().mockResolvedValue(false),
  drainMessageQueue: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const guestChatController = require('../controllers/guestChatController');
const socketService = require('../services/socketService');
const { sendNotification } = require('../services/notificationService');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('guest-chat broadcast gate (verified email required)', () => {
  test('createGuestSession does not broadcast for an unverified email', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] }) // session insert
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] }) // message insert
      .mockResolvedValueOnce({ rows: [] }); // verification check: not verified

    const req = {
      body: { guestName: 'Guest', guestEmail: 'new@example.com', message: 'Hello?' },
    };
    const res = responseDouble();

    await guestChatController.createGuestSession(req, res, jest.fn());

    // The endpoint still works for the guest (older clients unaffected)...
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting_for_helper' }));
    // ...but nothing is broadcast to helpers/admins.
    expect(socketService.broadcastNewGuestSession).not.toHaveBeenCalled();
  });

  test('createGuestSession broadcasts when the guest email is verified', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'session-9' }] }) // session insert
      .mockResolvedValueOnce({ rows: [{ id: 'msg-9' }] }) // message insert
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // verification check: verified

    const req = {
      body: { guestName: 'Guest', guestEmail: 'verified@example.com', message: 'Hello?' },
    };
    const res = responseDouble();

    await guestChatController.createGuestSession(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(socketService.broadcastNewGuestSession).toHaveBeenCalledWith(
      expect.objectContaining({ guestEmail: 'verified@example.com' })
    );
  });

  test('sendGuestMessage stores the message but stays silent for unverified email', async () => {
    const token = guestChatController.createGuestToken('session-1');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ // session lock
        session_status: 'waiting_for_helper',
        guest_name: 'Guest',
        guest_email: 'new@example.com',
        helper_id: 'helper-1',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-2' }] }) // message insert
      .mockResolvedValueOnce({ rows: [] }) // activity update
      .mockResolvedValueOnce({ rows: [] }); // verification check: not verified

    const req = {
      params: { sessionId: 'session-1' },
      headers: { authorization: `Guest ${token}` },
      body: { message: 'Still there?' },
    };
    const res = responseDouble();

    await guestChatController.sendGuestMessage(req, res, jest.fn());

    // Stored and acknowledged...
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-2' }));
    // ...but no broadcast and no push notification.
    expect(socketService.broadcastGuestChatMessage).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('sendGuestMessage broadcasts and pushes once the email is verified', async () => {
    const token = guestChatController.createGuestToken('session-1');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ // session lock
        session_status: 'waiting_for_helper',
        guest_name: 'Guest',
        guest_email: 'verified@example.com',
        helper_id: 'helper-1',
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-3' }] }) // message insert
      .mockResolvedValueOnce({ rows: [] }) // activity update
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // verification check: verified

    const req = {
      params: { sessionId: 'session-1' },
      headers: { authorization: `Guest ${token}` },
      body: { message: 'Thanks!' },
    };
    const res = responseDouble();

    await guestChatController.sendGuestMessage(req, res, jest.fn());

    expect(socketService.broadcastGuestChatMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ messageId: 'msg-3' })
    );
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'helper-1',
      type: 'new_message',
    }));
  });
});

describe('getSession column allowlist', () => {
  test('returns an explicit guest-facing column list, never SELECT *', async () => {
    const token = guestChatController.createGuestToken('session-1');
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'session-1',
        guest_name: 'Guest',
        guest_email: 'g@example.com',
        session_status: 'waiting_for_helper',
        message: 'Hello?',
        verification_status: 'unverified',
        created_at: '2026-10-03T00:00:00.000Z',
      }] })
      .mockResolvedValueOnce({ rows: [] }); // messages

    const req = {
      params: { sessionId: 'session-1' },
      headers: { authorization: `Guest ${token}` },
    };
    const res = responseDouble();

    await guestChatController.getSession(req, res, jest.fn());

    const selectCall = mockQuery.mock.calls.find(([sql]) => /FROM guest_profile_chat_inbound/.test(sql));
    expect(selectCall).toBeDefined();
    expect(selectCall[0]).not.toMatch(/SELECT\s+\*/i);
    for (const column of ['id', 'guest_name', 'guest_email', 'session_status', 'message', 'verification_status', 'created_at']) {
      expect(selectCall[0]).toContain(column);
    }
    for (const internal of ['ai_summary', 'helper_id', 'helper_response_deadline', 'guest_access_token_hash']) {
      expect(selectCall[0]).not.toContain(internal);
    }
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: 'session-1' }),
    }));
  });
});

describe('resolveSession ownership', () => {
  test('rejects a user who is not the assigned helper', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      session_status: 'helper_assigned',
      helper_id: 'helper-1',
    }] });

    const req = { params: { sessionId: 'session-1' }, user: { id: 'someone-else' }, body: {} };
    const res = responseDouble();
    const next = jest.fn();

    await guestChatController.resolveSession(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  test('lets the assigned helper resolve', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      session_status: 'helper_assigned',
      helper_id: 'helper-1',
    }] });

    const req = { params: { sessionId: 'session-1' }, user: { id: 'helper-1' }, body: { reason: 'done' } };
    const res = responseDouble();

    await guestChatController.resolveSession(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', status: 'resolved' })
    );
    expect(socketService.broadcastGuestSessionUpdate).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ status: 'resolved' })
    );
  });
});
