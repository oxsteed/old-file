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

describe('RFC 8058 one-click unsubscribe (Item 22)', () => {
  const emailPreferencesRouter = require('../routes/emailPreferences');

  function buildOneClickApp() {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/notifications/email', emailPreferencesRouter);
    return app;
  }

  const validToken = 'a'.repeat(64);

  function mockTokenLookup(userId, category) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: userId, category }], rowCount: 1 }) // token lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // preference update
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // token marked used
  }

  test('POST /unsubscribe-one-click with token in query unsubscribes from marketing only', async () => {
    mockTokenLookup('user-123', 'marketing');

    const res = await request(buildOneClickApp())
      .post(`/api/notifications/email/unsubscribe-one-click?token=${validToken}`)
      .send('List-Unsubscribe=One-Click')
      .set('Content-Type', 'application/x-www-form-urlencoded');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // marketing_emails must be set to FALSE (opted-IN polarity), not TRUE
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE notification_preferences'));
    expect(updateCall[0]).toContain('marketing_emails = $2');
    expect(updateCall[1]).toEqual(['user-123', false]);
    // token marked used
    const markUsed = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE email_unsubscribe_tokens'));
    expect(markUsed[1]).toEqual([validToken]);
  });

  test('POST /unsubscribe-one-click accepts the token in the JSON body', async () => {
    mockTokenLookup('user-123', 'marketing');

    const res = await request(buildOneClickApp())
      .post('/api/notifications/email/unsubscribe-one-click')
      .send({ token: validToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /unsubscribe-one-click with a category-less token unsubscribes from all', async () => {
    mockTokenLookup('user-123', null);

    const res = await request(buildOneClickApp())
      .post('/api/notifications/email/unsubscribe-one-click')
      .send({ token: validToken });

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE notification_preferences'));
    expect(updateCall[0]).toContain('unsubscribe_all = TRUE');
  });

  test('POST /unsubscribe-one-click rejects a short token with 400', async () => {
    const res = await request(buildOneClickApp())
      .post('/api/notifications/email/unsubscribe-one-click')
      .send({ token: 'short' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('POST /unsubscribe-one-click returns 404 for an unknown or used token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(buildOneClickApp())
      .post('/api/notifications/email/unsubscribe-one-click')
      .send({ token: validToken });

    expect(res.status).toBe(404);
  });

  test('POST /unsubscribe/:token confirm path keeps the corrected marketing polarity', async () => {
    mockTokenLookup('user-123', 'marketing');

    const res = await request(buildOneClickApp())
      .post(`/api/notifications/email/unsubscribe/${validToken}`);

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE notification_preferences'));
    expect(updateCall[1]).toEqual(['user-123', false]);
  });
});
