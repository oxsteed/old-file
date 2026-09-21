'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { sendOTPEmail } = require('../utils/email');
const logger = require('../utils/logger');

const CODE_TTL_MINUTES = 15;
const TOKEN_TTL_HOURS = 24;
const MAX_ATTEMPTS = 5;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashesMatch(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.replace(/^(.{1,2}).+(@.*)$/, '$1***$2');
}

function generateGuestToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Bind guest session token to a specific helper (+ optional business). */
function tokenMatchesProfile(session, { helperId, businessId = null } = {}) {
  if (!session) return false;
  if (String(session.helper_id) !== String(helperId)) return false;
  const sessionBiz = session.business_id == null ? null : Number(session.business_id);
  const wantBiz = businessId == null || businessId === '' ? null : Number(businessId);
  if (sessionBiz == null && wantBiz == null) return true;
  return sessionBiz === wantBiz;
}

/**
 * Live routing gate for profile chat.
 * Authenticated users OR verified guests may go live when provider is online
 * and destination is helper.
 */
function canEnterLiveMode({
  destination = 'helper',
  providerOnline = false,
  userId = null,
  verifiedGuest = null,
} = {}) {
  if (destination !== 'helper') return false;
  if (!providerOnline) return false;
  if (userId) return true;
  return Boolean(verifiedGuest?.id && verifiedGuest?.guest_verified_at);
}

async function resolveHelperTargets({ helperId, businessId }) {
  let resolvedHelperId = helperId;
  let resolvedBusinessId = businessId ? parseInt(businessId, 10) || null : null;

  if (resolvedBusinessId) {
    const bizRes = await pool.query(
      `SELECT user_id FROM businesses WHERE id = $1 AND is_active = TRUE`,
      [resolvedBusinessId]
    );
    if (!bizRes.rows.length) {
      const err = new Error('Business not found');
      err.status = 404;
      err.code = 'not_found';
      throw err;
    }
    resolvedHelperId = bizRes.rows[0].user_id;
  }

  if (!resolvedHelperId) {
    const err = new Error('helperId or businessId is required');
    err.status = 400;
    err.code = 'validation_failed';
    throw err;
  }

  return { resolvedHelperId, resolvedBusinessId };
}

async function assertGuestContactAllowed(helperId) {
  const gate = await pool.query(
    `SELECT COALESCE(hp.allow_guest_contact, TRUE) AS allow_guest_contact
     FROM users u
     JOIN helper_profiles hp ON hp.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [helperId]
  );
  if (!gate.rows.length) {
    const err = new Error('Helper not found');
    err.status = 404;
    err.code = 'not_found';
    throw err;
  }
  if (!gate.rows[0].allow_guest_contact) {
    const err = new Error('Guest messaging is disabled for this helper');
    err.status = 403;
    err.code = 'forbidden';
    throw err;
  }
}

async function sendVerificationCode(sessionId, email, name, db = pool) {
  const code = randomCode();
  await db.query(
    `UPDATE guest_profile_chat_verifications
     SET consumed_at = NOW()
     WHERE session_id = $1 AND consumed_at IS NULL`,
    [sessionId]
  );
  await db.query(
    `INSERT INTO guest_profile_chat_verifications
       (session_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
    [sessionId, email, hash(code), String(CODE_TTL_MINUTES)]
  );

  const result = await sendOTPEmail(email, code);
  if (result && result.success === false) {
    throw new Error('Verification email could not be delivered');
  }
  logger.info('guest profile chat OTP sent', {
    sessionId,
    email: maskEmail(email),
    guestName: name,
  });
  return code;
}

async function startGuestVerification({ helperId, businessId, guestName, guestEmail }) {
  const name = String(guestName || '').trim().slice(0, 200);
  const email = normalizeEmail(guestEmail);
  if (!name || !isValidEmail(email)) {
    const err = new Error('Valid name and email are required');
    err.status = 400;
    err.code = 'validation_failed';
    throw err;
  }

  const { resolvedHelperId, resolvedBusinessId } = await resolveHelperTargets({ helperId, businessId });
  await assertGuestContactAllowed(resolvedHelperId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM guest_profile_chat_inbound
       WHERE helper_id = $1
         AND (($2::int IS NULL AND business_id IS NULL) OR business_id = $2)
         AND lower(guest_email) = $3
         AND guest_verified_at IS NULL
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [resolvedHelperId, resolvedBusinessId, email]
    );

    let sessionId;
    if (existing.rows.length) {
      sessionId = existing.rows[0].id;
      await client.query(
        `UPDATE guest_profile_chat_inbound
         SET guest_name = $2, verification_status = 'pending'
         WHERE id = $1`,
        [sessionId, name]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO guest_profile_chat_inbound
           (helper_id, business_id, guest_name, guest_email, message, verification_status)
         VALUES ($1, $2, $3, $4, NULL, 'pending')
         RETURNING id`,
        [resolvedHelperId, resolvedBusinessId, name, email]
      );
      sessionId = inserted.rows[0].id;
    }

    await sendVerificationCode(sessionId, email, name, client);
    await client.query('COMMIT');

    return {
      sessionId,
      verificationRequired: true,
      emailMasked: maskEmail(email),
      expiresInSeconds: CODE_TTL_MINUTES * 60,
      helperId: resolvedHelperId,
      businessId: resolvedBusinessId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('startGuestVerification failed', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

async function verifyGuestCode({ sessionId, guestEmail, code }) {
  const email = normalizeEmail(guestEmail);
  const otp = String(code || '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    const err = new Error('Enter the six-digit code sent by email');
    err.status = 400;
    err.code = 'validation_failed';
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionRes = await client.query(
      `SELECT id, helper_id, business_id, guest_email, guest_verified_at
       FROM guest_profile_chat_inbound
       WHERE id = $1 AND lower(guest_email) = $2
       FOR UPDATE`,
      [sessionId, email]
    );
    if (!sessionRes.rows.length) {
      await client.query('ROLLBACK');
      const err = new Error('The verification code is invalid or expired');
      err.status = 401;
      err.code = 'invalid_code';
      throw err;
    }
    const session = sessionRes.rows[0];

    const { rows } = await client.query(
      `SELECT id, code_hash FROM guest_profile_chat_verifications
       WHERE session_id = $1 AND email = $2 AND consumed_at IS NULL
         AND expires_at > NOW() AND attempts < $3
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [sessionId, email, MAX_ATTEMPTS]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      const err = new Error('The verification code is invalid or expired');
      err.status = 401;
      err.code = 'invalid_code';
      throw err;
    }

    const verificationId = rows[0].id;
    if (!hashesMatch(hash(otp), rows[0].code_hash)) {
      await client.query(
        `UPDATE guest_profile_chat_verifications SET attempts = attempts + 1 WHERE id = $1`,
        [verificationId]
      );
      await client.query('COMMIT');
      const err = new Error('The verification code is invalid or expired');
      err.status = 401;
      err.code = 'invalid_code';
      throw err;
    }

    const token = generateGuestToken();
    await client.query(
      `UPDATE guest_profile_chat_verifications SET consumed_at = NOW() WHERE id = $1`,
      [verificationId]
    );
    await client.query(
      `UPDATE guest_profile_chat_inbound
       SET guest_access_token_hash = $1,
           guest_token_expires_at = NOW() + ($2 || ' hours')::interval,
           guest_verified_at = COALESCE(guest_verified_at, NOW()),
           verification_status = 'verified'
       WHERE id = $3`,
      [hash(token), String(TOKEN_TTL_HOURS), sessionId]
    );
    await client.query('COMMIT');

    return {
      guestToken: token,
      sessionId,
      helperId: session.helper_id,
      businessId: session.business_id,
      expiresInSeconds: TOKEN_TTL_HOURS * 3600,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function resendGuestCode({ sessionId, guestEmail }) {
  const email = normalizeEmail(guestEmail);
  if (!isValidEmail(email)) {
    const err = new Error('Valid email is required');
    err.status = 400;
    err.code = 'validation_failed';
    throw err;
  }

  const { rows } = await pool.query(
    `SELECT id, guest_name, guest_verified_at
     FROM guest_profile_chat_inbound
     WHERE id = $1 AND lower(guest_email) = $2`,
    [sessionId, email]
  );
  if (!rows.length || rows[0].guest_verified_at) {
    const err = new Error('Unable to resend verification code');
    err.status = 400;
    err.code = 'resend_failed';
    throw err;
  }

  await sendVerificationCode(sessionId, email, rows[0].guest_name);
  return {
    sessionId,
    emailMasked: maskEmail(email),
    expiresInSeconds: CODE_TTL_MINUTES * 60,
  };
}

async function loadVerifiedGuestSession(token, sessionId) {
  if (!token || !sessionId) return null;
  const { rows } = await pool.query(
    `SELECT id, helper_id, business_id, guest_name, guest_email,
            guest_verified_at, guest_token_expires_at, verification_status
     FROM guest_profile_chat_inbound
     WHERE id = $1
       AND guest_access_token_hash = $2
       AND guest_token_expires_at > NOW()
       AND guest_verified_at IS NOT NULL`,
    [sessionId, hash(token)]
  );
  return rows[0] || null;
}

function extractGuestAuth(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Guest ')
    ? header.slice(6).trim()
    : String(req.headers['x-guest-profile-token'] || '').trim();
  const sessionId = String(
    req.headers['x-guest-session-id']
      || req.body?.guestSessionId
      || req.query?.guestSessionId
      || ''
  ).trim();
  return { token, sessionId };
}

module.exports = {
  CODE_TTL_MINUTES,
  TOKEN_TTL_HOURS,
  MAX_ATTEMPTS,
  hash,
  hashesMatch,
  normalizeEmail,
  isValidEmail,
  maskEmail,
  randomCode,
  generateGuestToken,
  tokenMatchesProfile,
  canEnterLiveMode,
  startGuestVerification,
  verifyGuestCode,
  resendGuestCode,
  loadVerifiedGuestSession,
  extractGuestAuth,
  sendVerificationCode,
};
