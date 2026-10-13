'use strict';
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/directSlotEngine', () => ({
  ...jest.requireActual('../services/directSlotEngine'),
  bookServiceSlot: jest.fn(async () => ({
    request: { id: 9, email: 'cust@example.com', assigned_to: 'crew-1', status: 'scheduled' },
    startsAt: '2026-10-20T14:00:00Z', endsAt: '2026-10-20T15:00:00Z', serviceId: 's', serviceName: 'S',
  })),
}));
const { sendEmail } = require('../utils/email');
const directController = require('../controllers/directController');

beforeEach(() => { resetMocks(); sendEmail.mockClear?.(); });

test('instant booking notifies customer, crew and support (P1-177)', async () => {
  mockQuery.mockResolvedValue({ rows: [{ email: 'crew@example.com' }] });
  const app = express();
  app.use(express.json());
  app.post('/s/:id/book', directController.bookServiceSlot);
  const res = await request(app).post('/s/svc/book').send({ startsAt: 'x', endsAt: 'y' });
  expect(res.status).toBe(201);
  const recipients = sendEmail.mock.calls.map(([arg]) => arg.to);
  expect(recipients).toEqual(expect.arrayContaining(['cust@example.com', 'crew@example.com']));
  expect(recipients.length).toBe(3);
});
