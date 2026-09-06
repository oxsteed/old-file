'use strict';

const { mockQuery, resetMocks } = require('./setup');
const email = require('../utils/email');
const WebSocketService = require('../services/websocketService');
const controller = require('../controllers/supportConversationsController');

jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
  broadcastToTicket: jest.fn(),
}));

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  email.sendEmail.mockResolvedValue({ success: true, id: 'email-test' });
});

test('platform admin can email a verified missed guest and the delivery is audited', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'conversation-1', business_id: null, customer_id: null, agent_id: null,
      guest_verified_at: new Date(), customer_email: 'guest@example.com', customer_name: 'Guest Person',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', created_at: new Date() }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  const req = {
    user: { id: 'admin-1', role: 'super_admin', first_name: 'Admin' },
    params: { conversationId: 'conversation-1' },
    body: {
      subject: 'Following up',
      content: '<script>unsafe</script>\nCan we help?',
      requestId: '5da116f3-0b2e-4e87-8d51-bf7a8a99b9c1',
    },
  };
  const res = responseDouble();

  await controller.sendConversationEmail(req, res);

  expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'guest@example.com',
    from: 'support@oxsteed.com',
    idempotencyKey: 'support-conversation-email-5da116f3-0b2e-4e87-8d51-bf7a8a99b9c1',
  }));
  expect(email.sendEmail.mock.calls[0][0].html).not.toContain('<script>unsafe</script>');
  expect(email.sendEmail.mock.calls[0][0].html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
  expect(mockQuery.mock.calls.some(([sql, params]) => /SET status = \$1/.test(sql) && params[0] === 'sent')).toBe(true);
  expect(WebSocketService.broadcastToAdmins).toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(201);
});

test('unverified guest email is never exposed to the mail provider', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'conversation-1', business_id: null, customer_id: null, agent_id: null,
    guest_verified_at: null, customer_email: 'unverified@example.com', customer_name: 'Guest',
  }] });
  const req = {
    user: { id: 'admin-1', role: 'admin' },
    params: { conversationId: 'conversation-1' },
    body: { subject: 'Following up', content: 'Can we help?', requestId: 'b9234f71-5392-4dbe-8381-cff05a5005fd' },
  };
  const res = responseDouble();

  await controller.sendConversationEmail(req, res);

  expect(email.sendEmail).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(409);
});

test('provider rejection is retained as a failed audited delivery', async () => {
  email.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider rejected' });
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'conversation-1', business_id: null, customer_id: 'user-1', agent_id: null,
      guest_verified_at: null, customer_email: 'user@example.com', customer_name: 'User',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', created_at: new Date() }] })
    .mockResolvedValueOnce({ rows: [] });
  const req = {
    user: { id: 'admin-1', role: 'super_admin' },
    params: { conversationId: 'conversation-1' },
    body: { subject: 'Following up', content: 'Can we help?', requestId: '7e3cd505-7a79-405e-bdd9-d93ce599fd60' },
  };
  const res = responseDouble();

  await controller.sendConversationEmail(req, res);

  expect(mockQuery.mock.calls.some(([sql, params]) => /SET status = \$1/.test(sql) && params[0] === 'failed')).toBe(true);
  expect(res.status).toHaveBeenCalledWith(502);
});

test('replayed request id never sends a duplicate email', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'conversation-1', business_id: null, customer_id: 'user-1', agent_id: null,
      guest_verified_at: null, customer_email: 'user@example.com', customer_name: 'User',
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', status: 'sent', created_at: new Date() }] });
  const req = {
    user: { id: 'admin-1', role: 'super_admin' },
    params: { conversationId: 'conversation-1' },
    body: { subject: 'Following up', content: 'Can we help?', requestId: 'e0b72273-4879-457b-8e4f-a53417207dd7' },
  };
  const res = responseDouble();

  await controller.sendConversationEmail(req, res);

  expect(email.sendEmail).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true, success: true }));
});

test('concurrent replay reports an in-flight send and does not call the provider twice', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'conversation-1', business_id: null, customer_id: 'user-1', agent_id: null,
      guest_verified_at: null, customer_email: 'user@example.com', customer_name: 'User',
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', status: 'sending', created_at: new Date() }] });
  const req = {
    user: { id: 'admin-1', role: 'super_admin' },
    params: { conversationId: 'conversation-1' },
    body: { subject: 'Following up', content: 'Can we help?', requestId: '9576ed14-8b55-4e8e-9cc9-ff7b728146af' },
  };
  const res = responseDouble();

  await controller.sendConversationEmail(req, res);

  expect(email.sendEmail).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(409);
});
