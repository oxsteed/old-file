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

function buildApp({ jsonLimit = '1mb' } = {}) {
  const app = express();
  app.use(express.json({ limit: jsonLimit }));
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

  test('accepts Arabic as a supported app language', async () => {
    speechToText.transcribeAudio.mockResolvedValueOnce({
      transcript: 'اختبار',
      confidence: 0.9,
      language: 'ar',
    });

    const res = await request(buildApp())
      .post('/api/chat/transcribe')
      .send({ audio_data: Buffer.from('audio bytes').toString('base64'), language: 'ar' });

    expect(res.status).toBe(200);
    expect(res.body.language).toBe('ar');
    expect(speechToText.transcribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'ar');
  });

  test('rejects requests without audio data', async () => {
    const res = await request(buildApp())
      .post('/api/chat/transcribe')
      .send({ language: 'en' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(speechToText.transcribeAudio).not.toHaveBeenCalled();
  });

  // Review P3-6-F16: the base64 JSON path must meet the same gates as the
  // multer path (audio content check, 10 MB cap).
  test('rejects base64 audio_data that is not audio content', async () => {
    fileTypeFromBuffer.mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });
    const res = await request(buildApp())
      .post('/api/chat/transcribe')
      .send({ audio_data: Buffer.from('not audio at all').toString('base64'), language: 'en' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(speechToText.transcribeAudio).not.toHaveBeenCalled();
  });

  test('rejects base64 audio_data larger than 10 MB', async () => {
    // Raise the JSON body cap so the controller's own 10 MB gate is the one
    // under test (production also blunts this via the 1 MB express.json cap).
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64');
    const res = await request(buildApp({ jsonLimit: '20mb' }))
      .post('/api/chat/transcribe')
      .send({ audio_data: big, language: 'en' });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('audio_too_large');
    expect(speechToText.transcribeAudio).not.toHaveBeenCalled();
  });
});
