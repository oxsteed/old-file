'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/websocketService', () => ({
  isInitialized: jest.fn().mockReturnValue(true),
  getActiveAgentCount: jest.fn().mockReturnValue(0),
  isAgentOnline: jest.fn().mockReturnValue(false),
  getConnectionStatus: jest.fn().mockReturnValue({}),
  notifyAgent: jest.fn(),
  broadcastToAdmins: jest.fn(),
  broadcastToTicket: jest.fn(),
}));

const {
  createGuestToken,
  verifyGuestToken,
  helperClaimSession,
  sendHelperMessage,
} = require('../controllers/guestChatController');
const supportRoutingController = require('../controllers/supportRoutingController');
const supportEmployerService = require('../services/supportEmployerService');

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

describe('security hardening boundaries', () => {
  test('guest chat tokens are bound to one session and reject tampering', () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const token = createGuestToken(sessionId);
    const request = (value) => ({ headers: { authorization: `Guest ${value || ''}` } });

    expect(verifyGuestToken(request(token), sessionId)).toBe(true);
    expect(verifyGuestToken(request(`${token}x`), sessionId)).toBe(false);
    expect(verifyGuestToken(request(token), '00000000-0000-4000-8000-000000000002')).toBe(false);
    expect(verifyGuestToken({ headers: {} }, sessionId)).toBe(false);
  });

  test('legacy guest-chat staff actions reject ordinary customer accounts', async () => {
    const next = jest.fn();
    const request = {
      user: { id: 'customer-1', role: 'customer' },
      params: { sessionId: 'session-1' },
      body: { message: 'hello' },
    };

    await helperClaimSession(request, responseDouble(), next);
    await sendHelperMessage(request, responseDouble(), next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0][0]).toEqual(expect.objectContaining({ status: 403, code: 'forbidden' }));
    expect(next.mock.calls[1][0]).toEqual(expect.objectContaining({ status: 403, code: 'forbidden' }));
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('legacy routing conversation reads deny unrelated signed-in users', async () => {
    jest.spyOn(supportEmployerService, 'userCanAccessBusinessConversations').mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'conversation-1',
      business_id: 'business-1',
      customer_id: 'customer-2',
      agent_id: null,
    }] });

    const res = responseDouble();
    await supportRoutingController.getConversation({
      user: { id: 'customer-1', role: 'customer' },
      params: { ticketId: 'conversation-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access denied' }));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('legacy routing status changes deny users without conversation management access', async () => {
    jest.spyOn(supportEmployerService, 'userCanAdministrateBusiness').mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'conversation-1',
      business_id: 'business-1',
      customer_id: 'customer-2',
      agent_id: null,
    }] });

    const res = responseDouble();
    await supportRoutingController.updateStatus({
      user: { id: 'customer-1', role: 'customer' },
      params: { ticketId: 'conversation-1' },
      body: { status: 'resolved' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access denied' }));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('legacy routing rejects unsupported categories and priorities before database writes', async () => {
    const res = responseDouble();
    await supportRoutingController.createConversation({
      user: { id: 'customer-1' },
      params: { businessId: 42 },
      body: { message: 'Need help', category: 'run_sql', priority: 'critical' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
