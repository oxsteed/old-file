'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatQuotes', () => ({
  QUOTE_KINDS: new Set(['business', 'helper']),
  RESPOND_ACTIONS: new Set(['accept', 'decline', 'request_changes']),
  toDbAcceptStatus: jest.fn(() => 'approved'),
  canRespond: jest.fn(() => ({ ok: true })),
  isQuoteExpired: jest.fn(),
  buildQuoteMarker: jest.fn(),
  buildShareMessageContent: jest.fn(),
  buildRequestChangesMessage: jest.fn(),
  newQuoteToken: jest.fn(),
  normalizeLineItems: jest.fn(),
  calculateTotals: jest.fn(),
  toPublicQuoteCard: jest.fn((kind, row) => ({ ...row, kind })),
  toChatStatus: jest.fn((_kind, status) => status),
}));

jest.mock('../controllers/chatBookingRequestsController', () => ({
  buildBookingRequestMarker: jest.fn(),
}));

const socketService = require('../services/socketService');
const controller = require('../controllers/chatQuotesController');

const REQUEST_ID = '77777777-7777-4777-8777-777777777777';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.post('/api/chat/quotes/:kind/:id/respond', controller.respondQuote);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('replays quote acceptance and repairs the durable status message', async () => {
  const quote = {
    id: 'quote-1',
    status: 'sent',
    title: 'Ceiling fan installation',
    business_id: 'business-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    response_client_request_id: null,
    response_action: null,
  };
  const updated = {
    ...quote,
    status: 'approved',
    response_client_request_id: REQUEST_ID,
    response_action: 'accept',
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    client_message_id: REQUEST_ID,
    content: '[quote_status:business|quote-1|accepted]',
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [quote] }) // first quote load
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1' }] }) // participant
    .mockResolvedValueOnce({ rows: [updated] }) // response transition
    .mockResolvedValueOnce({ rows: [message] }) // timeline message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [updated] }) // retry quote load
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1' }] }) // retry participant
    .mockResolvedValueOnce({ rows: [] }) // retry timeline conflict
    .mockResolvedValueOnce({ rows: [message] }); // original timeline message

  const app = buildApp();
  const body = { action: 'accept', clientRequestId: REQUEST_ID };
  const first = await request(app).post('/api/chat/quotes/business/quote-1/respond').send(body);
  const retry = await request(app).post('/api/chat/quotes/business/quote-1/respond').send(body);

  expect(first.status).toBe(200);
  expect(first.body.idempotent).toBe(false);
  expect(retry.status).toBe(200);
  expect(retry.body).toEqual(expect.objectContaining({ idempotent: true, action: 'accept' }));
  expect(mockQuery.mock.calls.filter(([sql]) => /UPDATE business_quotes/.test(sql))).toHaveLength(1);
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql))).toHaveLength(2);
  expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(4);
});

test('rejects malformed quote response retry keys before database access', async () => {
  const response = await request(buildApp())
    .post('/api/chat/quotes/business/quote-1/respond')
    .send({ action: 'accept', clientRequestId: 'retry-1' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});
