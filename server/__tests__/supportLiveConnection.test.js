'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/websocketService', () => ({
  notifyAgent: jest.fn(),
  broadcastToAdmins: jest.fn(),
  broadcastToTicket: jest.fn(),
}));

const SupportRoutingService = require('../services/supportRoutingService');
const WebSocketService = require('../services/websocketService');
const supportRoutingController = require('../controllers/supportRoutingController');
const supportConversationsController = require('../controllers/supportConversationsController');

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe('live support connection lifecycle', () => {
  test('resumes the customer active assigned conversation without creating a duplicate', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-existing',
          status: 'in_progress',
          agent_id: 'agent-1',
          agent_first_name: 'Ava',
          agent_last_name: 'Agent',
          agent_email: 'ava@example.com',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'message-1',
          sender_id: 'customer-1',
          content: 'I still need help.',
          message_type: 'text',
          is_agent: false,
          created_at: '2026-08-13T00:00:00.000Z',
        }],
      });

    const req = {
      user: { id: 'customer-1', email: 'customer@example.com' },
      params: { businessId: 'business-1' },
      body: {},
    };
    const res = responseDouble();

    await supportRoutingController.connectConversation(req, res);

    const resumeSql = mockQuery.mock.calls.find(([sql]) => /FROM support_conversations sc/.test(sql))?.[0];
    expect(resumeSql).toContain('au.first_name');
    expect(resumeSql).toContain('au.last_name');
    expect(resumeSql).not.toMatch(/\bau\.name\b/);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 'ticket-existing',
      routedTo: 'agent',
      resumed: true,
      assignedAgent: expect.objectContaining({ name: 'Ava Agent' }),
      messages: expect.arrayContaining([expect.objectContaining({ id: 'message-1' })]),
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversations/.test(sql))).toBe(false);
  });

  test('lists support conversations using the production user name columns', async () => {
    jest.spyOn(require('../services/supportEmployerService'), 'userCanManageBusiness')
      .mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'admin-1', role: 'admin' },
      params: { businessId: 'business-1' },
      query: {},
    };
    const res = responseDouble();

    await supportConversationsController.listConversations(req, res);

    const listSql = mockQuery.mock.calls.find(([sql]) => /FROM support_conversations sc/.test(sql))?.[0];
    expect(listSql).toContain('u.first_name');
    expect(listSql).toContain('u.last_name');
    expect(listSql).toContain('au.first_name');
    expect(listSql).toContain('au.last_name');
    expect(listSql).not.toMatch(/\b(?:u|au)\.name\b/);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  test('lets a customer poll their own conversation without a business-owner lookup', async () => {
    const manageSpy = jest.spyOn(require('../services/supportEmployerService'), 'userCanManageBusiness');
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          business_id: 'business-1',
          customer_id: 'customer-1',
          agent_id: 'agent-1',
          customer_name: 'Customer One',
          agent_name: 'Ava Agent',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'customer-1', role: 'customer' },
      params: { conversationId: 'ticket-1' },
    };
    const res = responseDouble();

    await supportConversationsController.getConversation(req, res);

    expect(manageSpy).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ id: 'ticket-1', messages: [] }),
    }));
  });

  test('uses canonical business ownership and membership columns for support access', () => {
    const { BUSINESS_ACCESS_SQL } = require('../services/supportEmployerService');
    expect(BUSINESS_ACCESS_SQL).toContain('b.user_id');
    expect(BUSINESS_ACCESS_SQL).toContain('business_members');
    expect(BUSINESS_ACCESS_SQL).not.toContain('b.owner_id');
    expect(BUSINESS_ACCESS_SQL).not.toContain('b.admin_user_ids');
  });

  test('creates and immediately routes a new live support conversation', async () => {
    jest.spyOn(SupportRoutingService, 'routeTicket').mockResolvedValue({
      routedTo: 'agent',
      confidence: 0.6,
      agentId: 'agent-1',
      agent: {
        id: 'agent-1',
        first_name: 'Ava',
        last_name: 'Agent',
        email: 'ava@example.com',
      },
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-new' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'customer-1', name: 'Customer One', email: 'customer@example.com' },
      params: { businessId: 'business-1' },
      body: {},
    };
    const res = responseDouble();

    await supportRoutingController.connectConversation(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 'ticket-new',
      routedTo: 'agent',
      resumed: false,
      assignedAgent: expect.objectContaining({ id: 'agent-1', name: 'Ava Agent' }),
    }));
    expect(WebSocketService.notifyAgent).toHaveBeenCalledWith(
      'agent-1',
      'ticket:new-assignment',
      expect.objectContaining({ ticketId: 'ticket-new' })
    );
  });

  test('stores and broadcasts an assigned agent reply as an agent message', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          business_id: 'business-1',
          customer_id: 'customer-1',
          agent_id: 'agent-1',
          status: 'in_progress',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ user_id: 'admin-1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'message-agent-1',
          content: 'I can help with that.',
          created_at: '2026-08-13T00:01:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'admin-1', name: 'Ava Agent', role: 'admin' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'I can help with that.' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    expect(insertCall[1][6]).toBe(true);
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'ticket-1',
      'message:new',
      expect.objectContaining({
        messageId: 'message-agent-1',
        ticketId: 'ticket-1',
        sender: expect.objectContaining({ type: 'agent', id: 'admin-1' }),
        content: 'I can help with that.',
      })
    );
  });
});
