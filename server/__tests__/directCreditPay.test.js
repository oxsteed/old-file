'use strict';
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const directController = require('../controllers/directController');

beforeEach(() => resetMocks());

test('Direct credit pay refuses hold mode (P1-181)', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 1, user_id: 'u1', status: 'accepted', payment_status: 'unpaid', quote_amount_cents: 1000, assigned_to: 'h1' }] });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', role: 'customer' }; next(); });
  app.post('/r/:id', directController.payQuoteWithCredit);
  const res = await request(app).post('/r/1').send({ mode: 'hold' });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('credit_hold_unsupported');
});
