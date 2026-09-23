'use strict';

process.env.DIDIT_WEBHOOK_SECRET = 'test-didit-v3-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_didit_webhook';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
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
