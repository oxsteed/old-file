'use strict';

/**
 * Fix 1 (Meta tokens on unauthenticated requests) + Fix 7 (handoff heuristic).
 *
 * - Anonymous POST /api/chat/message requests must never select the Meta
 *   provider (paid Contributor tier); they use the free-tier chain instead.
 * - Signed-in requests keep the existing Meta-first chain.
 * - The AI chat response carries handoff_suggested when the heuristic fires.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/aiChatProvider', () => ({
  isMetaConfigured: jest.fn().mockReturnValue(true),
  getMetaModel: jest.fn().mockReturnValue('muse-spark-test'),
  fetchMetaChat: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { fetchMetaChat, isMetaConfigured } = require('../services/aiChatProvider');
const chatController = require('../controllers/chatController');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  isMetaConfigured.mockReturnValue(true);
  fetchMetaChat.mockResolvedValue({ ok: true, reply: 'meta reply' });
  // Free-tier OpenRouter success response.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'free tier reply' } }] }),
  });
});

afterEach(() => {
  delete global.fetch;
});

describe('anonymous chat provider selection', () => {
  test('never selects the Meta provider for anonymous requests', async () => {
    const req = { body: { messages: [{ role: 'user', content: 'Hello, I need help' }] } };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(fetchMetaChat).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'free tier reply' })
    );
  });

  test('keeps the Meta-first chain for signed-in requests', async () => {
    const req = {
      user: { id: 'user-1' },
      body: { messages: [{ role: 'user', content: 'Hello, I need help' }] },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(fetchMetaChat).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'meta reply' })
    );
  });

  test('an invalid token still counts as anonymous (no Meta spend)', async () => {
    // optionalAuth leaves req.user undefined for bad tokens; the handler must
    // treat that exactly like a signed-out request.
    const req = { body: { messages: [{ role: 'user', content: 'Hello' }] } };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(fetchMetaChat).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'free tier reply' })
    );
  });
});

describe('handoff_suggested heuristic', () => {
  test('is true after several user turns (message-count signal)', async () => {
    const req = {
      body: {
        messages: [
          { role: 'user', content: 'Where is my order?' },
          { role: 'assistant', content: 'Let me check.' },
          { role: 'user', content: 'It still has not arrived.' },
          { role: 'assistant', content: 'One moment.' },
          { role: 'user', content: 'This is taking too long.' },
          { role: 'assistant', content: 'I understand.' },
          { role: 'user', content: 'Can someone help me?' },
        ],
      },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ handoff_suggested: true })
    );
  });

  test('is true on negative sentiment', async () => {
    const req = {
      body: { messages: [{ role: 'user', content: 'This is terrible, I want to speak to a human' }] },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ handoff_suggested: true })
    );
  });

  test('is true when the same question is repeated', async () => {
    const req = {
      body: {
        messages: [
          { role: 'user', content: 'Where is my refund?' },
          { role: 'assistant', content: 'Refunds take 3 days.' },
          { role: 'user', content: 'Where is my refund?' },
        ],
      },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ handoff_suggested: true })
    );
  });

  test('is false for a single neutral message', async () => {
    const req = {
      body: { messages: [{ role: 'user', content: 'What are your support hours?' }] },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ handoff_suggested: false })
    );
  });
});
