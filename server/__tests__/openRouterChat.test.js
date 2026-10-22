'use strict';
const openRouter = require('../services/openRouterChat');

const saved = {};
for (const k of ['OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_CHAT_MODEL', 'OPENROUTER_SUPPORT_MODEL', 'OPENROUTER_TIMEOUT_MS']) {
  saved[k] = process.env[k];
}
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] == null) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
  delete global.fetch;
});

test('isOpenRouterConfigured reflects OPENROUTER_API_KEY only', () => {
  delete process.env.OPENROUTER_API_KEY;
  expect(openRouter.isOpenRouterConfigured()).toBe(false);
  process.env.OPENROUTER_API_KEY = '   ';
  expect(openRouter.isOpenRouterConfigured()).toBe(false);
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  expect(openRouter.isOpenRouterConfigured()).toBe(true);
});

test('openRouterChatModel prefers OPENROUTER_CHAT_MODEL, then OPENROUTER_SUPPORT_MODEL, then the free router', () => {
  delete process.env.OPENROUTER_CHAT_MODEL;
  delete process.env.OPENROUTER_SUPPORT_MODEL;
  expect(openRouter.openRouterChatModel()).toBe('openrouter/free');
  process.env.OPENROUTER_SUPPORT_MODEL = 'support-model';
  expect(openRouter.openRouterChatModel()).toBe('support-model');
  process.env.OPENROUTER_CHAT_MODEL = 'chat-model';
  expect(openRouter.openRouterChatModel()).toBe('chat-model');
});

test('fetchOpenRouterChat fails closed without a key and never calls the network', async () => {
  delete process.env.OPENROUTER_API_KEY;
  global.fetch = jest.fn();
  const result = await openRouter.fetchOpenRouterChat('m', [{ role: 'user', content: 'hi' }]);
  expect(result).toEqual({ ok: false, error: 'OPENROUTER_API_KEY not set' });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('fetchOpenRouterChat posts to the OpenRouter chat completions endpoint with Bearer auth', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.OPENROUTER_BASE_URL = 'https://proxy.example/v1/';
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '  hello  ' } }] }),
  });
  const result = await openRouter.fetchOpenRouterChat(
    'some-model',
    [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    { temperature: 0, maxTokens: 700 },
  );
  expect(result).toEqual({ ok: true, reply: 'hello' });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe('https://proxy.example/v1/chat/completions');
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer sk-or-test');
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ model: 'some-model', temperature: 0, max_tokens: 700 });
  expect(body.messages).toHaveLength(2);
});

test('fetchOpenRouterChat maps upstream errors and empty content to {ok:false}', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 429,
    text: async () => 'rate limited',
  });
  expect((await openRouter.fetchOpenRouterChat('m', [])).ok).toBe(false);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '   ' } }] }),
  });
  expect((await openRouter.fetchOpenRouterChat('m', [])).ok).toBe(false);
  global.fetch = jest.fn().mockRejectedValue(new Error('boom'));
  expect((await openRouter.fetchOpenRouterChat('m', [])).ok).toBe(false);
});
