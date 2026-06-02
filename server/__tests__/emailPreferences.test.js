'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const emailPreferencesController = require('../controllers/emailPreferencesController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.get('/api/notifications/email', emailPreferencesController.getEmailPreferences);
  app.put('/api/notifications/email', emailPreferencesController.updateEmailPreferences);
  return app;
}

beforeEach(() => resetMocks());

describe('email notification preferences', () => {
  test('GET /notifications/email creates a default preference row when missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          user_id: 'user-123',
          email_notifications: true,
          sms_notifications: false,
          push_notifications: true,
          marketing_emails: true,
          email_frequency: 'real-time',
          unsubscribe_all: false,
          unsubscribed_from_bulk_emails: false,
          email_updated_at: '2026-06-02T12:00:00.000Z',
        }],
        rowCount: 1,
      });

    const res = await request(buildApp()).get('/api/notifications/email');

    expect(res.status).toBe(200);
    expect(res.body.data.frequency).toBe('real-time');
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO notification_preferences');
    expect(mockQuery.mock.calls[1][1]).toEqual(['user-123']);
  });

  test('PUT /notifications/email creates a preference row before updating', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'user-123',
          email_notifications: false,
          sms_notifications: true,
          push_notifications: true,
          marketing_emails: false,
          email_frequency: 'daily',
          email_updated_at: '2026-06-02T12:00:00.000Z',
        }],
        rowCount: 1,
      });

    const res = await request(buildApp())
      .put('/api/notifications/email')
      .send({
        frequency: 'daily',
        emailNotifications: false,
        marketingEmails: false,
        smsNotifications: true,
        pushNotifications: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.frequency).toBe('daily');
    expect(res.body.data.emailNotifications).toBe(false);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO notification_preferences');
    expect(mockQuery.mock.calls[1][0]).toContain('UPDATE notification_preferences');
  });
});
