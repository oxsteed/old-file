'use strict';

// AI support chat review bug #3: server-side support-chat memory must end
// with the session. Logout deletes the Redis thread, and the widget's
// "Clear conversation" can delete it via DELETE /api/chat/support-thread.
// The logout wiring is covered in supportChatLogout.test.js.

const { resetMocks } = require('./setup');

const mockRedisStore = new Map();
jest.mock('../utils/redis', () => ({
  get: jest.fn(async (k) => mockRedisStore.get(k) ?? null),
  set: jest.fn(async (k, v) => { mockRedisStore.set(k, v); return 'OK'; }),
  setex: jest.fn(async (k, _ttl, v) => { mockRedisStore.set(k, v); return 'OK'; }),
  del: jest.fn(async (k) => (mockRedisStore.delete(k) ? 1 : 0)),
  exists: jest.fn(async () => 0),
  on: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const supportChatThreads = require('../services/supportChatThreads');
const chatController = require('../controllers/chatController');

beforeEach(() => {
  resetMocks();
  mockRedisStore.clear();
});

test('clearSupportThread deletes only that user\'s thread', async () => {
  await supportChatThreads.appendSupportThread('u1', 'my payout?', 'Your latest payout is pending.');
  await supportChatThreads.appendSupportThread('u2', 'hi', 'hello');
  expect(await supportChatThreads.getSupportThread('u1')).toHaveLength(2);
  await supportChatThreads.clearSupportThread('u1');
  expect(await supportChatThreads.getSupportThread('u1')).toEqual([]);
  expect(await supportChatThreads.getSupportThread('u2')).toHaveLength(2);
});

test('DELETE /support-thread clears the caller\'s own memory', async () => {
  await supportChatThreads.appendSupportThread('u1', 'q', 'a');
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'u1', role: 'customer' }; next(); });
  app.delete('/support-thread', chatController.clearSupportThread);
  const res = await request(app).delete('/support-thread');
  expect(res.status).toBe(200);
  expect(await supportChatThreads.getSupportThread('u1')).toEqual([]);
});

test('chat routes expose an authenticated DELETE /support-thread', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'chat.js'), 'utf8');
  expect(src).toMatch(/router\.delete\('\/support-thread', chatLimiter, authenticate, clearSupportThread\)/);
});
