'use strict';

// Regression test: the Ask AI buttons on the Learn page dispatch an event that
// only the AI support chat widget handles, and that widget is only mounted
// when the `aiSupport` capability is available. The capability must reflect
// exactly the providers the chat fallback chain calls (OpenRouter -> Ollama).
// AI support chat review bug #6: OPENAI_API_KEY or META_AI_API_KEY alone used
// to turn the widget on even though every message then failed with a 502.

const { getPublicCapabilities } = require('../services/featureCapabilities');
const { resolveOllamaUrl } = require('../services/supportChatProviders');

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

  test('available with only OPENROUTER_API_KEY set', () => {
    process.env.OPENROUTER_API_KEY = 'test-value';
    const caps = getPublicCapabilities();
    expect(caps.aiSupport.available).toBe(true);
    expect(caps.aiSupport.status).toBe('available');
  });

  test.each([
    ['http://localhost:11434'],
    ['http://ollama-api:11434'],
    ['http://[::1]:11434'],
  ])('available with only an allowlisted OLLAMA_URL (%s)', (url) => {
    process.env.OLLAMA_URL = url;
    expect(getPublicCapabilities().aiSupport.available).toBe(true);
  });

  test.each([
    ['OPENAI_API_KEY'],
    ['META_AI_API_KEY'],
  ])('unavailable with only %s set (not in the chat chain)', (key) => {
    process.env[key] = 'test-value';
    expect(getPublicCapabilities().aiSupport.available).toBe(false);
  });

  test.each([
    ['http://evil.example.com:11434'],
    ['ftp://localhost:11434'],
    ['not a url'],
  ])('an OLLAMA_URL the chat would reject does not count (%s)', (url) => {
    process.env.OLLAMA_URL = url;
    expect(getPublicCapabilities().aiSupport.available).toBe(false);
  });

  test('ignores blank values', () => {
    process.env.OPENROUTER_API_KEY = '   ';
    process.env.OLLAMA_URL = '  ';
    expect(getPublicCapabilities().aiSupport.available).toBe(false);
  });
});

test('the chat controller and capability share one Ollama validator', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'controllers', 'chatController.js'), 'utf8');
  expect(src).toMatch(/resolveOllamaUrl\(process\.env\.OLLAMA_URL, logger\)/);
  expect(src).not.toMatch(/allowMeta/);
  expect(resolveOllamaUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
});

test('no stale Meta provider comments remain on the chat route', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'chat.js'), 'utf8');
  expect(src).not.toMatch(/Meta-first|skip Meta/);
});
