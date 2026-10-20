'use strict';

/**
 * Provider selection for chat requests.
 *
 * - All requests use OpenRouter (no Meta provider).
 * - The AI chat response carries handoff_suggested when the heuristic fires.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

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
  // OpenRouter success response.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'openrouter reply' } }] }),
  });
});

afterEach(() => {
  delete global.fetch;
});

describe('anonymous chat provider selection', () => {
  test('anonymous requests use OpenRouter', async () => {
    const req = { body: { messages: [{ role: 'user', content: 'Hello, I need help' }] } };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'openrouter reply' })
    );
  });

  test('signed-in requests use OpenRouter (no Meta provider)', async () => {
    const req = {
      user: { id: 'user-1' },
      body: { messages: [{ role: 'user', content: 'Hello, I need help' }] },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'openrouter reply' })
    );
  });

  test('an invalid token still counts as anonymous (OpenRouter)', async () => {
    // optionalAuth leaves req.user undefined for bad tokens; the handler must
    // treat that exactly like a signed-out request.
    const req = { body: { messages: [{ role: 'user', content: 'Hello' }] } };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'openrouter reply' })
    );
  });
});

describe('handoff_suggested heuristic', () => {
  test('long but calm conversations do not suggest handoff (turn count is not a signal)', async () => {
    const req = {
      body: {
        messages: [
          { role: 'user', content: 'Where is my order?' },
          { role: 'assistant', content: 'Let me check.' },
          { role: 'user', content: 'It still has not arrived.' },
          { role: 'assistant', content: 'One moment.' },
          { role: 'user', content: 'This is taking too long.' },
          { role: 'assistant', content: 'I understand.' },
          { role: 'user', content: 'What should I check next?' },
        ],
      },
    };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ handoff_suggested: false })
    );
  });

  test('is true when the model marks the reply as needing a person', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'I cannot change that order from here.\n[[handoff]]' } }] }),
    });
    const req = { body: { messages: [{ role: 'user', content: 'Change my order address' }] } };
    const res = responseDouble();

    await chatController.chatMessage(req, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.handoff_suggested).toBe(true);
    expect(payload.handoff_reason).toBe('model_cannot_help');
    expect(payload.reply).toBe('I cannot change that order from here.');
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
