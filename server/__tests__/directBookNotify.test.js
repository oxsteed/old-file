'use strict';
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/directSlotEngine', () => ({
  ...jest.requireActual('../services/directSlotEngine'),
  bookServiceSlot: jest.fn(async () => ({
    request: { id: 9, email: 'cust@example.com', assigned_to: 'crew-1', status: 'scheduled' },
    assignedCrew: ['crew-1', 'crew-2'],
    startsAt: '2026-10-20T14:00:00Z', endsAt: '2026-10-20T15:00:00Z', serviceId: 's', serviceName: 'S',
  })),
}));
const mockSendNotification = jest.fn(async () => ({ success: true }));
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));
const { sendEmail } = require('../utils/email');
const directController = require('../controllers/directController');

beforeEach(() => { resetMocks(); sendEmail.mockClear?.(); mockSendNotification.mockClear(); });

test('instant booking notifies customer, crew and support (P1-177)', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'crew-1', email: 'crew@example.com' }] });
  const app = express();
  app.use(express.json());
  app.post('/s/:id/book', directController.bookServiceSlot);
  const res = await request(app).post('/s/svc/book').send({ startsAt: 'x', endsAt: 'y' });
  expect(res.status).toBe(201);
  const recipients = sendEmail.mock.calls.map(([arg]) => arg.to);
  expect(recipients).toEqual(expect.arrayContaining(['cust@example.com', 'crew@example.com']));
  expect(recipients.length).toBe(3);
});

test('instant booking notifies every crew member, not just the lead (P1-4-F05)', async () => {
  mockQuery.mockResolvedValue({
    rows: [
      { id: 'crew-1', email: 'crew1@example.com' },
      { id: 'crew-2', email: 'crew2@example.com' },
    ],
  });
  const app = express();
  app.use(express.json());
  app.post('/s/:id/book', directController.bookServiceSlot);
  const res = await request(app).post('/s/svc/book').send({ startsAt: 'x', endsAt: 'y' });
  expect(res.status).toBe(201);
  const recipients = sendEmail.mock.calls.map(([arg]) => arg.to);
  // customer + both crew members + support
  expect(recipients).toEqual(expect.arrayContaining([
    'cust@example.com', 'crew1@example.com', 'crew2@example.com',
  ]));
  expect(recipients.length).toBe(4);
  // in-app/socket notification to each crew member
  const notifiedUserIds = mockSendNotification.mock.calls.map(([arg]) => arg.userId).sort();
  expect(notifiedUserIds).toEqual(['crew-1', 'crew-2']);
  expect(mockSendNotification.mock.calls[0][0].type).toBe('direct_crew_booking');
});
