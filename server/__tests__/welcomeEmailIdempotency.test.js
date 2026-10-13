'use strict';

const fs = require('fs');
const path = require('path');

test('welcome email idempotency key includes the account creation timestamp', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../utils/email.js'), 'utf8');
  expect(source).toContain('const welcomeGeneration = new Date(createdAt).toISOString();');
  expect(source).toContain("`welcome:${user.id}:${welcomeGeneration}${nonce ? `:${nonce}` : ''}`");
});

test('welcome email supports an explicit re-send without weakening duplicate protection', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../utils/email.js'), 'utf8');
  // Explicit re-send opts out via forceResend or a caller-supplied nonce...
  expect(source).toContain('forceResend');
  expect(source).toContain('resendNonce');
  // ...which salts the idempotency key with a per-request nonce.
  expect(source).toContain('const nonce = forceResend');
});

test('sendWelcomeEmail salts the idempotency key only when a re-send is requested', async () => {
  // NOTE: __tests__/setup.js mocks ../utils/email globally; requireActual
  // bypasses the mock so this exercises the real idempotency-key logic.
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = jest.fn(async (url, opts) => {
    seen.push(opts.headers['Idempotency-Key']);
    return { ok: true, json: async () => ({ id: 'msg_1' }) };
  });
  process.env.RESEND_API_KEY = 're_test_key_for_welcome_idempotency';
  try {
    const emailUtil = jest.requireActual('../utils/email');
    const user = { id: 42, email: 'new.user@example.com', first_name: 'New', created_at: '2026-10-13T10:00:00.000Z' };

    await emailUtil.sendWelcomeEmail(user, 'en');
    await emailUtil.sendWelcomeEmail(user, 'en');
    // Same key on both default calls: provider dedupes, no double send.
    expect(seen[0]).toBe('welcome:42:2026-10-13T10:00:00.000Z');
    expect(seen[1]).toBe(seen[0]);

    await emailUtil.sendWelcomeEmail(user, 'en', { forceResend: true });
    await emailUtil.sendWelcomeEmail(user, 'en', { resendNonce: 'admin-resend-1' });
    // Explicit re-sends carry a distinct per-request nonce.
    expect(seen[2]).toMatch(/^welcome:42:2026-10-13T10:00:00\.000Z:.+/);
    expect(seen[3]).toBe('welcome:42:2026-10-13T10:00:00.000Z:admin-resend-1');
    expect(new Set(seen).size).toBe(3);
  } finally {
    if (realFetch === undefined) delete global.fetch;
    else global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});
