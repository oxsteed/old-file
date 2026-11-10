'use strict';

/**
 * Security review 2026-11-10 F-05: request bodies, capability tokens and
 * personal data must not reach Sentry or the request logs.
 */

const fs = require('fs');
const path = require('path');
const { scrubTelemetryEvent, scrubBreadcrumb } = require('../utils/telemetryPrivacy');
const { redactPath, redactUrlForTelemetry } = require('../utils/sensitiveUrl');
const logger = require('../utils/logger');

describe('capability tokens in URLs', () => {
  test.each([
    ['/api/businesses/invoices/public/inv_tok_ABC123', '/api/businesses/invoices/public/:redacted'],
    ['/api/food/orders/track/9f1c2e3d-1111-4111-8111-111111111111', '/api/food/orders/track/:redacted'],
    ['/api/broadcast-tracking/o/tok123', '/api/broadcast-tracking/o/:redacted'],
    ['/api/broadcast-tracking/c/tok123/2', '/api/broadcast-tracking/c/:redacted/2'],
    ['/api/broadcast-tracking/u/tok123', '/api/broadcast-tracking/u/:redacted'],
    ['/api/broadcast-tracking/p/tok123', '/api/broadcast-tracking/p/:redacted'],
    ['/api/notifications/email/unsubscribe/unsub-tok', '/api/notifications/email/unsubscribe/:redacted'],
    ['/api/consulting/feedback/sess-1/fb-tok', '/api/consulting/feedback/:redacted/:redacted'],
    ['/api/o/offer-tok', '/api/o/:redacted'],
    ['/api/shared-carts/share-tok/approve', '/api/shared-carts/:redacted/approve'],
    ['/api/auth/reset?token=abc&email=a@b.co', '/api/auth/reset'],
  ])('%s', (input, expected) => {
    expect(redactPath(input)).toBe(expected);
  });

  test('ordinary ids and slugs stay readable', () => {
    expect(redactPath('/api/jobs/123')).toBe('/api/jobs/123');
    expect(redactPath('/api/users/9f1c2e3d-1111-4111-8111-111111111111')).toBe('/api/users/9f1c2e3d-1111-4111-8111-111111111111');
    expect(redactPath('/api/learn/how-to-fix-a-leaky-faucet-fast')).toBe('/api/learn/how-to-fix-a-leaky-faucet-fast');
  });

  test('an unknown route with a random secret segment is still redacted', () => {
    expect(redactUrlForTelemetry('https://oxsteed.com/api/new/q7Zk2LmP9vXr4TbN8cWd?x=1'))
      .toBe('https://oxsteed.com/api/new/:redacted');
  });
});

describe('Sentry events', () => {
  const event = () => ({
    message: 'Login failed for jane@example.com',
    transaction: 'GET /api/businesses/invoices/public/inv_tok_ABC123',
    request: {
      url: 'https://oxsteed.com/api/auth/login?next=/x',
      method: 'POST',
      data: { email: 'jane@example.com', password: 'hunter2', totpCode: '123456' },
      cookies: { oxsteed_access: 'jwt' },
      query_string: 'token=abc',
      headers: { authorization: 'Bearer x', cookie: 'a=b', 'x-csrf-token': 'c', 'user-agent': 'UA' },
    },
    user: { id: 'u1', email: 'jane@example.com', ip_address: '1.2.3.4' },
    extra: { payout: { account_number: '000123456789', routing_number: '110000000' }, note: 'call +15551234567' },
    exception: { values: [{ value: 'PIN 4242424242424242 rejected for jane@example.com' }] },
  });

  test('bodies, cookies, query strings and unsafe headers are dropped', () => {
    const out = scrubTelemetryEvent(event());
    expect(out.request.data).toBe('[REDACTED]');
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.query_string).toBeUndefined();
    expect(out.request.url).toBe('https://oxsteed.com/api/auth/login');
    expect(out.request.headers).toEqual({ 'user-agent': 'UA' });
  });

  test('capability tokens, personal data and financial identifiers never survive', () => {
    const serialized = JSON.stringify(scrubTelemetryEvent(event()));
    for (const secret of ['inv_tok_ABC123', 'hunter2', 'jane@example.com', '000123456789', '110000000',
      '+15551234567', '4242424242424242', '1.2.3.4', 'Bearer x']) {
      expect(serialized).not.toContain(secret);
    }
    const out = scrubTelemetryEvent(event());
    expect(out.transaction).toBe('GET /api/businesses/invoices/public/:redacted');
    expect(out.user).toEqual({ id: 'u1' });
    expect(out.message).toBe('Login failed for ***@example.com');
  });

  test('breadcrumbs with URLs are redacted', () => {
    const crumb = scrubBreadcrumb({ category: 'http', data: { url: 'https://oxsteed.com/api/o/offer-tok?email=a@b.co', method: 'GET' } });
    expect(crumb.data.url).toBe('https://oxsteed.com/api/o/:redacted');
  });

  test('instrument.js disables request body capture and wires the scrubber everywhere', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'instrument.js'), 'utf8');
    expect(src).toMatch(/maxIncomingRequestBodySize: 'none'/);
    expect(src).toMatch(/data: false/);
    expect(src).toMatch(/query_string: false/);
    expect(src).toMatch(/beforeBreadcrumb/);
    expect(src).toMatch(/beforeSendTransaction/);
  });
});

describe('logger', () => {
  test('masks emails and phones and redacts financial keys', () => {
    const out = logger._sanitizeMeta({ to: 'jane@example.com', phone: '+1 555 123 4567', bank: { account_number: '123', iban: 'X' }, n: 5 });
    expect(out).toEqual({ to: '***@example.com', phone: '[phone…67]', bank: { account_number: '[REDACTED]', iban: '[REDACTED]' }, n: 5 });
  });

  test('request logs never contain a capability token or query string', () => {
    const writes = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    const spyErr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    try {
      const mw = logger.requestMiddleware();
      const handlers = {};
      // 500 so the line is emitted at the error level the test setup allows.
      const res = { statusCode: 500, on: (ev, fn) => { handlers[ev] = fn; } };
      mw({ method: 'GET', path: '/api/food/orders/track/trk-secret-1', originalUrl: '/api/food/orders/track/trk-secret-1?e=a@b.co', ip: '1.1.1.1' }, res, () => {});
      handlers.finish();
    } finally {
      spy.mockRestore();
      spyErr.mockRestore();
    }
    const line = writes.join('');
    expect(line).toContain('GET /api/food/orders/track/:redacted');
    expect(line).not.toContain('trk-secret-1');
    expect(line).not.toContain('a@b.co');
  });
});
