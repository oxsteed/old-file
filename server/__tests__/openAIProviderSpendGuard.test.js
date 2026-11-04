'use strict';

// Cost audit 2026-11-04 item 5: the OpenAI translation fallback may no
// longer spend without a spend-budget reservation. A denied reservation
// must never reach the network.

jest.mock('https', () => ({ request: jest.fn() }));
jest.mock('../services/openRouterSpendGuard', () => ({
  reserve: jest.fn(),
  settle: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ warn: jest.fn(), error: jest.fn() }));
const https = require('https');
const budget = require('../services/openRouterSpendGuard');
const { EventEmitter } = require('events');

const provider = require('../modules/providers/openAIProvider');

function fakeResponse(payload, statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  process.nextTick(() => {
    res.emit('data', JSON.stringify(payload));
    res.emit('end');
  });
  return res;
}

function fakeRequest(res) {
  const req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn();
  req.setTimeout = jest.fn();
  req.destroy = jest.fn();
  https.request.mockImplementation((options, callback) => {
    callback(res);
    return req;
  });
  return req;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

test('a denied reservation never reaches the network', async () => {
  budget.reserve.mockResolvedValue(null);
  await expect(provider.translate({
    text: 'hello', sourceLanguage: 'en', targetLanguage: 'es', tone: 'default',
  })).rejects.toThrow('openai_spend_cap_exceeded');
  expect(budget.reserve).toHaveBeenCalledTimes(1);
  expect(https.request).not.toHaveBeenCalled();
});

test('a reserved call reaches the network and settles afterwards', async () => {
  const reservation = { key: 'k', amount: 10, id: 'k:1' };
  budget.reserve.mockResolvedValue(reservation);
  const modelReply = JSON.stringify({
    translatedText: 'hola', detectedSourceLanguage: 'en', confidence: 1, warnings: [],
  });
  fakeRequest(fakeResponse({
    model: 'gpt-4o-mini',
    choices: [{ message: { content: modelReply } }],
    usage: { cost: 0 },
  }));
  const result = await provider.translate({
    text: 'hello', sourceLanguage: 'en', targetLanguage: 'es', tone: 'default',
  });
  expect(result.translatedText).toBe('hola');
  expect(result.provider).toBe('openai');
  expect(https.request).toHaveBeenCalledTimes(1);
  expect(budget.settle).toHaveBeenCalledWith(reservation, { cost: 0 });
});
