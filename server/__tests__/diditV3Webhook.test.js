'use strict';

process.env.DIDIT_WEBHOOK_SECRET = 'test-didit-v3-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_didit_webhook';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const logger = require('../utils/logger');
const webhookRoutes = require('../routes/webhook');

function shortenFloats(value) {
  if (Array.isArray(value)) return value.map(shortenFloats);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shortenFloats(item)])
    );
  }
  return value;
}

function stableStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sign(payload) {
  return crypto.createHmac('sha256', process.env.DIDIT_WEBHOOK_SECRET)
    .update(stableStringify(shortenFloats(payload)), 'utf8')
    .digest('hex');
}

function buildApp() {
  const app = express();
  app.use('/api/webhooks', webhookRoutes);
  return app;
}

function postSignedDidit(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  return request(buildApp())
    .post('/api/webhooks/didit')
    .set('content-type', 'application/json')
    .set('x-timestamp', String(timestamp))
    .set('x-signature-v2', sign(payload))
    .send(JSON.stringify(payload));
}

beforeEach(() => {
  resetMocks();
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Didit v3 webhook', () => {
  test('accepts a valid X-Signature-V2 using X-Timestamp', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      event_id: 'didit-test-event',
      session_id: 'didit-test-session',
      status: 'Approved',
      created_at: timestamp,
      metadata: { test_webhook: true },
      label: 'OxSteed',
    };

    const response = await request(buildApp())
      .post('/api/webhooks/didit')
      .set('content-type', 'application/json')
      .set('x-timestamp', String(timestamp))
      .set('x-signature-v2', sign(payload))
      .set('x-didit-test-webhook', 'true')
      .send(JSON.stringify(payload));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, test: true });
  });

  test('rejects stale or invalid v3 signatures', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const payload = {
      event_id: 'didit-stale-event',
      session_id: 'didit-stale-session',
      status: 'Approved',
      created_at: timestamp,
      metadata: { test_webhook: true },
    };

    const response = await request(buildApp())
      .post('/api/webhooks/didit')
      .set('content-type', 'application/json')
      .set('x-timestamp', String(timestamp))
      .set('x-signature-v2', sign(payload))
      .send(JSON.stringify(payload));

    expect(response.status).toBe(401);
  });
});

describe('Didit v3 webhook unhappy paths', () => {
  test('rejects a missing signature with 401', async () => {
    const response = await request(buildApp())
      .post('/api/webhooks/didit')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ event_id: 'e1', session_id: 's1', status: 'Approved' }));

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('invalid_webhook_signature');
  });

  test('rejects malformed JSON with 400', async () => {
    const response = await request(buildApp())
      .post('/api/webhooks/didit')
      .set('content-type', 'application/json')
      .send('{"event_id": "broken",');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_json');
  });

  test('rejects a JSON literal body with 400 instead of throwing', async () => {
    const response = await request(buildApp())
      .post('/api/webhooks/didit')
      .set('content-type', 'application/json')
      .send('null');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_json');
  });

  test('returns 400 when session_id is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    const payload = {
      event_id: 'didit-no-session',
      status: 'Approved',
      created_at: Math.floor(Date.now() / 1000),
    };

    const response = await postSignedDidit(payload);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('missing_session_id');
  });

  test('acknowledges unknown verification statuses without throwing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });
    const payload = {
      event_id: 'didit-unknown-status',
      session_id: 'didit-unknown-session',
      status: 'InReview',
      webhook_type: 'verification.something-new',
      created_at: Math.floor(Date.now() / 1000),
    };

    const response = await postSignedDidit(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(logger.info).toHaveBeenCalledWith(
      '[Didit] Unhandled status',
      expect.objectContaining({ status: 'InReview', providerRefId: 'didit-unknown-session' })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('handles a declined verification whose warnings are not an array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 });
    const payload = {
      event_id: 'didit-declined-warnings',
      session_id: 'didit-declined-session',
      status: 'Declined',
      created_at: Math.floor(Date.now() / 1000),
      decision: { id_verifications: [{ warnings: 'not-an-array' }] },
    };

    const response = await postSignedDidit(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    const declinedUpdate = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("SET status = 'declined'")
    );
    expect(declinedUpdate).toBeDefined();
    expect(declinedUpdate[1][0]).toBe('Verification declined');
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('marks an approved verification verified and awards the badge', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 11 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const payload = {
      event_id: 'didit-approved',
      session_id: 'didit-approved-session',
      status: 'Approved',
      created_at: Math.floor(Date.now() / 1000),
      decision: {
        id_verifications: [{
          full_name: 'Jane Doe',
          document_type: 'passport',
          document_number: 'X123456',
          date_of_birth: '1990-04-01',
        }],
      },
    };

    const response = await postSignedDidit(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    const verifiedUpdate = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("didit_status = 'verified'")
    );
    expect(verifiedUpdate).toBeDefined();
    const badgeInsert = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO badges')
    );
    expect(badgeInsert).toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('treats a unique-violation race on the identity hash as a duplicate', async () => {
    const uniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "idx_users_didit_identity_hash"'),
      { code: '23505' }
    );
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(uniqueViolation);
    const payload = {
      event_id: 'didit-race',
      session_id: 'didit-race-session',
      status: 'Approved',
      created_at: Math.floor(Date.now() / 1000),
      decision: {
        id_verifications: [{
          full_name: 'Jane Doe',
          document_type: 'passport',
          document_number: 'X123456',
          date_of_birth: '1990-04-01',
        }],
      },
    };

    const response = await postSignedDidit(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    const duplicateMark = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("didit_status = 'duplicate'")
    );
    expect(duplicateMark).toBeDefined();
    const badgeInsert = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO badges')
    );
    expect(badgeInsert).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('logs the inner error with webhook context when the database fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection terminated'));
    const payload = {
      event_id: 'didit-db-fail',
      session_id: 'didit-db-session',
      status: 'Approved',
      created_at: Math.floor(Date.now() / 1000),
    };

    const response = await postSignedDidit(payload);

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[Didit] Webhook handler failed',
      expect.objectContaining({
        error: 'connection terminated',
        stack: expect.stringContaining('Error: connection terminated'),
        eventId: 'didit-db-fail',
        providerRefId: 'didit-db-session',
      })
    );
  });
});
