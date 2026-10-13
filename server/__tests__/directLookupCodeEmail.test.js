'use strict';

// Review P3-844/F02/F03/F19: the public quote lookup code is the only way the
// requester opens their quote. A failed send must answer 503 (never a silent
// drop), and the email must use the branded template with a text part.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const emailUtil = require('../utils/email');
const directController = require('../controllers/directController');

const QUOTE_ROW = {
  id: 7,
  public_reference: 'DQ-ABC123',
  email: 'cust@example.com',
  service_zip_code: '12345',
};

function mockDbForLookup() {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM quote_requests')) return { rows: [QUOTE_ROW] };
    if (sql.includes('FROM direct_quote_lookup_challenges')) return { rows: [] };
    if (sql.includes('INSERT INTO direct_quote_lookup_challenges')) {
      return { rows: [{ id: 1, challenge_token: 'tok123', code_expires_at: new Date(Date.now() + 900000).toISOString() }] };
    }
    return { rows: [] };
  });
}

function app() {
  const a = express();
  a.use(express.json());
  a.post('/public/lookup/send-code', directController.sendPublicLookupCode);
  return a;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  emailUtil.sendEmailOrThrow.mockResolvedValue({ success: true, id: 'email-test' });
});

test('lookup code email uses the branded template with a text part', async () => {
  mockDbForLookup();
  const res = await request(app())
    .post('/public/lookup/send-code')
    .send({ referenceId: 'DQ-ABC123', zipCode: '12345' });
  expect(res.status).toBe(200);
  expect(emailUtil.sendEmailOrThrow).toHaveBeenCalledTimes(1);
  const [args] = emailUtil.sendEmailOrThrow.mock.calls[0];
  expect(args.to).toBe('cust@example.com');
  expect(typeof args.html).toBe('string');
  expect(args.html.length).toBeGreaterThan(200);
  // Branded template always renders a text part (F19).
  expect(typeof args.text).toBe('string');
  expect(args.text.length).toBeGreaterThan(50);
  expect(args.text).toMatch(/verification code/i);
});

test('email delivery failure answers 503 instead of silently dropping the code', async () => {
  mockDbForLookup();
  emailUtil.sendEmailOrThrow.mockRejectedValueOnce(
    new emailUtil.EmailDeliveryError('Email not configured', 'email_not_configured')
  );
  const res = await request(app())
    .post('/public/lookup/send-code')
    .send({ referenceId: 'DQ-ABC123', zipCode: '12345' });
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('email_send_failed');
});
