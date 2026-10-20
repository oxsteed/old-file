'use strict';

// AI support chat review bug #1: GET /api/chat/sessions/guest/messages used
// `pool` without importing it, so every verified guest history load 500'd.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/guestProfileChatVerification', () => {
  const actual = jest.requireActual('../services/guestProfileChatVerification');
  return {
    ...actual,
    extractGuestAuth: jest.fn(() => ({ token: 'guest-token', sessionId: 'sess-1' })),
    loadVerifiedGuestSession: jest.fn(async () => ({ id: 'sess-1', helper_id: null, business_id: null })),
    tokenMatchesProfile: jest.fn(() => true),
  };
});

const chatRoutes = require('../routes/chat');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRoutes);
  return app;
}

beforeEach(() => resetMocks());

test('verified guest history loads from the bound session', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      { id: 1, sender_type: 'guest', sender_name: 'Ana', message: 'Hi', created_at: '2026-10-19T12:00:00Z' },
      { id: 2, sender_type: 'helper', sender_name: 'Bo', message: 'Hello', created_at: '2026-10-19T12:01:00Z' },
    ],
  });
  const res = await request(buildApp())
    .get('/api/chat/sessions/guest/messages')
    .set('Authorization', 'Guest guest-token');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(2);
  expect(res.body[0]).toMatchObject({ id: '1', authorType: 'user', content: 'Hi' });
  expect(res.body[1]).toMatchObject({ authorType: 'helper_human' });
  expect(mockQuery.mock.calls[0][1]).toEqual(['sess-1']);
});

test('history without a verified guest session is rejected', async () => {
  const res = await request(buildApp()).get('/api/chat/sessions/guest/messages');
  expect(res.status).toBe(401);
});
