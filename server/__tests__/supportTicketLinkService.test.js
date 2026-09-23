'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');

const client = { query: mockQuery };
const clientRequestId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  resetMocks();
});

describe('linked support ticket idempotency', () => {
  test('stores the request key on the ticket and initial message', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'ticket-1', ticket_number: 'SUP-100', status: 'open', priority: 'normal' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1' }], rowCount: 1 });

    const ticket = await createLinkedSupportTicket(client, {
      userId: 'user-1',
      name: 'Emile',
      email: 'emile@example.com',
      subject: 'Device issue',
      initialMessage: 'The display is offline.',
      clientRequestId,
    });

    expect(ticket.replayed).toBe(false);
    expect(ticket.messageId).toBe('message-1');
    expect(mockQuery.mock.calls[0][0]).toMatch(/client_request_id/);
    expect(mockQuery.mock.calls[0][1]).toContain(clientRequestId);
    expect(mockQuery.mock.calls[1][0]).toMatch(/client_message_id/);
    expect(mockQuery.mock.calls[1][1]).toContain(clientRequestId);
  });

  test('recovers an existing ticket without duplicating its initial message', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ id: 'ticket-1', ticket_number: 'SUP-100', status: 'open', priority: 'normal' }],
        rowCount: 1,
      });

    const ticket = await createLinkedSupportTicket(client, {
      userId: 'user-1',
      name: 'Emile',
      email: 'emile@example.com',
      subject: 'Device issue',
      initialMessage: 'The display is offline.',
      clientRequestId,
    });

    expect(ticket).toMatchObject({ id: 'ticket-1', replayed: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_messages/.test(sql))).toBe(false);
  });
});
