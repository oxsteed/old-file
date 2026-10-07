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

function setRefreshTokenCookie(res, refreshToken, { rememberMe = false } = {}) {
  if (!res || typeof res.cookie !== 'function' || !refreshToken) return;
  const maxAge = (rememberMe ? REFRESH_COOKIE_MAX_AGE_REMEMBER_S : REFRESH_COOKIE_MAX_AGE_S) * 1000;
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

module.exports = {
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
