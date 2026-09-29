'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatQuotes', () => ({
  QUOTE_KINDS: new Set(['business', 'helper']),
  RESPOND_ACTIONS: new Set(),
  normalizeLineItems: jest.fn(() => ({ items: [{ description: 'Fan install', quantity: 1, unit_price: 2900 }] })),
  calculateTotals: jest.fn(() => ({ subtotal: 2900, tax: 0, total: 2900 })),
  newQuoteToken: jest.fn(() => 'quote-token'),
  toPublicQuoteCard: jest.fn((kind, row) => ({ ...row, kind })),
  buildQuoteMarker: jest.fn(({ id }) => `[quote:${id}]`),
  buildShareMessageContent: jest.fn(({ marker }) => `Quote\n${marker}`),
  toChatStatus: jest.fn(() => 'sent'),
  canRespond: jest.fn(),
  isQuoteExpired: jest.fn(),
  toDbAcceptStatus: jest.fn(),
  buildRequestChangesMessage: jest.fn(),
}));

jest.mock('../services/chatAgreements', () => ({
  checkScheduleAgreementGate: jest.fn(),
}));

const socketService = require('../services/socketService');
const controller = require('../controllers/chatQuotesController');

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'provider-1', first_name: 'Provider', last_name: 'One' };
    next();
  });
  app.post('/api/chat/quotes/share', controller.shareQuote);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('replays a quick-built quote without creating another quote or message', async () => {
  const quote = {
    id: 'quote-1',
    helper_id: 'provider-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    title: 'Service quote',
    total_cents: 2900,
    status: 'sent',
    token: 'quote-token',
    version: 1,
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    client_message_id: REQUEST_ID,
    content: 'Quote\n[quote:quote-1]',
  };
  const share = {
    id: 'share-1',
    quote_kind: 'helper',
    quote_id: 'quote-1',
    message_id: 'message-1',
    shared_by: 'provider-1',
    client_request_id: REQUEST_ID,
  };

  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1', helper_id: 'provider-1', business_id: null, job_id: null }] }) // first participant check
    .mockResolvedValueOnce({ rows: [] }) // first share-key lookup
    .mockResolvedValueOnce({ rows: [] }) // quote-key lookup
    .mockResolvedValueOnce({ rows: [quote] }) // quote insert
    .mockResolvedValueOnce({ rows: [quote] }) // quote linkage update
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1', helper_id: 'provider-1', business_id: null, job_id: null }] }) // message participant check
    .mockResolvedValueOnce({ rows: [message] }) // message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [share] }) // share audit insert
    .mockResolvedValueOnce({ rows: [] }) // message notification outbox
    .mockResolvedValueOnce({ rows: [{ id: 'conversation-1', customer_id: 'customer-1', helper_id: 'provider-1', business_id: null, job_id: null }] }) // retry participant check
    .mockResolvedValueOnce({ rows: [share] }) // retry share-key lookup
    .mockResolvedValueOnce({ rows: [quote] }); // retry quote load

  const app = buildApp();
  const body = {
    kind: 'helper',
    conversationId: 'conversation-1',
    helperId: 'provider-1',
    line_items: [{ description: 'Fan install', quantity: 1, unit_price: 29 }],
    clientRequestId: REQUEST_ID,
  };
  const first = await request(app).post('/api/chat/quotes/share').send(body);
  const retry = await request(app).post('/api/chat/quotes/share').send(body);


  expect(first.status).toBe(201);
  expect(first.body.idempotent).toBe(false);
  expect(retry.status).toBe(200);
  expect(retry.body.idempotent).toBe(true);
  expect(retry.body.quote).toEqual(expect.objectContaining({ id: 'quote-1' }));
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO helper_quotes/.test(sql))).toHaveLength(1);
  expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO messages/.test(sql))).toHaveLength(1);
  expect(socketService.broadcastToConversation).toHaveBeenCalledTimes(2);
});

test('rejects malformed quote retry keys before database access', async () => {
  const response = await request(buildApp())
    .post('/api/chat/quotes/share')
    .send({ kind: 'helper', conversationId: 'conversation-1', clientRequestId: 'retry-1' });

  expect(response.status).toBe(400);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('share audit ON CONFLICT predicate matches migration 547 partial index predicate', async () => {
  const fs = require('fs');
  const path = require('path');

  const quote = {
    id: 'quote-1',
    helper_id: 'provider-1',
    conversation_id: 'conversation-1',
    guest_session_id: null,
    title: 'Service quote',
    total_cents: 2900,
    status: 'sent',
    token: 'quote-token',
    version: 1,
  };
  const message = {
    id: 'message-1',
    conversation_id: 'conversation-1',
    client_message_id: REQUEST_ID,
    content: 'Quote\n[quote:quote-1]',
  };
  const share = {
    id: 'share-1',
    quote_kind: 'helper',
    quote_id: 'quote-1',
    message_id: 'message-1',
    shared_by: 'provider-1',
    client_request_id: REQUEST_ID,
  };
  const conversation = { id: 'conversation-1', customer_id: 'customer-1', helper_id: 'provider-1', business_id: null, job_id: null };

  mockQuery
    .mockResolvedValueOnce({ rows: [conversation] }) // participant check
    .mockResolvedValueOnce({ rows: [] }) // share-key lookup
    .mockResolvedValueOnce({ rows: [] }) // quote-key lookup
    .mockResolvedValueOnce({ rows: [quote] }) // quote insert
    .mockResolvedValueOnce({ rows: [quote] }) // quote linkage update
    .mockResolvedValueOnce({ rows: [conversation] }) // message participant check
    .mockResolvedValueOnce({ rows: [message] }) // message insert
    .mockResolvedValueOnce({ rows: [] }) // conversation timestamp
    .mockResolvedValueOnce({ rows: [share] }) // share audit insert
    .mockResolvedValueOnce({ rows: [] }); // message notification outbox

  const response = await request(buildApp())
    .post('/api/chat/quotes/share')
    .send({
      kind: 'helper',
      conversationId: 'conversation-1',
      helperId: 'provider-1',
      line_items: [{ description: 'Fan install', quantity: 1, unit_price: 29 }],
      clientRequestId: REQUEST_ID,
    });

  expect(response.status).toBe(201);

  const shareInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO chat_quote_shares/.test(sql));
  expect(shareInsert).toBeDefined();
  const [insertSql] = shareInsert;
  const arbiter = insertSql.match(/ON CONFLICT\s*\(([^)]+)\)\s*WHERE\s*([\s\S]*?)\s*DO NOTHING/i);
  expect(arbiter).not.toBeNull();

  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '547_chat_quote_share_idempotency.sql'),
    'utf8'
  );
  const indexDef = migrationSql.match(
    /CREATE UNIQUE INDEX[^;]*?idx_chat_quote_shares_client_request[^;]*?ON\s+chat_quote_shares\s*\(([^)]+)\)\s*WHERE\s*([^;]+);/i
  );
  expect(indexDef).not.toBeNull();

  const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  expect(normalize(arbiter[1])).toBe(normalize(indexDef[1]));
  expect(normalize(arbiter[2])).toBe(normalize(indexDef[2]));
});
