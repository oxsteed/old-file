'use strict';

// Security review F-16: every JWT this API mints shares one HMAC secret, so a
// verifier that only rejects a few known token kinds (MFA, refresh) accepts
// every other kind as a login. Access tokens therefore carry an explicit
// `typ: 'access'` claim, and every verifier admits a token ONLY when it has
// that type (an allow-list), never when it merely lacks a rejected marker.

const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TYPE = 'access';
const PASSKEY_LOGIN_TOKEN_TYPE = 'passkey_login';
const PASSKEY_LOGIN_AUDIENCE = 'oxsteed:passkey-login';

// Markers of tokens that are never access tokens, even if a future signer
// copied `typ: 'access'` onto them by mistake.
function hasNonAccessMarker(decoded) {
  return decoded.isMfaToken === true
    || decoded.isPasskeyToken === true
    || decoded.isInternalAccessToken === true
    || decoded.type === 'refresh'
    || decoded.aud !== undefined;
}

/**
 * True only for a decoded access token minted by generateTokens (normal
 * sessions, which always carry a session id) or by the impersonation
 * exchange (which always carries the impersonation jti and admin id).
 */
function isAccessTokenPayload(decoded) {
  if (!decoded || typeof decoded !== 'object') return false;
  if (decoded.typ !== ACCESS_TOKEN_TYPE) return false;
  if (hasNonAccessMarker(decoded)) return false;
  if (decoded.id === undefined || decoded.id === null || decoded.id === '') return false;
  if (decoded.impersonation === true) {
    return typeof decoded.jti === 'string' && decoded.jti.length > 0
      && decoded.impersonated_by !== undefined && decoded.impersonated_by !== null;
  }
  return typeof decoded.sid === 'string' && decoded.sid.length > 0;
}

class AccessTokenTypeError extends jwt.JsonWebTokenError {
  constructor() {
    super('Token is not an access token');
    this.name = 'JsonWebTokenError';
    this.code = 'not_access_token';
  }
}

/**
 * Verify signature, algorithm and expiry, then require an access token.
 * Throws jwt errors (JsonWebTokenError / TokenExpiredError) on failure.
 */
function verifyAccessToken(token, secret = process.env.JWT_SECRET) {
  if (!secret) throw new jwt.JsonWebTokenError('JWT secret is not configured');
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (!isAccessTokenPayload(decoded)) throw new AccessTokenTypeError();
  return decoded;
}

/** Non-throwing variant: the decoded access token, or null. */
function tryVerifyAccessToken(token, secret = process.env.JWT_SECRET) {
  if (!token || typeof token !== 'string') return null;
  try {
    return verifyAccessToken(token, secret);
  } catch {
    return null;
  }
}

module.exports = {
  ACCESS_TOKEN_TYPE,
  PASSKEY_LOGIN_TOKEN_TYPE,
  PASSKEY_LOGIN_AUDIENCE,
  AccessTokenTypeError,
  isAccessTokenPayload,
  verifyAccessToken,
  tryVerifyAccessToken,
};
