'use strict';

// AI support chat review bug #5: the chat handoff must reach staff like the
// support form does, store the user's language, be idempotent across
// reloads, and return the ticket number for the chat.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/supportNotificationService', () => ({
  scheduleSupportMessageNotifications: jest.fn(),
}));
jest.mock('../controllers/customer360Controller', () => ({
  notifyWatchers: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/socketService', () => ({
  broadcastToAdmins: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { sendEmail } = require('../utils/email');
const { scheduleSupportMessageNotifications } = require('../services/supportNotificationService');
const socketService = require('../services/socketService');
const supportController = require('../controllers/supportController');
const { errorHandler } = require('../middleware/errorHandler');

const USER_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_USER = '00000000-0000-4000-8000-0000000000c2';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function buildApp(userId = USER_ID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, role: 'customer' }; next(); });
  app.post('/chat-escalation', supportController.createChatEscalation);
  app.use(errorHandler);
  return app;
}

function routeQueries({ replayRow = null, insertTicket = true } = {}) {
  const calls = [];
  mockQuery.mockImplementation(async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (/SELECT first_name, last_name, email FROM users/.test(sql)) {
      return { rows: [{ first_name: 'Ana', last_name: 'Ruiz', email: 'Ana@Example.com' }] };
    }
    if (/INSERT INTO support_tickets/.test(sql)) {
      return insertTicket
        ? { rows: [{ id: 't-1', ticket_number: 'OX-1042', subject: params[3], priority: 'high', name: params[1], created_at: 'now' }] }
        : { rows: [] };
    }
    if (/SELECT id, ticket_number, user_id FROM support_tickets/.test(sql)) {
      return { rows: replayRow ? [replayRow] : [] };
    }
    if (/INSERT INTO support_messages/.test(sql)) return { rows: [{ id: 'm-1' }] };
    if (/FROM users WHERE role IN/.test(sql)) return { rows: [{ email: 'admin@example.com', first_name: 'Ad' }] };
    return { rows: [] };
  });
  return calls;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

const body = {
  subject: 'Chat escalation from /wallet',
  transcript: [{ role: 'user', content: 'Where is my payout?' }, { role: 'assistant', content: 'Check /wallet.' }],
  page: '/wallet',
  clientRequestId: REQUEST_ID,
  sender_language: 'ht',
};

test('creates the ticket, notifies staff, emails the user and returns the ticket number', async () => {
  const calls = routeQueries();
  const res = await request(buildApp()).post('/chat-escalation').send(body);
  expect(res.status).toBe(201);
  expect(res.body.ticket_number).toBe('OX-1042');

  const ticketInsert = calls.find((c) => /INSERT INTO support_tickets/.test(c.sql));
  expect(ticketInsert.sql).toMatch(/ON CONFLICT \(client_request_id\)/);
  expect(ticketInsert.params).toContain(REQUEST_ID);
  const messageInsert = calls.find((c) => /INSERT INTO support_messages/.test(c.sql));
  expect(messageInsert.params[5]).toBe('ht');

  expect(scheduleSupportMessageNotifications).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 't-1', messageId: 'm-1' }));
  expect(socketService.broadcastToAdmins).toHaveBeenCalledWith('support:new_ticket', expect.objectContaining({ ticket_number: 'OX-1042' }));
  await new Promise((r) => setImmediate(r));
  const recipients = sendEmail.mock.calls.map(([arg]) => arg.to);
  expect(recipients).toContain('ana@example.com');
  expect(recipients).toContain('admin@example.com');
});

test('unsupported languages fall back to English', async () => {
  const calls = routeQueries();
  await request(buildApp()).post('/chat-escalation').send({ ...body, sender_language: 'xx' });
  expect(calls.find((c) => /INSERT INTO support_messages/.test(c.sql)).params[5]).toBe('en');
});

test('a repeated handoff with the same clientRequestId returns the existing ticket without notifying again', async () => {
  routeQueries({ insertTicket: false, replayRow: { id: 't-1', ticket_number: 'OX-1042', user_id: USER_ID } });
  const res = await request(buildApp()).post('/chat-escalation').send(body);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ticket_number: 'OX-1042', replayed: true });
  expect(scheduleSupportMessageNotifications).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

test('a replayed id owned by another user never reveals that ticket', async () => {
  routeQueries({ insertTicket: false, replayRow: { id: 't-9', ticket_number: 'OX-9', user_id: OTHER_USER } });
  const res = await request(buildApp()).post('/chat-escalation').send(body);
  expect(res.status).toBe(409);
  expect(JSON.stringify(res.body)).not.toContain('OX-9');
});

test('a malformed clientRequestId is rejected', async () => {
  routeQueries();
  const res = await request(buildApp()).post('/chat-escalation').send({ ...body, clientRequestId: 'nope' });
  expect(res.status).toBe(400);
});
