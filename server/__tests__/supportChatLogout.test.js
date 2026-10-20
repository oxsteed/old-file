'use strict';

// AI support chat review bug #3: logout ends the server-side support memory.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('@otplib/v12-adapter', () => ({
  authenticator: { options: {}, verify: jest.fn().mockReturnValue(true), generateSecret: jest.fn(), keyuri: jest.fn() },
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const supportChatThreads = require('../services/supportChatThreads');
const authRoutes = require('../routes/auth');

beforeEach(() => resetMocks());

test('logout deletes the server-side support thread for the session user', async () => {
  const spy = jest.spyOn(supportChatThreads, 'clearSupportThread').mockResolvedValue(undefined);
  const userId = '00000000-0000-4000-8000-0000000000aa';
  mockQuery.mockResolvedValue({ rows: [] });
  const token = jwt.sign({ id: userId, email: 'a@example.com', role: 'customer' }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).send({});
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledWith(userId);
  spy.mockRestore();
});

test('logout without an identifiable user does not touch support memory', async () => {
  const spy = jest.spyOn(supportChatThreads, 'clearSupportThread').mockResolvedValue(undefined);
  mockQuery.mockResolvedValue({ rows: [] });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  const res = await request(app).post('/api/auth/logout').send({ refreshToken: 'unknown-token' });
  expect(res.status).toBe(200);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
