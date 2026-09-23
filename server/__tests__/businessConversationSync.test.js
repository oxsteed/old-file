'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { ensureBusinessConversation, mirrorMessage } = require('../services/businessConversationSync');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('business conversation mirroring', () => {
  test('serializes legacy-link lookup and creation with a transaction advisory lock', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: '00000000-0000-4000-8000-000000000124' }] })
      .mockResolvedValueOnce({ rows: [{ id: '00000000-0000-4000-8000-000000000331' }] });

    const result = await ensureBusinessConversation({
      businessId: 7,
      legacyConversationId: '00000000-0000-4000-8000-000000000332',
      customerId: '00000000-0000-4000-8000-000000000123',
      customerEmail: 'customer@example.com',
      customerName: 'Test Customer',
    });

    expect(result).toBe('00000000-0000-4000-8000-000000000331');
    expect(mockQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO business_conversations/.test(sql))).toBe(true);
  });

  test('recovers an existing mirrored message without broadcasting twice', async () => {
    const messageId = '00000000-0000-4000-8000-000000000327';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: messageId }] });

    const result = await mirrorMessage({
      businessConversationId: '00000000-0000-4000-8000-000000000328',
      senderId: '00000000-0000-4000-8000-000000000123',
      senderType: 'customer',
      content: 'Can you help with my order?',
      legacyMessageId: '00000000-0000-4000-8000-000000000329',
      clientMessageId: '00000000-0000-4000-8000-000000000330',
    });

    expect(result).toBe(messageId);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(mockQuery.mock.calls[1][0]).toContain('legacy_message_id');
  });

  test('recovers an existing mirrored message by client id', async () => {
    const messageId = '00000000-0000-4000-8000-000000000327';
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: messageId }] });

    const result = await mirrorMessage({
      businessConversationId: '00000000-0000-4000-8000-000000000328',
      senderId: '00000000-0000-4000-8000-000000000123',
      senderType: 'customer',
      content: 'Can you help with my order?',
      legacyMessageId: '00000000-0000-4000-8000-000000000329',
      clientMessageId: '00000000-0000-4000-8000-000000000330',
    });

    expect(result).toBe(messageId);
    expect(mockQuery).toHaveBeenCalledTimes(4);
    expect(mockQuery.mock.calls[2][0]).toContain('ON CONFLICT (conversation_id, client_message_id)');
    expect(mockQuery.mock.calls[3][0]).toContain('SELECT id FROM business_messages');
  });
});
