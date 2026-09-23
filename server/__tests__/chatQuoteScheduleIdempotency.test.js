'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatQuotes', () => ({
  QUOTE_KINDS: new Set(['business', 'helper']),
  RESPOND_ACTIONS: new Set(['accept', 'decline', 'request_changes']),
  toDbAcceptStatus: jest.fn(() => 'accepted'),
  canRespond: jest.fn(),
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

jest.mock('../services/chatAgreements', () => ({
  checkScheduleAgreementGate: jest.fn().mockResolvedValue({ blocked: false, agreements: [] }),
}));

jest.mock('../controllers/chatBookingRequestsController', () => ({
  buildBookingRequestMarker: jest.fn(({ id, status }) => `[booking:${id}|${status}]`),
}));

jest.mock('../services/businessConversationSync', () => ({
  mirrorLegacyMessage: jest.fn().mockResolvedValue(null),
}));

const socketService = require('../services/socketService');
const controller = require('../controllers/chatQuotesController');

const REQUEST_ID = '66666666-6666-4666-8666-666666666666';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.post('/api/chat/quotes/:kind/:id/schedule', controller.scheduleFromQuote);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('replays quote scheduling without creating a second booking or timeline message', async () => {
  const quote = {
    id: 'quote-1',
    status: 'accepted',
    title: 'Ceiling fan installation',
    business_id: 'business-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    booking_request_id: null,
    appointment_id: null,
  };
  const linkedQuote = { ...quote, booking_request_id: 'booking-1' };
  const booking = {
    id: 'booking-1',
    customer_id: 'customer-1',
    helper_id: 'helper-1',
    business_id: 'business-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    quote_kind: 'business',
    quote_id: 'quote-1',
    client_request_id: REQUEST_ID,
    service_name: 'Ceiling fan installation',
    requested_date: '2026-09-24',
    requested_start_time: '10:00:00',
    requested_end_time: '11:00:00',
    status: 'pending',
    appointment_id: null,
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    client_message_id: REQUEST_ID,
    content: '[quote_status:business|quote-1|scheduled]',
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [quote] }) // first quote load
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1' }] }) // participant
    .mockResolvedValueOnce({ rows: [] }) // request-key lookup
    .mockResolvedValueOnce({ rows: [booking] }) // booking insert
    .mockResolvedValueOnce({ rows: [] }) // quote linkage
    .mockResolvedValueOnce({ rows: [message] }) // timeline message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [linkedQuote] }) // retry quote load
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1' }] }) // retry participant
    .mockResolvedValueOnce({ rows: [booking] }) // linked booking load
    .mockResolvedValueOnce({ rows: [] }) // retry timeline conflict
    .mockResolvedValueOnce({ rows: [message] }); // original timeline message

  const app = buildApp();
  const body = {
    token: 'quote-token',
    helperId: 'helper-1',
    requestedDate: '2026-09-24',
    requestedStartTime: '10:00',
    requestedEndTime: '11:00',
    clientRequestId: REQUEST_ID,
  };
  const first = await request(app).post('/api/chat/quotes/business/quote-1/schedule').send(body);
  const retry = await request(app).post('/api/chat/quotes/business/quote-1/schedule').send(body);

  expect(first.status).toBe(201);
  expect(first.body.idempotent).toBe(false);
  expect(retry.status).toBe(200);
  expect(retry.body).toEqual(expect.objectContaining({ idempotent: true, bookingId: 'booking-1' }));
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO booking_requests/.test(sql))).toHaveLength(1);
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql))).toHaveLength(2);
  expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(4);
});

test('rejects malformed quote schedule retry keys before database access', async () => {
  const response = await request(buildApp())
    .post('/api/chat/quotes/business/quote-1/schedule')
    .send({ clientRequestId: 'retry-1' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});
