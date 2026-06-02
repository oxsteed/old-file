'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const { sendNotification } = require('../services/notificationService');
const { sendSOS } = require('../controllers/safetyController');
const { errorHandler } = require('../middleware/errorHandler');

function buildApp(user = { id: 'user-1' }) {
  const app = express();
  app.use(express.json());
  app.post('/api/safety/sos', (req, _res, next) => {
    req.user = user;
    next();
  }, sendSOS);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  sendNotification.mockClear();
});

describe('safety SOS endpoint', () => {
  test('accepts legacy latitude and longitude fields while preserving location', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'admin-1' }], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/safety/sos')
      .send({
        latitude: 37.7749,
        longitude: -122.4194,
        contact_name: 'Emergency Contact',
        contact_phone: '+15551234567',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const insert = mockQuery.mock.calls[0];
    expect(insert[0]).toMatch(/INSERT INTO safety_sos_events/);
    expect(insert[1]).toEqual([
      'user-1',
      37.7749,
      -122.4194,
      'Emergency Contact',
      '+15551234567',
      null,
    ]);

    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin-1',
      type: 'safety_sos',
      data: expect.objectContaining({
        lat: 37.7749,
        lng: -122.4194,
      }),
    }));
  });

  test('notifies the other party when SOS is linked to a job', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ customer_id: 'user-1', helper_id: 'helper-9' }], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/safety/sos')
      .send({
        lat: 40.7128,
        lng: -74.006,
        contact_name: 'Emergency Contact',
        contact_phone: '+15551234567',
        job_id: 'job-123',
      });

    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'helper-9',
      type: 'safety_sos',
      action_url: '/jobs/job-123',
      data: expect.objectContaining({
        userId: 'user-1',
        lat: 40.7128,
        lng: -74.006,
        job_id: 'job-123',
      }),
    }));
  });
});
