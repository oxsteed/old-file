'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { submitAppReport } = require('../controllers/settingsPrivacyController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/settings/app-report', (req, _res, next) => {
    req.id = 'test-request-id';
    req.user = {
      id: 'user-123',
      first_name: 'Emile',
      last_name: 'Philippe',
      email: 'emile@example.com',
      preferred_language: 'en',
    };
    next();
  }, submitAppReport);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
});

describe('settings app report endpoint', () => {
  test('creates a support ticket with mobile trace metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-1', ticket_number: 'SUP-100' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildApp())
      .post('/api/settings/app-report')
      .set('X-OxSteed-App-Version', '1.0.0')
      .set('X-OxSteed-Build', '122')
      .set('X-OxSteed-Git-SHA', 'abc123')
      .send({ details: 'The Settings export button failed.', platform: 'ios' });

    expect(res.status).toBe(201);
    expect(res.body.ticket_id).toBe('ticket-1');
    expect(res.body.ticket_number).toBe('SUP-100');

    const ticketInsert = mockQuery.mock.calls[1];
    expect(ticketInsert[0]).toMatch(/INSERT INTO support_tickets/);
    expect(ticketInsert[1]).toEqual([
      'user-123',
      'Emile Philippe',
      'emile@example.com',
      'iOS Settings Report - build 122',
    ]);

    const messageInsert = mockQuery.mock.calls[2];
    expect(messageInsert[0]).toMatch(/INSERT INTO support_messages/);
    expect(messageInsert[1][4]).toContain('The Settings export button failed.');
    expect(messageInsert[1][4]).toContain('app_version: 1.0.0');
    expect(messageInsert[1][4]).toContain('build_number: 122');
    expect(messageInsert[1][4]).toContain('git_sha: abc123');
  });

  test('rejects empty reports', async () => {
    const res = await request(buildApp())
      .post('/api/settings/app-report')
      .send({ details: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.fields.details).toBe('Required');
  });
});
