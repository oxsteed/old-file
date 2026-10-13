'use strict';

// Review P3-1107 (code side): behind Cloudflare, a request that reaches the
// origin directly can forge X-Forwarded-For and rotate req.ip past every
// IP-keyed limiter. When ORIGIN_SHARED_SECRET is set, each request must carry
// the secret header that a Cloudflare transform rule adds (default
// X-Origin-Auth). Health checks are exempt. Unset means no lock (local/dev).
const crypto = require('crypto');

const EXEMPT_PATHS = new Set(['/health', '/healthz', '/readyz', '/api/health', '/api/health/deep']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createOriginLock({
  secret = process.env.ORIGIN_SHARED_SECRET,
  header = process.env.ORIGIN_SHARED_SECRET_HEADER || 'x-origin-auth',
} = {}) {
  if (!secret) return (_req, _res, next) => next();
  const name = String(header).toLowerCase();
  return function originLock(req, res, next) {
    if (EXEMPT_PATHS.has(req.path)) return next();
    const provided = req.headers[name];
    if (typeof provided === 'string' && safeEqual(provided, secret)) return next();
    return res.status(403).json({ error: 'Forbidden', code: 'origin_locked' });
  };
}

module.exports = { createOriginLock, EXEMPT_PATHS };
