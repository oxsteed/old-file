'use strict';

// Single source of truth for the web session cookies.
//
// - oxsteed_access: short-lived access JWT (15 min, matches JWT expiry). The
//   web client no longer keeps the access token in localStorage, so EVERY
//   endpoint that issues a session (login, 2FA, passkey, refresh, registration,
//   mode/role switch, internal-access login) must set this cookie.
// - oxsteed_rt: refresh token (7 or 30 days); read by /auth/refresh and
//   /auth/logout via getRefreshTokenFromRequest.
//
// Both are httpOnly + SameSite=Lax (+ Secure in production or when
// COOKIE_SECURE=true). JSON bodies keep carrying the tokens for native clients.

const ACCESS_COOKIE_NAME = 'oxsteed_access';
const REFRESH_COOKIE_NAME = 'oxsteed_rt';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;
const REFRESH_COOKIE_MAX_AGE_REMEMBER_S = 30 * 24 * 60 * 60;

function isCookieSecure() {
  return process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
}

function setAccessTokenCookie(res, accessToken) {
  if (!res || typeof res.cookie !== 'function' || !accessToken) return;
  res.cookie(ACCESS_COOKIE_NAME, accessToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isCookieSecure(),
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });
}

function setRefreshTokenCookie(res, refreshToken, { rememberMe = false, maxAgeMs = null } = {}) {
  if (!res || typeof res.cookie !== 'function' || !refreshToken) return;
  const fallback = (rememberMe ? REFRESH_COOKIE_MAX_AGE_REMEMBER_S : REFRESH_COOKIE_MAX_AGE_S) * 1000;
  // Review P1-112: refresh passes the session's remaining lifetime.
  const maxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? Math.min(maxAgeMs, REFRESH_COOKIE_MAX_AGE_REMEMBER_S * 1000)
    : fallback;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

function clearRefreshTokenCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'lax',
    path: '/',
  });
}

/** Set both session cookies for a freshly issued token pair. */
function setSessionCookies(res, tokens, { rememberMe = false } = {}) {
  if (!tokens) return;
  setAccessTokenCookie(res, tokens.accessToken);
  setRefreshTokenCookie(res, tokens.refreshToken, { rememberMe });
}

// Review P1-114: web clients authenticate with the httpOnly cookies and must
// not receive raw tokens in JSON (where XSS or localStorage could read them).
// Native apps opt in with `X-OxSteed-Client: ios|android|native`; requests
// with no Origin and no cookies (non-browser callers) also get the body tokens.
const NATIVE_CLIENTS = new Set(['ios', 'android', 'native', 'mobile']);
function wantsBodyTokens(req) {
  if (!req || typeof req.get !== 'function') return true;
  const client = String(req.get('X-OxSteed-Client') || '').trim().toLowerCase();
  if (NATIVE_CLIENTS.has(client)) return true;
  if (client === 'web') return false;
  return !req.get('Origin') && !req.get('Cookie');
}

/** Spread into a session JSON response: tokens for native callers only. */
function bodyTokens(req, tokens) {
  if (!tokens || !wantsBodyTokens(req)) return {};
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

module.exports = {
  wantsBodyTokens,
  bodyTokens,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ACCESS_COOKIE_MAX_AGE_MS,
  REFRESH_COOKIE_MAX_AGE_S,
  REFRESH_COOKIE_MAX_AGE_REMEMBER_S,
  isCookieSecure,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setSessionCookies,
};
