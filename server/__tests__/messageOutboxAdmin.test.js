'use strict';

// P1-268: dead-lettered chat notifications are visible and retryable.
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));
jest.mock('../jobs/jobLockingService', () => ({ withFencedJobLock: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../middleware/adminAuth', () => ({
  requirePermission: jest.fn(() => (_req, _res, next) => next()),
  requireAdmin: (req, _res, next) => { req.user = { id: '00000000-0000-4000-8000-0000000000ad' }; next(); },
}));
jest.mock('../middleware/rateLimiter', () => ({ strictLimiter: (_req, _res, next) => next() }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const db = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const outbox = require('../jobs/messageNotificationOutbox');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/message-notification-outbox', require('../routes/adminMessageOutbox'));
  return a;
}

beforeEach(() => { jest.clearAllMocks(); db.query.mockReset(); });

test('terminal failure logs a dead-letter alert', async () => {
  db.query.mockResolvedValueOnce({ rowCount: 1 });
  const status = await outbox.finishMessageNotification('o1', outbox.MAX_ATTEMPTS, { success: false, error: 'boom' }, 'lease');
  expect(status).toBe('failed');
  expect(logger.error).toHaveBeenCalledWith('Message notification dead-lettered', expect.objectContaining({ outboxId: 'o1' }));
});

test('GET /failed lists failed rows with a total', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 'o1', attempts: 8, last_error: 'boom' }] })
    .mockResolvedValueOnce({ rows: [{ total: 1 }] });
  const res = await request(app()).get('/api/admin/message-notification-outbox/failed');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  expect(res.body.items[0].id).toBe('o1');
  expect(db.query.mock.calls[0][0]).toMatch(/status = 'failed'/);
});

test('POST /retry requeues only failed rows and audits it', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] });
  const res = await request(app()).post('/api/admin/message-notification-outbox/retry').send({ ids: ['o1', 'o2'] });
  expect(res.status).toBe(200);
  expect(res.body.retried).toBe(2);
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toMatch(/SET status = 'pending', attempts = 0/);
  expect(sql).toMatch(/WHERE status = 'failed'/);
  expect(params).toEqual([['o1', 'o2']]);
  expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'message_notification_outbox.retry' }));
});

test('POST /retry without ids or all is rejected', async () => {
  const res = await request(app()).post('/api/admin/message-notification-outbox/retry').send({});
  expect(res.status).toBe(400);
  expect(db.query).not.toHaveBeenCalled();
});
