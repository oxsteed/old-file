'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/websocketService', () => ({
  notifyAgent: jest.fn(),
  broadcastToAdmins: jest.fn(),
  broadcastToTicket: jest.fn(),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('support-conversations/test-image.png'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('/api/storage/files/support-conversations/test-image.png'),
}));

const SupportRoutingService = require('../services/supportRoutingService');
const WebSocketService = require('../services/websocketService');
const supportRoutingController = require('../controllers/supportRoutingController');
const supportConversationsController = require('../controllers/supportConversationsController');
const conversationAssignmentController = require('../controllers/conversationAssignmentController');
const supportEmployerService = require('../services/supportEmployerService');
const storage = require('../utils/storage');

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
    const resumeMessagesSql = mockQuery.mock.calls.find(([sql]) => /FROM support_conversation_messages/.test(sql))?.[0];
    expect(resumeMessagesSql).toContain("message_type <> 'internal_note'");

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
    expect(listSql).toContain('unread_count');
    expect(listSql).toContain("COALESCE(unread_scm.message_type, 'text') <> 'internal_note'");
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
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-new' }] })
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
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversation_assignments/.test(sql))).toBe(true);
  });

  test('puts a signed-in customer into the persistent five-minute wait lifecycle', async () => {
    jest.spyOn(SupportRoutingService, 'routeTicket').mockResolvedValue({
      routedTo: 'queue',
      confidence: 0.6,
      agentId: null,
    });

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-waiting', status: 'open', agent_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          status: 'waiting_for_agent',
          agent_id: null,
          live_wait_expires_at: expiresAt,
          live_wait_ended_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'customer-1', name: 'Customer One', email: 'customer@example.com' },
      params: { businessId: 'business-1' },
      body: {},
    };
    const res = responseDouble();

    await supportRoutingController.connectConversation(req, res);

    const waitUpdate = mockQuery.mock.calls.find(([sql]) => /live_wait_started_at/.test(sql));
    expect(waitUpdate[0]).toContain("INTERVAL '5 minutes'");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 'ticket-waiting',
      routedTo: 'queue',
      waiting: expect.objectContaining({ state: 'waiting' }),
    }));
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

  test('treats the multipart legacy fields as a public agent reply when requested', async () => {
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
          id: 'message-agent-2',
          content: 'Public follow-up.',
          created_at: '2026-08-13T00:03:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'admin-1', name: 'Ava Agent', role: 'admin' },
      params: { conversationId: 'ticket-1' },
      body: { message: 'Public follow-up.', is_internal: 'false' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    expect(insertCall[1][2]).toBe('text');
    expect(insertCall[1][3]).toBe('Public follow-up.');
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'ticket-1',
      'message:new',
      expect.objectContaining({
        content: 'Public follow-up.',
        isInternal: false,
      })
    );
  });

  test('persists an authenticated image-only reply with non-null content', async () => {
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
          id: 'message-image-1',
          content: 'Attachment',
          message_type: 'image',
          created_at: '2026-09-10T12:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'admin-1', name: 'Ava Agent', role: 'admin' },
      params: { conversationId: 'ticket-1' },
      body: {},
      file: { buffer: Buffer.from('image'), mimetype: 'image/png', originalname: 'proof.png' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    expect(insertCall[1][3]).toBe('Attachment');
    expect(storage.uploadFile).toHaveBeenCalled();
    expect(WebSocketService.broadcastToTicket).toHaveBeenCalledWith(
      'ticket-1',
      'message:new',
      expect.objectContaining({ content: 'Attachment', messageType: 'image' })
    );
  });

  test('replays an authenticated retry without incrementing counters or rebroadcasting', async () => {
    const clientMessageId = '22222222-2222-4222-8222-222222222222';
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'message-existing',
        sender_id: 'admin-1',
        content: 'I can help with that.',
        message_type: 'text',
        client_message_id: clientMessageId,
        created_at: '2026-09-10T12:00:00.000Z',
      }] });

    const req = {
      user: { id: 'admin-1', name: 'Ava Agent', role: 'admin' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'I can help with that.', clientMessageId },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      idempotent: true,
      data: expect.objectContaining({ id: 'message-existing' }),
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversations/.test(sql))).toBe(false);
    expect(WebSocketService.broadcastToTicket).not.toHaveBeenCalled();
  });

  test('keeps a customer reply and waiting-state transition atomic', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          business_id: 'business-1',
          customer_id: 'customer-1',
          agent_id: null,
          status: 'waiting_for_customer',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'message-customer-1', content: 'I have one more detail.', created_at: '2026-08-13T00:04:00.000Z' }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const req = {
      user: { id: 'customer-1', name: 'Customer One', role: 'customer' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'I have one more detail.' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO support_conversation_messages/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE support_conversations/);
    expect(mockQuery.mock.calls[3][0]).toMatch(/SET status = \$1/);
  });

  test('rejects unsafe caller-supplied attachment references', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'ticket-1',
        business_id: 'business-1',
        customer_id: 'customer-1',
        agent_id: null,
        status: 'in_progress',
      }],
    });

    const req = {
      user: { id: 'customer-1', role: 'customer' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'Here is a file.', attachmentUrl: 'javascript:alert(1)', attachmentName: 'bad.txt' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_messages/.test(sql))).toBe(false);
  });

  test('rejects customer attempts to use internal message types', async () => {
    const req = {
      user: { id: 'customer-1', role: 'customer' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'This should remain public.', messageType: 'internal_note' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('lets a platform admin leave a private note without broadcasting it to the customer', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          business_id: 'business-1',
          customer_id: 'customer-1',
          agent_id: null,
          status: 'in_progress',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'note-1',
          content: 'Customer identity verified.',
          message_type: 'internal_note',
          created_at: '2026-08-13T00:02:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'admin-1', first_name: 'Ava', role: 'super_admin' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'Customer identity verified.', isInternal: true },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    expect(insertCall[1][2]).toBe('internal_note');
    expect(WebSocketService.broadcastToTicket).not.toHaveBeenCalled();
    expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
      'support:conversation-updated',
      expect.objectContaining({ ticketId: 'ticket-1', isInternal: true })
    );
  });

  test('requires an unassigned support agent to claim a conversation before replying', async () => {
    jest.spyOn(require('../services/supportEmployerService'), 'userCanAdministrateBusiness')
      .mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'ticket-1',
        business_id: 'business-1',
        customer_id: 'customer-1',
        agent_id: null,
        status: 'waiting_for_agent',
      }],
    });

    const req = {
      user: { id: 'agent-user-1', role: 'helper' },
      params: { conversationId: 'ticket-1' },
      body: { content: 'I can help.' },
    };
    const res = responseDouble();

    await supportConversationsController.addMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_conversation_messages/.test(sql))).toBe(false);
  });

  test('claims a support conversation with an atomic conditional update', async () => {
    jest.spyOn(require('../services/supportEmployerService'), 'findAgentForConversationBusiness')
      .mockResolvedValue({
        id: 'agent-1',
        is_available: true,
        max_concurrent_chats: 3,
      });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'ticket-1', business_id: 1, agent_id: null, status: 'waiting_for_agent' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', is_available: true, max_concurrent_chats: 3 }] })
      .mockResolvedValueOnce({ rows: [{ chat_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'assignment-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'agent-user-1', role: 'helper' },
      params: { conversationId: 'ticket-1' },
    };
    const res = responseDouble();

    await conversationAssignmentController.claimConversation(req, res);

    const claimUpdate = mockQuery.mock.calls.find(([sql]) => /UPDATE support_conversations/.test(sql));
    expect(claimUpdate[0]).toContain('agent_id IS NULL');
    expect(claimUpdate[0]).toContain("status NOT IN ('resolved', 'closed', 'pending_verification')");
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'assignment-1' } });
    expect(WebSocketService.broadcastToAdmins).toHaveBeenCalled();
  });

  test('returns a conflict when another operator wins the claim race', async () => {
    jest.spyOn(require('../services/supportEmployerService'), 'findAgentForConversationBusiness')
      .mockResolvedValue({
        id: 'agent-1',
        is_available: true,
        max_concurrent_chats: 3,
      });
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'ticket-1', business_id: 1, agent_id: null, status: 'waiting_for_agent' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', is_available: true, max_concurrent_chats: 3 }] })
      .mockResolvedValueOnce({ rows: [{ chat_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'agent-user-1', role: 'helper' },
      params: { conversationId: 'ticket-1' },
    };
    const res = responseDouble();

    await conversationAssignmentController.claimConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO conversation_assignments/.test(sql))).toBe(false);
    expect(WebSocketService.broadcastToAdmins).not.toHaveBeenCalled();
  });

  test('starts a fresh wait window when an active conversation is released', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', business_id: 1, agent_id: 'agent-1', status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'assignment-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'agent-user-1', role: 'helper' },
      params: { conversationId: 'ticket-1' },
      body: { reason: 'End of shift' },
    };
    const res = responseDouble();

    await conversationAssignmentController.releaseConversation(req, res);

    const requeueUpdate = mockQuery.mock.calls.find(([sql]) => /UPDATE support_conversations/.test(sql));
    expect(requeueUpdate[0]).toContain("INTERVAL '5 minutes'");
    expect(requeueUpdate[0]).toContain('founder_alert_sent_at = NULL');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('keeps internal notes out of the customer conversation query', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          business_id: 'business-1',
          customer_id: 'customer-1',
          agent_id: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'customer-1', role: 'customer' },
      params: { conversationId: 'ticket-1' },
    };
    const res = responseDouble();

    await supportConversationsController.getConversation(req, res);

    const messageCall = mockQuery.mock.calls.find(([sql]) => /FROM support_conversation_messages scm/.test(sql));
    expect(messageCall[0]).toContain("scm.message_type <> 'internal_note'");
    expect(messageCall[1]).toEqual(['ticket-1', true]);
  });

  test('returns same-email support history with internal notes to authorized staff only', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-current',
          business_id: 42,
          customer_id: 'customer-1',
          guest_email: null,
          agent_id: null,
          customer_email: 'customer@example.com',
          subject: 'Current request',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'current-message', content: 'Current message' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-previous',
          business_id: 42,
          customer_email: 'customer@example.com',
          subject: 'Previous request',
          status: 'resolved',
          customer_message_count: 1,
          agent_message_count: 2,
          created_at: '2026-08-12T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'note-previous',
          conversation_id: 'ticket-previous',
          message_type: 'internal_note',
          content: 'Followed up by email.',
          is_agent: true,
        }],
      });

    const req = {
      user: { id: 'admin-1', role: 'super_admin' },
      params: { conversationId: 'ticket-current' },
    };
    const res = responseDouble();

    await supportConversationsController.getConversation(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerHistory: expect.objectContaining({
          email: 'customer@example.com',
          previousConversationCount: 1,
          conversations: [expect.objectContaining({
            id: 'ticket-previous',
            messages: [expect.objectContaining({
              message_type: 'internal_note',
              content: 'Followed up by email.',
            })],
          })],
        }),
      }),
    }));
  });

  test('loads same-email history for a business-scoped agent with UUID business IDs', async () => {
    const accessSpy = jest.spyOn(supportEmployerService, 'userCanAccessBusinessConversations').mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-current',
          business_id: '00000000-0000-4000-8000-000000000042',
          customer_id: 'customer-1',
          guest_email: null,
          agent_id: null,
          customer_email: 'customer@example.com',
          subject: 'Current request',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'current-message', content: 'Current message' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-previous',
          business_id: '00000000-0000-4000-8000-000000000042',
          customer_email: 'customer@example.com',
          subject: 'Previous request',
          status: 'resolved',
          customer_message_count: 1,
          agent_message_count: 1,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'agent-user-1', role: 'helper' },
      params: { conversationId: 'ticket-current' },
    };
    const res = responseDouble();

    try {
      await supportConversationsController.getConversation(req, res);
    } finally {
      accessSpy.mockRestore();
    }

    const historyCall = mockQuery.mock.calls.find(([sql]) => /LOWER\(BTRIM\(COALESCE\(u\.email, sc\.guest_email\)\)\)/.test(sql));
    expect(historyCall[0]).toContain('sc.business_id = $3');
    expect(historyCall[0]).not.toContain('sc.business_id = $3::integer');
    expect(historyCall[1]).toEqual(['ticket-current', 'customer@example.com', '00000000-0000-4000-8000-000000000042']);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('reopens a customer conversation and requeues it atomically', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ticket-1',
          business_id: null,
          customer_id: 'customer-1',
          agent_id: null,
          status: 'resolved',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'ticket-1', status: 'open', updated_at: '2026-09-10T12:00:00.000Z' }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const req = {
      user: { id: 'customer-1', role: 'customer' },
      params: { conversationId: 'ticket-1' },
    };
    const res = responseDouble();

    await supportConversationsController.reopenCustomerConversation(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ id: 'ticket-1', status: 'open' }),
    }));
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE support_conversations/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/UPDATE support_queue/);
  });
});
