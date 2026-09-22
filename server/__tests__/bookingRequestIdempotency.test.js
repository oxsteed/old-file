'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatThreadAccess', () => ({
  assertConversationParticipant: jest.fn().mockResolvedValue({
    id: 'conversation-1',
    customer_id: 'customer-1',
    helper_id: 'helper-1',
    business_id: null,
  }),
  assertBusinessAccess: jest.fn(),
  resolveGuestFromRequest: jest.fn(),
}));

jest.mock('../services/chatAgreements', () => ({
  checkScheduleAgreementGate: jest.fn().mockResolvedValue({ blocked: false, agreements: [] }),
}));

jest.mock('../services/bookingRequestLifecycle', () => ({
  emitBookingEvent: jest.fn().mockResolvedValue(undefined),
  isProviderForBooking: jest.fn().mockResolvedValue(false),
}));

jest.mock('../services/chatBookingRequests', () => ({
  buildBookingRequestMarker: jest.fn(({ id, status }) => `[booking:${id}|${status}]`),
  parseBookingRequestMarker: jest.fn(),
  toPublicBookingRequestCard: jest.fn((row) => row),
  canProviderRespond: jest.fn(),
  canCustomerRespond: jest.fn(),
  buildStatusMessage: jest.fn(({ booking, event }) => `${event}:${booking.id}`),
  normalizeClock: jest.fn((value) => String(value || '')),
  normalizeDate: jest.fn((value) => String(value || '')),
  toChatStatus: jest.fn(),
}));

const socketService = require('../services/socketService');
const lifecycle = require('../services/bookingRequestLifecycle');
const controller = require('../controllers/chatBookingRequestsController');

const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'customer-1', first_name: 'Customer', last_name: 'One' };
    next();
  });
  app.post('/api/chat/booking-requests', controller.createChatBookingRequest);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  socketService.broadcastToUser = jest.fn();
});

test('replays a schedule request without creating a second booking or timeline message', async () => {
  const booking = {
    id: 'booking-1',
    customer_id: 'customer-1',
    helper_id: 'helper-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    service_name: 'Ceiling fan installation',
    service_id: 'fan-install',
    requested_date: '2026-09-24',
    requested_start_time: '10:00:00',
    requested_end_time: '11:00:00',
    status: 'pending',
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    client_message_id: REQUEST_ID,
    content: 'requested:booking-1',
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // first request key lookup
    .mockResolvedValueOnce({ rows: [booking] }) // booking insert
    .mockResolvedValueOnce({ rows: [message] }) // timeline message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [booking] }) // retry key lookup
    .mockResolvedValueOnce({ rows: [] }) // timeline message conflict
    .mockResolvedValueOnce({ rows: [message] }); // original timeline message

  const app = buildApp();
  const body = {
    conversationId: 'conversation-1',
    helperId: 'helper-1',
    serviceName: 'Ceiling fan installation',
    serviceId: 'fan-install',
    requestedDate: '2026-09-24',
    requestedStartTime: '10:00',
    requestedEndTime: '11:00',
  };
  const first = await request(app).post('/api/chat/booking-requests').send({ ...body, clientRequestId: REQUEST_ID });
  const retry = await request(app).post('/api/chat/booking-requests').send({ ...body, clientRequestId: REQUEST_ID });

  expect(first.status).toBe(201);
  expect(first.body.idempotent).toBe(false);
  expect(retry.status).toBe(200);
  expect(retry.body).toEqual(expect.objectContaining({ idempotent: true, booking }));
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO booking_requests/.test(sql))).toHaveLength(1);
  expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(2);
  expect(socketService.broadcastToUser).toHaveBeenCalledTimes(1);
  expect(socketService.broadcastToUser).toHaveBeenCalledWith('helper-1', 'booking:requested', { booking });
  expect(lifecycle.emitBookingEvent).toHaveBeenCalledTimes(1);
});

test('rejects malformed booking retry keys before database access', async () => {
  const response = await request(buildApp())
    .post('/api/chat/booking-requests')
    .send({ conversationId: 'conversation-1', clientRequestId: 'retry-1' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});
