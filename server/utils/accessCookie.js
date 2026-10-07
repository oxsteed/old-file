'use strict';

// Shared helpers for reading the httpOnly `oxsteed_access` cookie outside the
// Express auth middleware (Socket.IO handshakes).
//
// - readAccessCookie never throws. A malformed percent-encoding such as
//   `oxsteed_access=%E0` used to raise a URIError inside async Socket.IO
//   middleware, which surfaced as an unhandledRejection and terminated the
//   process (pre-auth DoS).
// - isCookieAuthOriginAllowed guards cookie-based socket auth against
//   cross-site WebSocket hijacking. Socket.IO's `cors.origin` does not apply to
//   the WebSocket transport, so the handshake Origin is checked here. A
//   missing Origin is allowed: browsers always send Origin on cross-origin
//   requests (and on every WebSocket upgrade), so its absence means a
//   same-origin polling request or a non-browser client, neither of which is a
//   CSWSH vector.

const ACCESS_COOKIE_NAME = 'oxsteed_access';
const MAX_COOKIE_VALUE_LENGTH = 8192;
const COOKIE_PATTERN = new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE_NAME}=([^;]+)`);

function readAccessCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null;
  const match = cookieHeader.match(COOKIE_PATTERN);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw || raw.length > MAX_COOKIE_VALUE_LENGTH) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding: treat as absent rather than throwing.
    return null;
  }
}

function isLoopbackOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || '');
}

function isCookieAuthOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  // No allowlist wired (unit tests / legacy callers): keep prior behaviour.
  if (!Array.isArray(allowedOrigins)) return true;
  if (allowedOrigins.includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && isLoopbackOrigin(origin);
}

/**
 * Resolve the access token for a Socket.IO handshake. The explicit auth
 * payload (impersonation sessions, native clients) wins; otherwise the
 * httpOnly cookie is used, but only from an allowed Origin.
 */
function resolveSocketAccessToken(socket, { allowedOrigins } = {}) {
  const handshake = socket?.handshake || {};
  const explicit = handshake.auth?.token;
  if (typeof explicit === 'string' && explicit) return { token: explicit, source: 'auth' };
  const cookieToken = readAccessCookie(handshake.headers?.cookie);
  if (!cookieToken) return { token: null, source: null };
  if (!isCookieAuthOriginAllowed(handshake.headers?.origin, allowedOrigins)) {
    return { token: null, source: 'cookie', rejected: 'origin_not_allowed' };
  }
  return { token: cookieToken, source: 'cookie' };
}

module.exports = {
  ACCESS_COOKIE_NAME,
  readAccessCookie,
  isCookieAuthOriginAllowed,
  resolveSocketAccessToken,
};
