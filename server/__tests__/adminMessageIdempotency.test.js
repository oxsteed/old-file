'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/socketService', () => ({
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));

const socketService = require('../services/socketService');
const { logAdminAction } = require('../services/auditService');
const adminMessageController = require('../controllers/adminMessageController');
const superAdminController = require('../controllers/superAdminController');
const supportController = require('../controllers/supportController');
const mainAppController = require('../controllers/mainAppController');

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const USER_ID = '00000000-0000-4000-8000-000000000102';
const REQUEST_ID = '00000000-0000-4000-8000-000000000103';
const MESSAGE = { id: 'message-1', created_at: '2026-09-22T12:00:00.000Z' };

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function requestDouble(body = {}) {
  return {
    user: {
      id: ADMIN_ID,
      first_name: 'Admin',
      last_name: 'Owner',
      role: 'super_admin',
    },
    params: { userId: USER_ID },
    body,
    get: jest.fn((name) => name === 'Idempotency-Key' ? body.headerKey || undefined : undefined),
    ip: '127.0.0.1',
    headers: {},
  };
}

function supportRequestDouble(body = {}) {
  return {
    user: {
      id: ADMIN_ID,
      first_name: 'Admin',
      last_name: 'Owner',
      email: 'admin@example.com',
      role: 'super_admin',
    },
    isSuper: true,
    params: { ticketId: 'ticket-1' },
    body,
    get: jest.fn((name) => name === 'Idempotency-Key' ? body.headerKey || undefined : undefined),
  };
}

function mainAppRequestDouble(body = {}) {
  return {
    user: { id: USER_ID, email: 'user@example.com' },
    body,
    get: jest.fn((name) => name === 'Idempotency-Key' ? body.headerKey || undefined : undefined),
  };
}

function queueFirstRequest() {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: USER_ID, first_name: 'User', last_name: 'One', email: 'user@example.com', role: 'customer' }] })
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [] }) // conversation lookup
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1' }] }) // conversation insert
    .mockResolvedValueOnce({ rows: [MESSAGE] }) // message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [] }); // COMMIT
}

function queueReplayRequest() {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: USER_ID, first_name: 'User', last_name: 'One', email: 'user@example.com', role: 'customer' }] })
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1' }] }) // conversation lookup
    .mockResolvedValueOnce({ rows: [] }) // duplicate message insert
    .mockResolvedValueOnce({ rows: [MESSAGE] }) // existing message lookup
    .mockResolvedValueOnce({ rows: [] }); // COMMIT
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('admin messaging idempotency', () => {
  test('replays the regular admin message without a second broadcast, audit row, or timestamp update', async () => {
    const body = { content: 'Please review your support request.', clientMessageId: REQUEST_ID };
    queueFirstRequest();
    const firstRes = responseDouble();
    await adminMessageController.send(requestDouble(body), firstRes);

    queueReplayRequest();
    const retryRes = responseDouble();
    await adminMessageController.send(requestDouble(body), retryRes);

    expect(firstRes.status).toHaveBeenCalledWith(201);
    expect(retryRes.status).toHaveBeenCalledWith(200);
    expect(retryRes.json).toHaveBeenCalledWith(expect.objectContaining({
      message_id: MESSAGE.id,
      idempotent: true,
    }));
    expect(socketService.broadcastToUser).toHaveBeenCalledTimes(2);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE conversations SET last_message_at/.test(sql))).toHaveLength(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /client_message_id/.test(sql))).toHaveLength(3);
  });

  test('rejects malformed request identifiers before touching the database', async () => {
    const res = responseDouble();
    await adminMessageController.send(requestDouble({ content: 'Hello', clientMessageId: 'not-a-uuid' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'clientMessageId must be a valid UUID' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('super-admin messaging idempotency', () => {
  test('replays the super-admin message without a second broadcast, audit row, or timestamp update', async () => {
    const body = { content: 'A status update from support.', headerKey: REQUEST_ID };
    queueFirstRequest();
    const firstRes = responseDouble();
    await superAdminController.sendAdminMessage(requestDouble(body), firstRes);

    queueReplayRequest();
    const retryRes = responseDouble();
    await superAdminController.sendAdminMessage(requestDouble(body), retryRes);

    expect(firstRes.status).toHaveBeenCalledWith(201);
    expect(retryRes.status).toHaveBeenCalledWith(200);
    expect(retryRes.json).toHaveBeenCalledWith(expect.objectContaining({
      message_id: MESSAGE.id,
      idempotent: true,
    }));
    expect(socketService.broadcastToUser).toHaveBeenCalledTimes(1);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE conversations SET last_message_at/.test(sql))).toHaveLength(1);
  });
});

describe('support reply and report idempotency', () => {
  test('replays an admin ticket reply without changing ticket state or notifying twice', async () => {
    const body = { content: 'We are looking into this.', clientMessageId: REQUEST_ID };
    const ticket = {
      id: 'ticket-1', ticket_number: 1001, status: 'open', user_id: USER_ID,
      name: 'User One', email: 'user@example.com', subject: 'Help',
      assigned_to: null, first_response_at: null,
    };
    const message = { id: 'support-message-1', content: body.content };

    mockQuery
      .mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [message] })
      .mockResolvedValueOnce({ rows: [] }) // ticket update
      .mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate message insert
      .mockResolvedValueOnce({ rows: [message] }); // existing message lookup

    const firstRes = responseDouble();
    await supportController.adminReply(supportRequestDouble(body), firstRes);
    const retryRes = responseDouble();
    await supportController.adminReply(supportRequestDouble(body), retryRes);

    expect(firstRes.status).toHaveBeenCalledWith(201);
    expect(retryRes.status).toHaveBeenCalledWith(200);
    expect(retryRes.json).toHaveBeenCalledWith({ message, idempotent: true });
    expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE support_tickets SET/.test(sql))).toHaveLength(1);
  });

  test('replays a main-app support report without creating a second ticket or message', async () => {
    const body = { details: 'The dashboard is not loading.', clientRequestId: REQUEST_ID };
    const ticket = {
      id: 'ticket-2', ticket_number: 1002, status: 'open', priority: 'normal',
      created_at: '2026-09-22T12:00:00.000Z',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ first_name: 'User', last_name: 'One', email: 'user@example.com' }] })
      .mockResolvedValueOnce({ rows: [ticket] })
      .mockResolvedValueOnce({ rows: [] }) // initial message
      .mockResolvedValueOnce({ rows: [{ first_name: 'User', last_name: 'One', email: 'user@example.com' }] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate ticket insert
      .mockResolvedValueOnce({ rows: [ticket] }); // existing ticket lookup

    const firstRes = responseDouble();
    await mainAppController.createSupportReport(mainAppRequestDouble(body), firstRes, jest.fn());
    const retryRes = responseDouble();
    await mainAppController.createSupportReport(mainAppRequestDouble(body), retryRes, jest.fn());

    expect(firstRes.status).toHaveBeenCalledWith(201);
    expect(retryRes.status).toHaveBeenCalledWith(200);
    expect(retryRes.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO support_tickets/.test(sql))).toHaveLength(2);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO support_messages/.test(sql))).toHaveLength(1);
  });
});
