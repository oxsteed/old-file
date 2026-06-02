'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const notifCtrl = require('../controllers/notificationController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.put('/api/notifications/read-all', (req, res, next) => {
    req.body = { ...req.body, ids: 'all' };
    return notifCtrl.markRead(req, res, next);
  });
  app.put('/api/notifications/:id/read', (req, res, next) => {
    req.body = { ...req.body, ids: [req.params.id] };
    return notifCtrl.markRead(req, res, next);
  });
  app.delete('/api/notifications/:id', notifCtrl.deleteNotification);
  return app;
}

beforeEach(() => resetMocks());

describe('notification route compatibility', () => {
  test('PUT /notifications/:id/read marks one notification read', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const res = await request(buildApp()).put('/api/notifications/55/read');

    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(2);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123', ['55']]);
  });

  test('PUT /notifications/read-all marks all notifications read', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 3 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(buildApp()).put('/api/notifications/read-all');

    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(0);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123']);
  });

  test('DELETE /notifications/:id dismisses one notification', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(buildApp()).delete('/api/notifications/55');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, unread_count: 1 });
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123', '55']);
  });
});
