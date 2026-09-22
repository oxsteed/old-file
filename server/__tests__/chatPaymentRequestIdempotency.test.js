'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatThreadAccess', () => ({
  assertConversationParticipant: jest.fn().mockResolvedValue({
    id: 'conversation-1',
    customer_id: 'customer-1',
    helper_id: 'provider-1',
    business_id: null,
  }),
  assertGuestInquiryAccess: jest.fn(),
  assertBusinessAccess: jest.fn(),
  isProviderOnConversation: jest.fn().mockReturnValue(true),
  isCustomerOnConversation: jest.fn().mockReturnValue(false),
}));

jest.mock('../services/oxsteedCreditService', () => ({}));

jest.mock('../services/chatOxsteedCreditPayment', () => ({
  normalizePaymentRequestPayload: jest.fn((body) => ({
    conversationId: body.conversationId,
    guestSessionId: null,
    amountCents: body.amountCents,
    currency: body.currency || 'USD',
    memo: body.memo || null,
    quoteKind: null,
    quoteId: null,
    preface: null,
    idempotencyKey: body.idempotencyKey || null,
  })),
  buildPaymentRequestMarker: jest.fn(({ id }) => `[payment_req:${id}]`),
  buildPaymentRequestShareContent: jest.fn(({ marker }) => `Payment request\n${marker}`),
  toPublicPaymentRequestCard: jest.fn((row) => row),
}));

const socketService = require('../services/socketService');
const controller = require('../controllers/chatOxsteedCreditPaymentController');

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'provider-1', first_name: 'Provider', last_name: 'One' };
    next();
  });
  app.post('/api/chat/payments/request', controller.requestPayment);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('repairs a payment-request message on replay without creating another card', async () => {
  const payReq = {
    id: 'payment-request-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    business_id: null,
    helper_id: 'provider-1',
    amount_cents: 2900,
    currency: 'USD',
    memo: 'Fan installation',
    status: 'open',
    requested_by: 'provider-1',
    idempotency_key: REQUEST_ID,
    message_id: null,
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    content: 'Payment request\n[payment_req:payment-request-1]',
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // first request-key lookup
    .mockResolvedValueOnce({ rows: [payReq] }) // payment-request insert
    .mockResolvedValueOnce({ rows: [message] }) // message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [] }) // payment-request message link
    .mockResolvedValueOnce({ rows: [payReq] }) // retry sees committed card without message
    .mockResolvedValueOnce({ rows: [] }) // message conflict
    .mockResolvedValueOnce({ rows: [message] }) // original message
    .mockResolvedValueOnce({ rows: [] }); // repaired payment-request message link

  const app = buildApp();
  const body = {
    conversationId: 'conversation-1',
    amountCents: 2900,
    currency: 'USD',
    memo: 'Fan installation',
    idempotencyKey: REQUEST_ID,
  };
  const first = await request(app).post('/api/chat/payments/request').send(body);
  const retry = await request(app).post('/api/chat/payments/request').send(body);

  expect(first.status).toBe(201);
  expect(first.body.replayed).toBe(false);
  expect(retry.status).toBe(200);
  expect(retry.body.replayed).toBe(true);
  expect(retry.body.message).toEqual(expect.objectContaining(message));
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO chat_payment_requests/.test(sql))).toHaveLength(1);
  expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(2);
});

