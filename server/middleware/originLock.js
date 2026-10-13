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

module.exports = { createOriginLock, assertOriginLockBoot, EXEMPT_PATHS };

// Review P3-13-F16: fail closed at boot in production. When the origin is
// directly reachable, X-Forwarded-For is forgeable and every IP-keyed rate
// limiter can be rotated past. createOriginLock() above only protects when
// ORIGIN_SHARED_SECRET is set (a Cloudflare transform rule adds the header),
// so booting production without it silently disables that protection.
// Throws in production without the secret unless the operator explicitly opts
// out with ORIGIN_LOCK_DISABLED=true. Separated from index.js for testing.
function assertOriginLockBoot({ env = process.env } = {}) {
  const isProduction = (env.NODE_ENV || 'production') === 'production';
  if (isProduction && !env.ORIGIN_SHARED_SECRET && env.ORIGIN_LOCK_DISABLED !== 'true') {
    const err = new Error(
      'ORIGIN_SHARED_SECRET is not set in production. Without it, the origin ' +
      'accepts direct traffic with forgeable X-Forwarded-For, defeating IP ' +
      'rate limiting. Set ORIGIN_SHARED_SECRET (and the Cloudflare transform ' +
      'rule that sends it), or set ORIGIN_LOCK_DISABLED=true to explicitly ' +
      'accept the risk.'
    );
    err.code = 'origin_lock_not_configured';
    throw err;
  }
}
