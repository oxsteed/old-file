'use strict';

// Regression test: the Ask AI buttons on the Learn page dispatch an event that
// only the AI support chat widget handles, and that widget is only mounted
// when the `aiSupport` capability is available. The capability must reflect
// every provider the chat fallback chain actually uses (Meta -> OpenRouter
// -> Ollama), not just the legacy OpenAI key. Otherwise the button silently
// does nothing on deploys that only set META_AI_API_KEY.

const { getPublicCapabilities } = require('../services/featureCapabilities');

const AI_KEYS = ['OPENAI_API_KEY', 'META_AI_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_URL'];

describe('aiSupport capability follows the chat provider chain', () => {
  let saved;

  beforeEach(() => {
    saved = {};
    for (const k of AI_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of AI_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('unavailable when no AI provider is configured', () => {
    const caps = getPublicCapabilities();
    expect(caps.aiSupport.available).toBe(false);
    expect(caps.aiSupport.status).toBe('unavailable');
  });

  test.each([
    ['OPENAI_API_KEY'],
    ['META_AI_API_KEY'],
    ['OPENROUTER_API_KEY'],
    ['OLLAMA_URL'],
  ])('available with only %s set', (key) => {
    process.env[key] = 'test-value';
    const caps = getPublicCapabilities();
    expect(caps.aiSupport.available).toBe(true);
    expect(caps.aiSupport.status).toBe('available');
  });

  test('ignores blank values', () => {
    process.env.META_AI_API_KEY = '   ';
    expect(getPublicCapabilities().aiSupport.available).toBe(false);
  });
});
