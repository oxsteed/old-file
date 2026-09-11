'use strict';

const crypto = require('crypto');

const mockWithTransaction = jest.fn();
jest.mock('../utils/transaction', () => ({ withTransaction: mockWithTransaction }));
jest.mock('../db', () => ({}));
jest.mock('../services/websocketService', () => ({
  broadcastToAdmins: jest.fn(),
}));

const { ingestChannelWebhook, parsePayload } = require('../controllers/supportChannelWebhookController');
const WebSocketService = require('../services/websocketService');

const SECRET = 'test-support-channel-secret';

function requestFor(payload, signature, channel = 'email') {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const headers = { 'x-oxsteed-signature': signature };
  return {
    body: rawBody,
    params: { channel },
    get(name) { return headers[String(name).toLowerCase()]; },
  };
}

function response() {
  const result = {};
  return {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return result; },
    result,
  };
}

function signatureFor(payload) {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex')}`;
}

beforeEach(() => {
  mockWithTransaction.mockReset();
  WebSocketService.broadcastToAdmins.mockClear();
  process.env.SUPPORT_EMAIL_WEBHOOK_SECRET = SECRET;
  process.env.SUPPORT_CHANNEL_WEBHOOK_BUSINESS_ID = '42';
});

afterAll(() => {
  delete process.env.SUPPORT_EMAIL_WEBHOOK_SECRET;
  delete process.env.SUPPORT_CHANNEL_WEBHOOK_BUSINESS_ID;
});

describe('support channel webhook ingestion', () => {
  test('accepts a signed SMS identity without requiring an email address', () => {
    const payload = parsePayload({
      body: Buffer.from(JSON.stringify({
        eventId: 'sms-event', externalThreadId: 'sms-thread', from: '+19375550100', content: 'Text support',
      })),
      params: { channel: 'sms' },
      get() { return undefined; },
    });
    expect(payload).toMatchObject({ channel: 'sms', customerPhone: '+19375550100', customerEmail: null });
  });

  test('rejects an invalid signature before opening a transaction', async () => {
    const payload = {
      eventId: 'evt-invalid',
      externalThreadId: 'thread-1',
      customerEmail: 'customer@example.com',
      content: 'Hello support',
    };
    const res = response();

    await ingestChannelWebhook(requestFor(payload, 'sha256-invalid'), res);

    expect(res.result.status).toBe(401);
    expect(res.result.body.error).toMatch(/signature/i);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  test('returns a normalized idempotent result for a new event', async () => {
    const payload = {
      eventId: 'evt-1',
      externalThreadId: 'thread-1',
      externalMessageId: 'message-1',
      customerEmail: 'customer@example.com',
      customerName: 'Customer One',
      subject: 'Billing question',
      content: 'Please help with my invoice.',
      metadata: { provider: 'test' },
    };
    mockWithTransaction.mockResolvedValue({ duplicate: false, conversationId: 'conversation-1', messageId: 'message-1' });
    const res = response();

    await ingestChannelWebhook(requestFor(payload, signatureFor(payload)), res);

    expect(res.result.status).toBe(202);
    expect(res.result.body).toMatchObject({ success: true, idempotent: false, conversationId: 'conversation-1', messageId: 'message-1' });
    expect(mockWithTransaction).toHaveBeenCalledWith(expect.anything(), expect.any(Function), 'ingest_support_channel_webhook');
    expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith('support:conversation-updated', expect.objectContaining({ conversationId: 'conversation-1', channel: 'email' }));
  });

  test('returns the existing conversation for a duplicate event without rebroadcasting', async () => {
    const payload = {
      eventId: 'evt-duplicate',
      externalThreadId: 'thread-1',
      customerEmail: 'customer@example.com',
      content: 'Duplicate delivery',
    };
    mockWithTransaction.mockResolvedValue({ duplicate: true, conversationId: 'conversation-1' });
    const res = response();

    await ingestChannelWebhook(requestFor(payload, signatureFor(payload)), res);

    expect(res.result.status).toBe(200);
    expect(res.result.body).toMatchObject({ success: true, idempotent: true, conversationId: 'conversation-1', messageId: null });
    expect(WebSocketService.broadcastToAdmins).not.toHaveBeenCalled();
  });

  test('redirects inbound messages from a merged thread to its surviving conversation', async () => {
    const payload = {
      eventId: 'evt-merged',
      externalThreadId: 'thread-merged',
      externalMessageId: 'message-merged',
      customerEmail: 'customer@example.com',
      customerName: 'Customer One',
      content: 'A follow-up after the merge.',
    };
    const queries = [
      { rows: [{ id: 'event-merged' }] },
      { rows: [] },
      { rows: [{ id: 'source-thread', status: 'merged', merged_into_conversation_id: 'surviving-thread' }] },
      { rows: [{ id: 'surviving-thread', status: 'open', merged_into_conversation_id: null }] },
      { rows: [{ id: 'surviving-thread' }] },
      { rows: [{ id: 'message-merged' }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ];
    const client = { query: jest.fn().mockImplementation(async () => queries.shift() || { rows: [] }) };
    mockWithTransaction.mockImplementation(async (_pool, operation) => operation(client));
    const res = response();

    await ingestChannelWebhook(requestFor(payload, signatureFor(payload)), res);

    expect(res.result.status).toBe(202);
    expect(res.result.body).toMatchObject({
      success: true,
      conversationId: 'surviving-thread',
      messageId: 'message-merged',
    });
    const messageInsert = client.query.mock.calls.find(([sql]) => /INSERT INTO support_conversation_messages/.test(sql));
    expect(messageInsert[1][0]).toBe('surviving-thread');
    const sourceUpdate = client.query.mock.calls.find(([sql]) => /UPDATE support_conversations/.test(sql));
    expect(sourceUpdate[1][0]).toBe('surviving-thread');
    expect(WebSocketService.broadcastToAdmins).toHaveBeenCalledWith(
      'support:conversation-updated',
      expect.objectContaining({ conversationId: 'surviving-thread' })
    );
  });
});
