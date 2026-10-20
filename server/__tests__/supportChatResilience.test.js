'use strict';

// Support chat improvement 12: provider timeout + per-user rate limits.

require('./setup');
const express = require('express');
const request = require('supertest');
const {
  supportChatLimiter,
  SUPPORT_CHAT_MAX_SIGNED_IN,
  SUPPORT_CHAT_MAX_GUEST,
} = require('../middleware/rateLimiter');
const chatController = require('../controllers/chatController');

function appWith(userFor) {
  const app = express();
  app.set('trust proxy', false);
  app.use((req, _res, next) => { const id = userFor(req); if (id) req.user = { id }; next(); });
  app.post('/message', supportChatLimiter, (_req, res) => res.json({ ok: true }));
  return app;
}

test('signed-in users get a larger budget than guests', () => {
  expect(SUPPORT_CHAT_MAX_SIGNED_IN).toBeGreaterThan(SUPPORT_CHAT_MAX_GUEST);
});

test('two signed-in users behind one IP are limited independently', async () => {
  const app = appWith((req) => req.headers['x-user']);
  for (let i = 0; i < SUPPORT_CHAT_MAX_SIGNED_IN; i += 1) {
    const r = await request(app).post('/message').set('x-user', 'rl-a');
    expect(r.status).toBe(200);
  }
  expect((await request(app).post('/message').set('x-user', 'rl-a')).status).toBe(429);
  expect((await request(app).post('/message').set('x-user', 'rl-b')).status).toBe(200);
});

test('guests hit 429 after the guest budget with a machine-readable code', async () => {
  const app = appWith(() => null);
  for (let i = 0; i < SUPPORT_CHAT_MAX_GUEST; i += 1) await request(app).post('/message');
  const r = await request(app).post('/message');
  expect(r.status).toBe(429);
  expect(r.body.code).toBe('rate_limited');
});

test('the support chat route limits after optionalAuth', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'chat.js'), 'utf8');
  expect(src).toMatch(/router\.post\('\/message', optionalAuth, supportChatLimiter, chatMessage\)/);
});

describe('provider timeout', () => {
  afterEach(() => { delete process.env.OPENROUTER_TIMEOUT_MS; delete global.fetch; });

  test('OpenRouter calls carry an AbortSignal timeout', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await chatController.chatMessage({ body: { messages: [{ role: 'user', content: 'hello' }] } }, res, jest.fn());
    const opts = global.fetch.mock.calls[0][1];
    expect(opts.signal).toBeDefined();
    expect(typeof opts.signal.aborted).toBe('boolean');
  });

  test('a timed-out provider returns a 502 instead of hanging', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const next = jest.fn();
    await chatController.chatMessage({ body: { messages: [{ role: 'user', content: 'hello' }] } }, { json: jest.fn() }, next);
    expect(next.mock.calls[0][0].status).toBe(502);
  });

  test('timeout is configurable and clamped', () => {
    expect(chatController._providerTimeoutMs()).toBe(25000);
    process.env.OPENROUTER_TIMEOUT_MS = '1000';
    expect(chatController._providerTimeoutMs()).toBe(5000);
    process.env.OPENROUTER_TIMEOUT_MS = '999999';
    expect(chatController._providerTimeoutMs()).toBe(60000);
    process.env.OPENROUTER_TIMEOUT_MS = '15000';
    expect(chatController._providerTimeoutMs()).toBe(15000);
  });
});
