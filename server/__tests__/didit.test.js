'use strict';

// Must be set before the controller module is first required (it reads the
// env var at load time to set DIDIT_WEBHOOK_SECRET).
process.env.DIDIT_WEBHOOK_SECRET = 'test-didit-secret';

const { mockQuery, resetMocks } = require('./setup');
const crypto  = require('crypto');
const express = require('express');
const request = require('supertest');

const diditRoutes = require('../routes/didit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/didit', diditRoutes);
  return app;
}

// Compute a valid Didit HMAC signature for a given body object
function sign(body) {
  return crypto
    .createHmac('sha256', 'test-didit-secret')
    .update(JSON.stringify(body))
    .digest('hex');
}

function sendWebhook(app, body, signature) {
  return request(app)
    .post('/api/didit/webhook')
    .set('x-webhook-signature', signature ?? sign(body))
    .send(body);
}

beforeEach(() => resetMocks());

// ── Signature verification ─────────────────────────────────────────────────────
describe('POST /api/didit/webhook — signature', () => {
  test('returns 401 when signature header is missing', async () => {
    const res = await request(buildApp())
      .post('/api/didit/webhook')
      .send({ session_id: 'sess_abc', status: 'approved' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing webhook signature/i);
  });

  test('returns 401 when signature is wrong', async () => {
    const res = await sendWebhook(buildApp(),
      { session_id: 'sess_abc', status: 'approved' },
      'bad-signature'
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid webhook signature/i);
  });
});

// ── Input validation ───────────────────────────────────────────────────────────
describe('POST /api/didit/webhook — validation', () => {
  test('returns 400 when session_id is missing', async () => {
    const body = { status: 'approved' };
    const res = await sendWebhook(buildApp(), body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing session_id/i);
  });

  test('returns 404 when session is not found in DB', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT user by session_id → not found
    const body = { session_id: 'sess_unknown', status: 'approved' };
    const res = await sendWebhook(buildApp(), body);
    expect(res.status).toBe(404);
  });
});

// ── Verification outcomes ──────────────────────────────────────────────────────
describe('POST /api/didit/webhook — outcomes', () => {
  test('sets didit_status=failed when status is declined', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, didit_status: 'pending' }] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] });                                   // UPDATE failed

    const body = { session_id: 'sess_abc', status: 'declined' };
    const res  = await sendWebhook(buildApp(), body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'failed' });

    // Second query should be the UPDATE to 'failed'
    const updateCall = mockQuery.mock.calls[1][0];
    expect(updateCall).toMatch(/didit_status = 'failed'/);
  });

  test('sets didit_status=duplicate when identity_hash already exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, didit_status: 'pending' }] })       // SELECT user
      .mockResolvedValueOnce({ rows: [{ id: 3, email: 'other@example.com' }] })    // SELECT existing hash
      .mockResolvedValueOnce({ rows: [] });                                          // UPDATE duplicate

    const body = { session_id: 'sess_abc', status: 'approved', identity_hash: 'hash_xyz' };
    const res  = await sendWebhook(buildApp(), body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('duplicate');
    expect(res.body.ok).toBe(false);
    expect(res.body.existing_email_hint).toMatch(/\*\*\*@/); // masked email
  });

  test('sets didit_status=verified for approved unique identity', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, didit_status: 'pending' }] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] })                                    // SELECT existing hash → none
      .mockResolvedValueOnce({ rows: [] });                                   // UPDATE verified

    const body = { session_id: 'sess_abc', status: 'approved', identity_hash: 'hash_new' };
    const res  = await sendWebhook(buildApp(), body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'verified' });

    const updateCall = mockQuery.mock.calls[2][0];
    expect(updateCall).toMatch(/didit_status = 'verified'/);
    expect(updateCall).toMatch(/is_verified = TRUE/);
  });
});
