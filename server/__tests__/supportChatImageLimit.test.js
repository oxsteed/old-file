'use strict';

// AI support chat review bug #2: a 2 MB image (the client limit) must make it
// through the JSON body parser on /api/chat/message, while every other route
// keeps the global 1 MB cap. Oversized chat bodies return 413.

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { mountChatMessageBodyParser } = require('../middleware/chatMessageBodyParser');
const { MAX_IMAGE_BYTES, MAX_IMAGE_BASE64_CHARS } = require('../constants/supportChatLimits');

function buildApp() {
  const app = express();
  mountChatMessageBodyParser(app);
  app.use(express.json({ limit: '1mb' }));
  app.post('/api/chat/message', (req, res) => res.json({ imageChars: String(req.body.images?.[0] || '').length }));
  app.post('/api/other', (req, res) => res.json({ ok: true }));
  // Mirror errorHandler: body-parser errors carry statusCode.
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.type }));
  return app;
}

function dataUrlOfBytes(n) {
  return `data:image/png;base64,${Buffer.alloc(n, 7).toString('base64')}`;
}

test('a full 2 MB image is accepted on the chat route', async () => {
  const image = dataUrlOfBytes(MAX_IMAGE_BYTES);
  const res = await request(buildApp())
    .post('/api/chat/message')
    .send({ messages: [{ role: 'user', content: 'see image' }], images: [image] });
  expect(res.status).toBe(200);
  expect(res.body.imageChars).toBe(image.length);
});

test('the base64 cap used by the controller matches the 2 MB byte limit', () => {
  expect(Buffer.alloc(MAX_IMAGE_BYTES).toString('base64').length).toBeLessThanOrEqual(MAX_IMAGE_BASE64_CHARS);
  expect(Buffer.alloc(MAX_IMAGE_BYTES + 3).toString('base64').length).toBeGreaterThan(MAX_IMAGE_BASE64_CHARS);
});

test('oversized chat bodies are rejected with 413', async () => {
  const res = await request(buildApp())
    .post('/api/chat/message')
    .send({ messages: [], images: [dataUrlOfBytes(4 * 1024 * 1024)] });
  expect(res.status).toBe(413);
});

test('other routes keep the global 1 MB limit', async () => {
  const res = await request(buildApp())
    .post('/api/other')
    .send({ blob: 'x'.repeat(1.5 * 1024 * 1024) });
  expect(res.status).toBe(413);
});

test('index.js mounts the chat parser before the global JSON parser', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const chatIdx = src.indexOf('mountChatMessageBodyParser(app)');
  const globalIdx = src.indexOf("app.use(express.json({ limit: '1mb' }))");
  expect(chatIdx).toBeGreaterThan(-1);
  expect(globalIdx).toBeGreaterThan(chatIdx);
});
