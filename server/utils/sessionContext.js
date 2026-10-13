'use strict';

// Review P3-1125: sessions record where and when they were last used so the
// session list is meaningful. Never throws: losing context must not break login.
const crypto = require('crypto');
const logger = require('./logger');
const { REFRESH_COOKIE_NAME } = require('./authCookies');

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hashAccessToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function clientUserAgent(req) {
  const ua = req?.headers?.['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : null;
}

async function recordSessionContext(db, hashedRefresh, req) {
  try {
    await db.query(
      `UPDATE sessions
          SET last_used_at = NOW(),
              ip_address = COALESCE($2, ip_address),
              user_agent = COALESCE($3, user_agent)
        WHERE refresh_token = $1`,
      [hashedRefresh, req?.ip ? String(req.ip).slice(0, 64) : null, clientUserAgent(req)]
    );
  } catch (err) {
    logger.warn('Failed to record session context', { error: err.message });
  }
}

function currentRefreshHash(req) {
  const header = req?.headers?.cookie;
  let token = null;
  if (typeof header === 'string') {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > -1 && part.slice(0, idx).trim() === REFRESH_COOKIE_NAME) {
        token = decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
  }
  return token ? hashRefreshToken(token) : null;
}

module.exports = { recordSessionContext, currentRefreshHash, hashRefreshToken, hashAccessToken };
