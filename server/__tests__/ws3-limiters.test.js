/**
 * WS3 limiter hardening tests (audit findings M2, M3, M4, M28).
 *
 * Unit-style Jest tests with no live DB: the shared setup mocks pg/stripe/
 * ioredis, and REDIS_URL is unset so all limiters use the in-memory store.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const {
  getVerifiedBearerUserId,
  generalLimiter,
  authenticatedLimiter,
  discoverLimiter,
  discoverAuthLimiter,
} = require('../middleware/rateLimiter');
const { webhookRateLimit } = require('../middleware/webhookAuth');

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(payload, secret = JWT_SECRET, options = {}) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
}

function fakeReq(authorization) {
  return { headers: authorization ? { authorization } : {}, _verifiedBearer: undefined };
}

function testApp(limiter, method = 'get') {
  const app = express();
  app[method]('/t', limiter, (req, res) => res.json({ ok: true }));
  return app;
}

// ── M3: getVerifiedBearerUserId ─────────────────────────────────────────────
describe('M3 getVerifiedBearerUserId', () => {
  test('returns the user id for a valid HS256 JWT', () => {
    const token = signToken({ id: 42 });
    expect(getVerifiedBearerUserId(fakeReq(`Bearer ${token}`))).toBe(42);
  });

  test('returns null when no Authorization header is present', () => {
    expect(getVerifiedBearerUserId(fakeReq(null))).toBeNull();
  });

  test('returns null for a garbage Bearer token', () => {
    expect(getVerifiedBearerUserId(fakeReq('Bearer garbage'))).toBeNull();
  });

  test('returns null for a plausible-but-invalid token (wrong secret)', () => {
    const token = signToken({ id: 7 }, 'a-different-secret-that-is-long-enough');
    expect(getVerifiedBearerUserId(fakeReq(`Bearer ${token}`))).toBeNull();
  });

  test('returns null for an expired token', () => {
    const token = signToken({ id: 7 }, JWT_SECRET, { expiresIn: '-10s' });
    expect(getVerifiedBearerUserId(fakeReq(`Bearer ${token}`))).toBeNull();
  });

  test('returns null for a non-Bearer scheme', () => {
    const token = signToken({ id: 7 });
    expect(getVerifiedBearerUserId(fakeReq(`Basic ${token}`))).toBeNull();
  });

  test('returns null when the token has no id claim', () => {
    const token = signToken({ sub: 'someone' });
    expect(getVerifiedBearerUserId(fakeReq(`Bearer ${token}`))).toBeNull();
  });

  test('caches the verified result on the request (single verification)', () => {
    const token = signToken({ id: 99 });
    const req = fakeReq(`Bearer ${token}`);
    expect(getVerifiedBearerUserId(req)).toBe(99);
    expect(req._verifiedBearer).toBe(99);
    // Even if the header is swapped afterwards, the cached value wins.
    req.headers.authorization = 'Bearer garbage';
    expect(getVerifiedBearerUserId(req)).toBe(99);
  });
});

// ── M3: garbage Bearer tokens stay in the anonymous bucket ──────────────────
describe('M3 limiter skip behavior', () => {
  test('generalLimiter counts garbage Bearer tokens (RateLimit headers set)', async () => {
    const res = await request(testApp(generalLimiter)).get('/t').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('200');
  });

  test('generalLimiter skips verified Bearer tokens (no RateLimit headers)', async () => {
    const res = await request(testApp(generalLimiter))
      .get('/t')
      .set('Authorization', `Bearer ${signToken({ id: 1 })}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  test('authenticatedLimiter skips requests without a verified token', async () => {
    const res = await request(testApp(authenticatedLimiter)).get('/t');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  test('authenticatedLimiter counts verified Bearer tokens per user', async () => {
    const res = await request(testApp(authenticatedLimiter))
      .get('/t')
      .set('Authorization', `Bearer ${signToken({ id: 5 })}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('500');
  });

  test('discoverAuthLimiter skips garbage Bearer tokens', async () => {
    const res = await request(testApp(discoverAuthLimiter))
      .get('/t')
      .set('Authorization', 'Bearer plausible-but-invalid');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  test('discoverAuthLimiter counts verified Bearer tokens', async () => {
    const res = await request(testApp(discoverAuthLimiter))
      .get('/t')
      .set('Authorization', `Bearer ${signToken({ id: 9 })}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('200');
  });

  test('discoverLimiter 429s garbage Bearer tokens at the anonymous limit (40)', async () => {
    const app = testApp(discoverLimiter);
    let last;
    for (let i = 0; i < 41; i++) {
      last = await request(app).get('/t').set('Authorization', 'Bearer garbage');
    }
    // Before the M3 fix, a syntactic Bearer check would have skipped this
    // limiter entirely and routed the request to the 200-request auth bucket.
    expect(last.status).toBe(429);
    expect(last.body.error).toMatch(/Discover search rate limit exceeded/);
  }, 30000);
});

// ── M2: webhookRateLimit is a real limiter ───────────────────────────────────
describe('M2 webhookRateLimit', () => {
  test('is a real rate limiter: 600 req / 5 min, keyed per IP', async () => {
    const app = express();
    app.post('/w', webhookRateLimit, (req, res) => res.json({ ok: true }));
    const res = await request(app).post('/w').send('{}');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('600');
    expect(res.headers['ratelimit-policy']).toMatch(/600;w=300/);
  });

  test('does not alter the request body (raw bytes preserved for HMAC)', async () => {
    const app = express();
    app.post('/w', webhookRateLimit, express.raw({ type: 'application/json' }), (req, res) => {
      res.json({ isBuffer: Buffer.isBuffer(req.body), len: req.body.length });
    });
    const res = await request(app).post('/w').set('Content-Type', 'application/json').send('{"a":1}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isBuffer: true, len: 7 });
  });
});

// ── M4: TRUST_PROXY_HOPS parsing ────────────────────────────────────────────
// Loads the actual resolveTrustProxyHops() shipped in server/index.js and
// evaluates it against stubbed env values (requiring the full app module is
// not feasible in unit tests).
function loadResolveTrustProxyHops() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const match = src.match(/function resolveTrustProxyHops\(\) \{[^]*?\n\}/);
  if (!match) throw new Error('resolveTrustProxyHops not found in server/index.js');
  const factory = new Function('process', `${match[0]}\nreturn resolveTrustProxyHops();`);
  return (env) => factory({ env });
}

describe('M4 resolveTrustProxyHops', () => {
  const resolve = loadResolveTrustProxyHops();

  test('defaults to 2 hops (Cloudflare -> Coolify/Traefik -> app)', () => {
    expect(resolve({})).toBe(2);
  });

  test('honors TRUST_PROXY_HOPS when set to a valid number', () => {
    expect(resolve({ TRUST_PROXY_HOPS: '1' })).toBe(1);
    expect(resolve({ TRUST_PROXY_HOPS: '3' })).toBe(3);
    expect(resolve({ TRUST_PROXY_HOPS: '0' })).toBe(0);
  });

  test('falls back to 2 for non-numeric, empty, or negative values', () => {
    expect(resolve({ TRUST_PROXY_HOPS: 'abc' })).toBe(2);
    expect(resolve({ TRUST_PROXY_HOPS: '' })).toBe(2);
    expect(resolve({ TRUST_PROXY_HOPS: '-1' })).toBe(2);
    expect(resolve({ TRUST_PROXY_HOPS: '2.9' })).toBe(2); // parseInt truncates to 2
  });

  test('index.js sets trust proxy from the resolver (not a hardcoded 1)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(src).toMatch(/app\.set\('trust proxy', resolveTrustProxyHops\(\)\)/);
    expect(src).not.toMatch(/app\.set\('trust proxy', 1\)/);
    expect(src).not.toMatch(/Render reverse proxy/);
  });
});

// ── M28: strictLimiter on consulting /confirm-payment ────────────────────────
describe('M28 consultingPayment confirm-payment limiter', () => {
  test('strictLimiter runs before authenticate: 11th request gets 429', async () => {
    const consultingPaymentRoutes = require('../routes/consultingPayment');
    const app = express();
    app.use('/api/consulting', consultingPaymentRoutes);

    let last;
    for (let i = 0; i < 11; i++) {
      last = await request(app).post('/api/consulting/confirm-payment').send({});
    }
    // First 10 pass the limiter and fail auth (401); the 11th is rate limited.
    expect(last.status).toBe(429);
  }, 30000);

  test('the route source wires strictLimiter ahead of authenticate', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'consultingPayment.js'), 'utf8');
    expect(src).toMatch(/router\.post\('\/confirm-payment', strictLimiter, authenticate/);
  });
});

// ── M2 wiring: index.js mounts the limiter on all five webhook routes ───────
describe('M2 index.js webhook mounts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

  test.each([
    ['/api/webhooks', /app\.use\('\/api\/webhooks', webhookRateLimit, webhookRoutes\)/],
    ['/api/verification/webhooks/checkr', /app\.post\('\/api\/verification\/webhooks\/checkr', webhookRateLimit, express\.raw/],
    ['/api/verification/webhooks/identity', /app\.post\('\/api\/verification\/webhooks\/identity', webhookRateLimit, express\.raw/],
    ['/api/didit/webhook', /app\.post\('\/api\/didit\/webhook', webhookRateLimit, express\.raw/],
    ['/api/delivery/webhooks/telematics/:provider', /app\.post\('\/api\/delivery\/webhooks\/telematics\/:provider', webhookRateLimit, express\.raw/],
  ])('%s is mounted with webhookRateLimit before express.raw()', (_route, pattern) => {
    expect(src).toMatch(pattern);
  });

  test('/api/support/webhooks still uses channelWebhookLimiter (untouched)', () => {
    expect(src).toMatch(/app\.use\('\/api\/support\/webhooks', channelWebhookLimiter/);
  });
});
