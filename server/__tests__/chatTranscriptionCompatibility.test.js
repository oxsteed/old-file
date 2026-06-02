'use strict';

const express = require('express');
const request = require('supertest');
const chatRoutes = require('../routes/chat');
const speechToText = require('../utils/speechToText');
const { fileTypeFromBuffer } = require('file-type');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-123', is_active: true };
    next();
  },
}));

jest.mock('../utils/speechToText', () => ({
  transcribeAudio: jest.fn().mockResolvedValue({
    transcript: 'Test transcript',
    confidence: 0.92,
    language: 'en',
  }),
}));

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/chat', chatRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  });
  return app;
}

beforeEach(() => {
  speechToText.transcribeAudio.mockClear();
  fileTypeFromBuffer.mockResolvedValue({ mime: 'audio/mpeg', ext: 'mp3' });
});

describe('chat transcription compatibility', () => {
  test('accepts legacy base64 JSON audio_data', async () => {
    const res = await request(buildApp())
      .post('/api/chat/transcribe')
      .send({ audio_data: Buffer.from('audio bytes').toString('base64'), language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('Test transcript');
    expect(speechToText.transcribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'en');
  });

  test('accepts iOS multipart audio upload', async () => {
    const res = await request(buildApp())
      .post('/api/chat/transcribe')
      .field('language', 'en')
      .attach('audio', Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00]), {
        filename: 'voice.mp3',
        contentType: 'audio/mpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe(0.92);
    expect(speechToText.transcribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'en');
  });

  test('rejects requests without audio data', async () => {
    const res = await request(buildApp())
      .post('/api/chat/transcribe')
      .send({ language: 'en' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(speechToText.transcribeAudio).not.toHaveBeenCalled();
  });
});
