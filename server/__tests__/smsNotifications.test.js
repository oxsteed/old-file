'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const smsNotificationController = require('../controllers/smsNotificationController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.put('/api/notifications/sms/preferences', smsNotificationController.updateSMSPreferences);
  return app;
}

beforeEach(() => resetMocks());

describe('SMS notification preferences', () => {
  test('PUT /notifications/sms/preferences creates a default preference row before updating', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          sms_enabled: false,
          sms_order_created: true,
          sms_payment_confirmed: true,
          sms_order_shipped: true,
          sms_order_cancelled: true,
          sms_order_refunded: true,
        }],
      });

    const res = await request(buildApp())
      .put('/api/notifications/sms/preferences')
      .send({ smsEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.data.smsEnabled).toBe(false);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO notification_preferences');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123']);
    expect(mockQuery.mock.calls[1][0]).toContain('UPDATE notification_preferences');
    expect(mockQuery.mock.calls[1][1]).toEqual([false, 'user-123']);
  });
});
