'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/supportConversationsController');
const supportChannelDeliveryService = require('../services/supportChannelDeliveryService');

jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
  broadcastToTicket: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

function response() {
  const result = { statusCode: 200, body: null };
  return {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return result; },
    result,
  };
}

const REQUEST_ID = '5da116f3-0b2e-4e87-8d51-bf7a8a99b9c1';
const conversation = {
  id: 'conversation-1',
  business_id: 42,
  customer_id: null,
  agent_id: null,
  status: 'in_progress',
  channel: 'sms',
  subject: 'Billing question',
  customer_email: null,
  customer_phone: '+19375550100',
  guest_email: null,
  guest_name: 'Guest',
};

function request(body = {}) {
  return {
    params: { conversationId: 'conversation-1' },
    body,
    user: { id: 'admin-1', role: 'super_admin' },
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  jest.spyOn(supportChannelDeliveryService, 'deliverSupportChannel').mockResolvedValue({
    status: 'sent', provider: 'twilio', providerMessageId: 'SM123',
  });
});

afterEach(() => jest.restoreAllMocks());

function queueSuccessfulInsert() {
  mockQuery
    .mockResolvedValueOnce({ rows: [conversation] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', created_at: new Date().toISOString() }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'delivery-1' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
}

test('sends a configured external channel reply and masks the destination', async () => {
  queueSuccessfulInsert();
  const res = response();

  await controller.sendConversationChannelMessage(request({
    channel: 'sms', content: 'Your issue is resolved.', requestId: REQUEST_ID,
  }), res);

  expect(res.result.statusCode).toBe(201);
  expect(res.result.body).toMatchObject({ success: true, data: { status: 'sent', channel: 'sms', recipient: '***0100' } });
  expect(supportChannelDeliveryService.deliverSupportChannel).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'sms', recipient: '+19375550100', idempotencyKey: REQUEST_ID,
  }));
  expect(mockQuery.mock.calls.some(([sql]) => /support_channel_deliveries/.test(sql))).toBe(true);
});

test('records provider configuration failure without claiming the reply was sent', async () => {
  queueSuccessfulInsert();
  supportChannelDeliveryService.deliverSupportChannel.mockResolvedValueOnce({
    status: 'not_configured', provider: 'twilio', errorCode: 'provider_not_configured', error: 'Twilio is not configured',
  });
  const res = response();

  await controller.sendConversationChannelMessage(request({
    channel: 'sms', content: 'Please call us back.', requestId: REQUEST_ID,
  }), res);

  expect(res.result.statusCode).toBe(503);
  expect(res.result.body.error).toMatch(/Twilio is not configured/i);
  expect(mockQuery.mock.calls.some(([sql, params]) => /SET status = \$1/.test(sql) && params[0] === 'failed')).toBe(true);
});

test('returns an explicit unsupported response for phone/social adapters', async () => {
  const unsupportedConversation = { ...conversation, channel: 'social' };
  mockQuery.mockResolvedValueOnce({ rows: [unsupportedConversation] })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1', created_at: new Date().toISOString() }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'delivery-1' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  supportChannelDeliveryService.deliverSupportChannel.mockResolvedValueOnce({
    status: 'unsupported', provider: null, error: 'Outbound social delivery is not configured',
  });
  const res = response();

  await controller.sendConversationChannelMessage(request({
    channel: 'social', content: 'Follow-up', requestId: REQUEST_ID,
  }), res);

  expect(res.result.statusCode).toBe(501);
  expect(res.result.body.error).toMatch(/not configured/i);
});

test('rejects customer access and malformed request identifiers before creating a delivery', async () => {
  const invalidRes = response();
  await controller.sendConversationChannelMessage(request({ channel: 'sms', content: 'Hi', requestId: 'bad' }), invalidRes);
  expect(invalidRes.result.statusCode).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();

  resetMocks();
  mockQuery.mockResolvedValueOnce({ rows: [{ ...conversation, customer_id: 'admin-1' }] });
  const customerRes = response();
  await controller.sendConversationChannelMessage(request({ channel: 'sms', content: 'Hi', requestId: REQUEST_ID }), customerRes);
  expect(customerRes.result.statusCode).toBe(403);
  expect(supportChannelDeliveryService.deliverSupportChannel).not.toHaveBeenCalled();
});

test('does not resend a request that is already in flight', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [conversation] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'delivery-1', status: 'sending', provider: 'twilio' }] });
  const res = response();

  await controller.sendConversationChannelMessage(request({ channel: 'sms', content: 'Hi', requestId: REQUEST_ID }), res);

  expect(res.result.statusCode).toBe(409);
  expect(supportChannelDeliveryService.deliverSupportChannel).not.toHaveBeenCalled();
});
