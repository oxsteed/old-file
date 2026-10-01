/**
 * Regression tests for the Meta Model API chat provider
 * (server/services/aiChatProvider.js).
 *
 * Covers: configured detection, model default/override, request shape
 * (Bearer auth, /chat/completions, model passthrough), and failure modes
 * (not configured, HTTP error, empty content, timeout).
 */

const {
  isMetaConfigured,
  getMetaModel,
  fetchMetaChat,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
} = require('../services/aiChatProvider');

const REAL_FETCH = global.fetch;

function mockFetchOnce(impl) {
  global.fetch = jest.fn().mockImplementationOnce(impl);
}

afterEach(() => {
  global.fetch = REAL_FETCH;
  delete process.env.META_AI_API_KEY;
  delete process.env.META_AI_MODEL;
  delete process.env.META_AI_BASE_URL;
  jest.restoreAllMocks();
});

describe('isMetaConfigured', () => {
  test('false when META_AI_API_KEY is absent', () => {
    expect(isMetaConfigured()).toBe(false);
  });

  test('true when META_AI_API_KEY is set', () => {
    process.env.META_AI_API_KEY = 'LLM|test|secret';
    expect(isMetaConfigured()).toBe(true);
  });
});

describe('getMetaModel', () => {
  test('defaults to muse-spark-1.3', () => {
    expect(getMetaModel()).toBe('muse-spark-1.3');
    expect(DEFAULT_MODEL).toBe('muse-spark-1.3');
  });

  test('honors META_AI_MODEL override', () => {
    process.env.META_AI_MODEL = 'muse-spark-1.2';
    expect(getMetaModel()).toBe('muse-spark-1.2');
  });
});

describe('fetchMetaChat', () => {
  test('reports not-configured without calling fetch', async () => {
    const result = await fetchMetaChat('muse-spark-1.3', [{ role: 'user', content: 'hi' }]);
    expect(result).toEqual({ ok: false, error: 'META_AI_API_KEY not set' });
    expect(global.fetch).toBe(REAL_FETCH); // untouched
  });

  test('posts OpenAI-compatible body with Bearer auth', async () => {
    process.env.META_AI_API_KEY = 'LLM|app|secret';
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '  Hello there  ' } }] }),
    }));

    const messages = [{ role: 'user', content: 'hi' }];
    const result = await fetchMetaChat('muse-spark-1.3', messages, { temperature: 0.7, maxTokens: 500 });

    expect(result).toEqual({ ok: true, reply: 'Hello there' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BASE_URL}/chat/completions`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer LLM|app|secret');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.messages).toEqual(messages);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(500);
  });

  test('defaults max_tokens to the reasoning-safe budget', async () => {
    process.env.META_AI_API_KEY = 'LLM|app|secret';
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }));

    await fetchMetaChat('muse-spark-1.3', [{ role: 'user', content: 'hi' }]);
    const [, init] = global.fetch.mock.calls[0];
    expect(JSON.parse(init.body).max_tokens).toBe(2000);
  });

  test('honors META_AI_BASE_URL override', async () => {
    process.env.META_AI_API_KEY = 'LLM|app|secret';
    process.env.META_AI_BASE_URL = 'https://api.ai.meta.com/v1/';
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }));

    await fetchMetaChat('muse-spark-1.3', [{ role: 'user', content: 'hi' }]);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.ai.meta.com/v1/chat/completions');
  });

  test('HTTP error surfaces as ok:false without throwing', async () => {
    process.env.META_AI_API_KEY = 'LLM|app|secret';
    mockFetchOnce(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid key',
    }));

    const result = await fetchMetaChat('muse-spark-1.3', [{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 401/);
  });

  test('empty assistant content surfaces as ok:false', async () => {
    process.env.META_AI_API_KEY = 'LLM|app|secret';
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    }));

    const result = await fetchMetaChat('muse-spark-1.3', [{ role: 'user', content: 'hi' }]);
    expect(result).toEqual({ ok: false, error: 'empty assistant content' });
  });

  test('network failure surfaces as ok:false without throwing', async () => {
    process.env.META_AI_API_KEY = 'LLM|app|secret';
    mockFetchOnce(async () => { throw new Error('socket hang up'); });

    const result = await fetchMetaChat('muse-spark-1.3', [{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/socket hang up/);
  });
});
