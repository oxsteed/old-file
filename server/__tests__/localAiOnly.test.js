'use strict';

/**
 * Security review 2026-11-10 F-04: user conversations, documents, images and
 * voice must never reach a third-party AI service. The self-hosted Ollama
 * server is the only provider and there is no switch to add another.
 */

const fs = require('fs');
const path = require('path');
const localAi = require('../services/localAiChat');

const SERVER = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '__tests__', 'runtime', 'coverage', 'migrations']);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

afterEach(() => {
  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_MODEL;
  delete process.env.OLLAMA_VISION_MODEL;
  delete global.fetch;
});

test('no server code calls a hosted AI API', () => {
  const offenders = [];
  for (const file of sourceFiles(SERVER)) {
    const src = fs.readFileSync(file, 'utf8');
    if (/openrouter\.ai|api\.openai\.com|api\.meta\.ai|OPENROUTER_API_KEY|META_AI_API_KEY/.test(src)) {
      const rel = path.relative(SERVER, file);
      // validateEnv only names the retired keys to warn that they are ignored.
      if (rel !== path.join('utils', 'validateEnv.js')) offenders.push(rel);
    }
  }
  expect(offenders).toEqual([]);
});

test('an external key alone never enables AI, and a non-allow-listed host is refused', async () => {
  process.env.OPENROUTER_API_KEY = 'x';
  process.env.OPENAI_API_KEY = 'x';
  global.fetch = jest.fn();
  expect(localAi.isLocalAiConfigured()).toBe(false);
  process.env.OLLAMA_URL = 'https://openrouter.ai/api';
  expect(localAi.isLocalAiConfigured()).toBe(false);
  expect(await localAi.fetchLocalAiChat([{ role: 'user', content: 'hi' }])).toEqual({ ok: false, error: 'OLLAMA_URL not configured' });
  expect(global.fetch).not.toHaveBeenCalled();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

test('calls go to the allow-listed Ollama /api/chat with images converted, remote URLs dropped', async () => {
  process.env.OLLAMA_URL = 'http://localhost:11434/';
  process.env.OLLAMA_VISION_MODEL = 'llava:7b';
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ message: { content: ' ok ' } }) }));
  const result = await localAi.fetchLocalAiChat([
    { role: 'system', content: 'sys' },
    { role: 'user', content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      { type: 'image_url', image_url: { url: 'https://evil.example/x.png' } },
    ] },
  ], { temperature: 0.2, maxTokens: 50 });
  expect(result).toEqual({ ok: true, reply: 'ok', provider: 'ollama', model: 'llava:7b' });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe('http://localhost:11434/api/chat');
  const body = JSON.parse(init.body);
  expect(body.messages[1]).toEqual({ role: 'user', content: 'what is this?', images: ['iVBORw0KGgo='] });
  expect(body.options).toEqual({ temperature: 0.2, num_predict: 50 });
  expect(body.stream).toBe(false);
});

test('provider failures resolve to { ok: false } instead of throwing', async () => {
  process.env.OLLAMA_URL = 'http://localhost:11434';
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
  expect(await localAi.fetchLocalAiChat([{ role: 'user', content: 'hi' }])).toEqual({ ok: false, error: 'HTTP 503: down' });
  global.fetch = jest.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
  expect(await localAi.fetchLocalAiChat([{ role: 'user', content: 'hi' }])).toEqual({ ok: false, error: 'provider timeout' });
});

test('the translation registry only knows self-hosted providers', () => {
  const registry = require('../modules/providers/providerRegistry');
  expect(registry.resolveChain()).toEqual(['ollama', 'libretranslate']);
  expect(registry.getProviderById('openrouter')).toBeNull();
  expect(registry.getProviderById('openai')).toBeNull();
});
