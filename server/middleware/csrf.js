const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// CSRF token middleware for protecting against Cross-Site Request Forgery attacks
//
// For SPA applications:
// - CSRF tokens are stored in Redis (with in-memory fallback for single-instance dev)
// - Tokens are validated on all state-changing operations (POST/PUT/DELETE)
// - SameSite cookies provide an additional layer of protection
//
// The CSRF token is generated once per session and reused for all requests.
// Redis key: csrf:<userId>  (TTL = TOKEN_EXPIRY_SECS)

const TOKEN_LENGTH      = 32;
const TOKEN_EXPIRY_SECS = 24 * 60 * 60; // 24 hours
const REDIS_PREFIX      = 'csrf:';

// ── Redis client (optional) ──────────────────────────────────────────────────
// Shared client from utils/redis.js; null when Redis is not configured.
const redisClient = require('../utils/redis');
const { createTtlCache } = require('../utils/processState');
if (!redisClient) {
  logger.warn('CSRF: Redis unavailable — falling back to in-memory store. Not suitable for multi-instance deployments.');
}

// In-memory fallback (single-instance only). V2-P1-06: TTL-bounded via the
// shared process-state contract so entries expire exactly like the Redis EX.
// The cache itself exposes no key enumeration, so a side index tracks the
// keys it holds (bounded by the cache's own maxEntries). Entries whose TTL
// lapsed are pruned when scanned: cache.get deletes them on read.
const rawTokenMap = createTtlCache({
  name: 'csrf-fallback',
  ttlMs: TOKEN_EXPIRY_SECS * 1000,
  maxEntries: 50000,
});
const fallbackKeyIndex = new Set();
const tokenMap = {
  set(key, value) {
    fallbackKeyIndex.add(key);
    rawTokenMap.set(key, value);
  },
  get(key) {
    const value = rawTokenMap.get(key);
    if (value === undefined) fallbackKeyIndex.delete(key);
    return value;
  },
  delete(key) {
    fallbackKeyIndex.delete(key);
    rawTokenMap.delete(key);
  },
  keysWithPrefix(prefix) {
    const out = [];
    for (const key of fallbackKeyIndex) {
      if (!key.startsWith(prefix)) continue;
      if (rawTokenMap.get(key) === undefined) fallbackKeyIndex.delete(key);
      else out.push(key);
    }
    return out;
  },
};

// ── Storage helpers ──────────────────────────────────────────────────────────
// Key scheme (session-scoped CSRF, recommendation track 8):
//   session key: csrf:<userId>:<sid>   (one token per login session)
//   legacy key:  csrf:<userId>         (pre-scoping tokens only)
// A CSRF token issued under session A's sid never validates for session
// B's requests, even for the same user. The sid is stable across
// access-token rotation (it lives on the session row and is copied on
// refresh), so rotation never invalidates the client's token.
// Legacy fallback: access tokens minted before session scoping carry no
// sid. Those requests keep validating against the legacy per-user key
// until their first refresh mints a sid, bounded by the 15-minute access
// lifetime. The fallback is no weaker than the pre-scoping behavior and
// disappears on its own; it is NOT a permanent second scheme.

function sessionKey(userId, sid) {
  return sid ? `${REDIS_PREFIX}${userId}:${sid}` : `${REDIS_PREFIX}${userId}`;
}

function legacyKey(userId) {
  return `${REDIS_PREFIX}${userId}`;
}

async function storeToken(userId, token, sid) {
  const key = sessionKey(userId, sid);
  if (redisClient) {
    await redisClient.set(key, token, 'EX', TOKEN_EXPIRY_SECS);
  } else {
    tokenMap.set(key, token);
  }
}

async function fetchToken(userId, sid) {
  const key = sessionKey(userId, sid);
  if (redisClient) {
    return redisClient.get(key);
  }
  const token = tokenMap.get(key);
  return token === undefined ? null : token;
}

async function deleteToken(userId, sid) {
  const key = sessionKey(userId, sid);
  if (redisClient) {
    await redisClient.del(key);
  } else {
    tokenMap.delete(key);
  }
}

// Delete every session-scoped key for a user plus the legacy key. Redis
// uses SCAN (never KEYS in production); the in-memory fallback scans its
// own key index, pruning entries whose TTL already lapsed.
async function deleteAllTokens(userId) {
  const prefix = `${REDIS_PREFIX}${userId}:`;
  if (redisClient) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length) await redisClient.del(...keys);
    } while (cursor !== '0');
    await redisClient.del(legacyKey(userId));
  } else {
    for (const key of tokenMap.keysWithPrefix(prefix)) tokenMap.delete(key);
    tokenMap.delete(legacyKey(userId));
  }
}

// ── Core logic ───────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

// `sid` selects the session key; omitted/ null keeps the legacy per-user
// key for pre-scoping tokens (see the fallback note above).
async function getOrGenerateToken(userId, sid) {
  const existing = await fetchToken(userId, sid);
  if (existing) return existing;
  const token = generateToken();
  await storeToken(userId, token, sid);
  return token;
}

async function validateToken(userId, token, sid) {
  const stored = await fetchToken(userId, sid);
  if (!stored) return false;
  try {
    // Constant-time comparison to prevent timing attacks.
    // Both buffers must be equal length; timingSafeEqual throws otherwise.
    return crypto.timingSafeEqual(
      Buffer.from(stored),
      Buffer.from(token)
    );
  } catch {
    return false;
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────

// Attach CSRF token to every authenticated response so the client can read it.
// The token is bound to the presented session (req.csrfSid, set by
// parseAuthIdentity from the verified access token); a token-less request
// (legacy pre-scoping token) falls back to the per-user key.
async function attachCsrfToken(req, res, next) {
  if (!req.user?.id) return next();
  try {
    const token = await getOrGenerateToken(req.user.id, req.csrfSid || null);
    res.set('X-CSRF-Token', token);
    req.csrfToken = token;
  } catch (err) {
    logger.error('CSRF attachCsrfToken error', { message: err.message });
  }
  next();
}

function hasAccessCookie(req) {
  return /(?:^|;\s*)oxsteed_access=/.test(String(req.headers.cookie || ''));
}

// Auth audit item 16: the impersonation exemption must rest on a
// VERIFIED bearer, not a decoded claim. jwt.decode performs no signature
// check, so a forged impersonation claim used to skip the CSRF check
// (downstream authenticate still rejected the forged token, but the
// exemption itself was unverified). An unverifiable token (wrong secret,
// expired, unconfigured JWT_SECRET) now fails closed: the CSRF check
// applies. A valid impersonation session still exempts exactly as before.
function bearerImpersonates(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return Boolean(decoded && decoded.impersonation === true);
  } catch {
    return false;
  }
}

// Validate CSRF token on all state-changing requests.
async function validateCsrfToken(req, res, next) {
  // Skip in test environment
  if (process.env.NODE_ENV === 'test') return next();

  // Safe methods are exempt
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Bearer-only requests are exempt: a cross-site form cannot set
  // Authorization. An impersonation bearer also takes precedence over the
  // access cookie in authenticate, so that request is bearer-authenticated.
  // A normal Bearer header must not exempt a request that still carries
  // oxsteed_access: authenticate prefers that cookie, and skipping CSRF
  // would let the cookie session run without a token.
  // Identity comes from parseAuthIdentity, mounted before this middleware.
  // Requests with no valid session still skip: there is no session to
  // protect, and route-level authenticate rejects them downstream.
  if (req.headers.authorization?.startsWith('Bearer ') && (!hasAccessCookie(req) || bearerImpersonates(req))) {
    return next();
  }

  // Unauthenticated requests have no session token to validate against.
  if (!req.user?.id) return next();

  const token = req.headers['x-csrf-token'] || req.body?._csrf;

  if (!token) {
    return res.status(403).json({
      error: 'CSRF token missing',
      message: 'State-changing requests require X-CSRF-Token header',
    });
  }

  try {
    const valid = await validateToken(req.user.id, token, req.csrfSid || null);
    if (!valid) {
      return res.status(403).json({
        error: 'CSRF token invalid',
        message: 'Token is invalid or expired',
      });
    }
  } catch (err) {
    logger.error('CSRF validateCsrfToken error', { message: err.message });
    return res.status(403).json({
      error: 'CSRF token invalid',
      message: 'Token format is invalid',
    });
  }

  next();
}

async function invalidateToken(userId) {
  await deleteToken(userId, null);
}

// Invalidate exactly one session's token. With a sid this deletes only
// that session's key, so concurrent sessions for the same user keep
// working; without one (legacy pre-scoping token) it deletes the legacy
// per-user key, matching the previous behavior.
async function invalidateSessionToken(userId, sid) {
  await deleteToken(userId, sid || null);
}

// Invalidate every CSRF token for a user: all session keys plus the
// legacy key. Used by force-logout, which terminates every session.
async function invalidateAllTokens(userId) {
  await deleteAllTokens(userId);
}

// Issue the session's CSRF token on an auth response (login, 2FA
// completion, registration, passkey login, refresh). Auth responses run
// before any authenticated follow-up, so this closes the stale-token gap
// for clients that re-capture X-CSRF-Token from responses: a client
// holding a previous session's token picks up the new session's token
// from the login response itself instead of failing its first POST.
// Never throws: a CSRF-store outage must not turn login/refresh into
// a 500 (the tokens themselves are unaffected), and handler test doubles
// may lack res.set. The next authenticated response re-issues via
// attachCsrfToken if this write is skipped.
async function issueSessionCsrf(res, userId, sid) {
  try {
    const token = await getOrGenerateToken(userId, sid || null);
    if (typeof res.set === 'function') res.set('X-CSRF-Token', token);
    else if (typeof res.setHeader === 'function') res.setHeader('X-CSRF-Token', token);
  } catch (err) {
    logger.warn('CSRF issueSessionCsrf failed', { message: err.message });
  }
}

module.exports = {
  attachCsrfToken,
  validateCsrfToken,
  invalidateToken,
  invalidateSessionToken,
  invalidateAllTokens,
  issueSessionCsrf,
  getOrGenerateToken,
  validateToken,
};
