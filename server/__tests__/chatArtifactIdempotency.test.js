'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatThreadAccess', () => ({
  assertConversationParticipant: jest.fn().mockResolvedValue({
    id: 'conversation-1',
    helper_id: 'provider-1',
    business_id: null,
  }),
  assertGuestInquiryAccess: jest.fn(),
  assertBusinessAccess: jest.fn(),
  resolveGuestFromRequest: jest.fn(),
  isProviderOnConversation: jest.fn().mockReturnValue(true),
  isCustomerOnConversation: jest.fn().mockReturnValue(false),
}));

jest.mock('../services/chatAgreements', () => ({
  RESPOND_ACTIONS: new Set(['acknowledge', 'accept', 'decline']),
  ALLOWED_AGREEMENT_MIMES: new Set(),
  newAgreementToken: jest.fn().mockReturnValue('agreement-token'),
  buildAgreementMarker: jest.fn(({ id, title }) => `[agreement:${id}|${title}]`),
  buildAgreementShareContent: jest.fn(({ marker, title }) => `${title}\n${marker}`),
  canRespondToAgreement: jest.fn(),
  normalizeAgreementPayload: jest.fn((body) => ({
    title: body.title,
    bodyText: body.body_text || null,
    requiredBeforeSchedule: body.required_before_schedule === 'true',
  })),
  toPublicAgreementCard: jest.fn((row) => row),
  redactAgreementForLog: jest.fn((row) => ({ id: row.id })),
  scheduleBlockedByAgreements: jest.fn(),
}));

jest.mock('../services/chatProofOfPayment', () => ({
  CONFIRM_ACTIONS: new Set(['confirm', 'reject']),
  ALLOWED_POP_MIMES: new Set(),
  buildPopMarker: jest.fn(({ id, status }) => `[pop:${id}|${status}]`),
  buildPopShareContent: jest.fn(({ marker }) => marker),
  normalizePopPayload: jest.fn(() => ({
    quoteKind: null,
    quoteId: null,
    bookingRequestId: null,
    amountCents: 2900,
    currency: 'USD',
    paymentMethod: 'cash',
    transactionId: null,
    paidOn: null,
    notes: null,
  })),
  toPublicPopCard: jest.fn((row) => row),
  redactPopForLog: jest.fn((row) => ({ id: row.id })),
}));

jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
}));

const socketService = require('../services/socketService');
const chatAgreements = require('../controllers/chatAgreementsController');
const chatPop = require('../controllers/chatProofOfPaymentController');
const { resolveGuestFromRequest } = require('../services/chatThreadAccess');

const USER_ID = '00000000-0000-4000-8000-000000000101';
const AGREEMENT_KEY = '11111111-1111-4111-8111-111111111111';
const POP_KEY = '22222222-2222-4222-8222-222222222222';

function buildAgreementApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, first_name: 'Provider', last_name: 'One' };
    next();
  });
  app.post('/api/chat/agreements/share', chatAgreements.shareAgreement);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

function buildGuestPopApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/chat/pop/share', chatPop.sharePop);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  resolveGuestFromRequest.mockResolvedValue({
    id: '33333333-3333-4333-8333-333333333333',
    guest_name: 'Guest One',
    helper_id: USER_ID,
    business_id: null,
  });
});

test('agreement share replay returns the original artifact and emits once', async () => {
  const agreement = {
    id: 'agreement-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    helper_id: 'provider-1',
    title: 'Service terms',
    body_text: 'Terms',
    token: 'agreement-token',
    status: 'shared',
    version: 1,
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    client_message_id: AGREEMENT_KEY,
    content: 'Service terms\n[agreement:agreement-1|Service terms]',
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // first request key lookup
    .mockResolvedValueOnce({ rows: [agreement] }) // agreement insert
    .mockResolvedValueOnce({ rows: [message] }) // message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [] }) // agreement message link
    .mockResolvedValueOnce({ rows: [] }) // message notification outbox
    .mockResolvedValueOnce({ rows: [agreement] }) // retry key lookup
    .mockResolvedValueOnce({ rows: [] }) // message conflict
    .mockResolvedValueOnce({ rows: [message] }) // original message
    .mockResolvedValueOnce({ rows: [] }); // agreement message link

  const app = buildAgreementApp();
  const body = { conversationId: 'conversation-1', title: 'Service terms', body_text: 'Terms' };
  const first = await request(app).post('/api/chat/agreements/share').set('Idempotency-Key', AGREEMENT_KEY).send(body);
  const retry = await request(app).post('/api/chat/agreements/share').set('Idempotency-Key', AGREEMENT_KEY).send(body);

  expect(first.status).toBe(201);
  expect(first.body.idempotent).toBe(false);
  expect(retry.status).toBe(200);
  expect(retry.body).toEqual(expect.objectContaining({
    idempotent: true,
    message: expect.objectContaining(message),
  }));
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO chat_agreements/.test(sql))).toHaveLength(1);
  expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls.some(([sql]) => /ON CONFLICT \(conversation_id, client_message_id\)/.test(sql))).toBe(true);
});

test('guest proof-of-payment share replay does not duplicate the guest message', async () => {
  const guestSessionId = '33333333-3333-4333-8333-333333333333';
  const pop = {
    id: 'pop-1',
    guest_session_id: guestSessionId,
    conversation_id: null,
    helper_id: USER_ID,
    submitted_by: null,
    submitted_by_guest: true,
    amount_cents: 2900,
    currency: 'USD',
    payment_method: 'cash',
    status: 'submitted',
  };
  const message = {
    id: 41,
    session_id: guestSessionId,
    sender_type: 'guest',
    sender_name: 'Guest One',
    message: '[pop:pop-1|submitted]',
    created_at: '2026-09-22T12:00:00.000Z',
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // first request key lookup
    .mockResolvedValueOnce({ rows: [pop] }) // POP insert
    .mockResolvedValueOnce({ rows: [message] }) // guest message insert
    .mockResolvedValueOnce({ rows: [] }) // POP message link
    .mockResolvedValueOnce({ rows: [pop] }) // retry key lookup
    .mockResolvedValueOnce({ rows: [] }) // guest message conflict
    .mockResolvedValueOnce({ rows: [message] }) // original guest message
    .mockResolvedValueOnce({ rows: [] }); // POP message link

  const app = buildGuestPopApp();
  const body = { guestSessionId, amount: '29.00', payment_method: 'cash' };
  const first = await request(app).post('/api/chat/pop/share').set('Idempotency-Key', POP_KEY).send(body);
  const retry = await request(app).post('/api/chat/pop/share').set('Idempotency-Key', POP_KEY).send(body);

  expect(first.status).toBe(201);
  expect(retry.status).toBe(200);
  expect(retry.body).toEqual(expect.objectContaining({
    idempotent: true,
    message: expect.objectContaining(message),
  }));
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO chat_proof_of_payments/.test(sql))).toHaveLength(1);
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO guest_profile_chat_messages/.test(sql))).toHaveLength(2);
});

test('artifact shares reject malformed retry keys before touching the database', async () => {
  const response = await request(buildAgreementApp())
    .post('/api/chat/agreements/share')
    .set('Idempotency-Key', 'retry-1')
    .send({ conversationId: 'conversation-1', title: 'Terms' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('validation_failed');
  expect(mockQuery).not.toHaveBeenCalled();
});
