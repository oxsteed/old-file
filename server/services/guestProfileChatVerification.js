'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { sendOTPEmail } = require('../utils/email');
const logger = require('../utils/logger');

const CODE_TTL_MINUTES = 15;
const TOKEN_TTL_HOURS = 24;
const HISTORY_ACCESS_CODE_TTL_DAYS = 30;
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

function randomHistoryAccessCode() {
  return crypto.randomBytes(9).toString('hex').toUpperCase();
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.replace(/^(.{1,2}).+(@.*)$/, '$1***$2');
}

function generateGuestToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isGuestProfileChatSchemaError(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return ['42P01', '42703', '23502', '23514'].includes(code)
    && /guest_profile_chat_(inbound|verifications)/i.test(message);
}

function buildGuestChatUnavailableError(cause) {
  const error = new Error(
    'Guest chat verification is not ready on this deployment. Please sign in to message this helper.',
  );
  error.status = 503;
  error.code = 'guest_chat_unavailable';
  error.databaseCode = cause?.code || null;
  return error;
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
 * and destination is helper or business (provider side of the dock).
 */
function canEnterLiveMode({
  destination = 'helper',
  providerOnline = false,
  userId = null,
  verifiedGuest = null,
} = {}) {
  if (destination !== 'helper' && destination !== 'business') return false;
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

async function sendVerificationCode(sessionId, email, name, db = pool, language = 'en') {
  const code = randomCode();
  const accessCode = randomHistoryAccessCode();
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

  await db.query(
    `UPDATE guest_profile_chat_inbound
        SET guest_history_access_code_hash = $2,
            guest_history_access_code_expires_at = NOW() + ($3 || ' days')::interval,
            guest_history_access_code_used_at = NULL
      WHERE id = $1`,
    [sessionId, hash(accessCode), String(HISTORY_ACCESS_CODE_TTL_DAYS)]
  );

  const result = await sendOTPEmail(email, code, language, {
    accessCode,
    accessCodeExpiresDays: HISTORY_ACCESS_CODE_TTL_DAYS,
  });
  if (result && result.success === false) {
    const deliveryError = new Error(
      result.error === 'Email not configured'
        ? 'Guest verification email is not configured. Please sign in to message this helper.'
        : 'Guest verification email could not be delivered. Please try again.',
    );
    deliveryError.status = 503;
    deliveryError.code = 'guest_email_delivery_unavailable';
    deliveryError.deliveryReason = result.error || 'unknown';
    throw deliveryError;
  }
  logger.info('guest profile chat OTP sent', {
    sessionId,
    email: maskEmail(email),
    guestName: name,
  });
  return { code, accessCode };
}

async function startGuestVerification({ helperId, businessId, guestName, guestEmail, language = 'en' }) {
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
      `SELECT id, guest_verified_at, guest_history_access_code_expires_at
       FROM guest_profile_chat_inbound
       WHERE helper_id = $1
         AND (($2::int IS NULL AND business_id IS NULL) OR business_id = $2)
         AND lower(guest_email) = $3
         AND claimed_user_id IS NULL
         AND (
           (guest_verified_at IS NULL AND created_at > NOW() - INTERVAL '24 hours')
           OR (guest_verified_at IS NOT NULL AND guest_history_access_code_expires_at > NOW())
         )
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [resolvedHelperId, resolvedBusinessId, email]
    );

    let sessionId;
    let hasPreviousConversation = false;
    let previousHistoryExpired = false;
    if (existing.rows.length) {
      sessionId = existing.rows[0].id;
      hasPreviousConversation = Boolean(existing.rows[0].guest_verified_at);
      await client.query(
        `UPDATE guest_profile_chat_inbound
         SET guest_name = $2, verification_status = 'pending'
         WHERE id = $1`,
        [sessionId, name]
      );
    } else {
      const expired = await client.query(
        `SELECT id FROM guest_profile_chat_inbound
         WHERE helper_id = $1
           AND (($2::int IS NULL AND business_id IS NULL) OR business_id = $2)
           AND lower(guest_email) = $3
           AND guest_verified_at IS NOT NULL
           AND claimed_user_id IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [resolvedHelperId, resolvedBusinessId, email]
      );
      previousHistoryExpired = expired.rows.length > 0;
      const inserted = await client.query(
        `INSERT INTO guest_profile_chat_inbound
           (helper_id, business_id, guest_name, guest_email, message, verification_status,
            helper_response_deadline)
         VALUES ($1, $2, $3, $4, NULL, 'pending', NOW() + ($5 || ' minutes')::interval)
         RETURNING id`,
        // The default waiting_for_helper state requires a deadline even before OTP verification.
        [resolvedHelperId, resolvedBusinessId, name, email, String(CODE_TTL_MINUTES)]
      );
      sessionId = inserted.rows[0].id;
    }

    await sendVerificationCode(sessionId, email, name, client, language);
    const access = await client.query(
      `SELECT guest_history_access_code_expires_at
         FROM guest_profile_chat_inbound WHERE id = $1`,
      [sessionId],
    );
    await client.query('COMMIT');

    return {
      sessionId,
      verificationRequired: true,
      emailMasked: maskEmail(email),
      expiresInSeconds: CODE_TTL_MINUTES * 60,
      helperId: resolvedHelperId,
      businessId: resolvedBusinessId,
      accessCodeRequired: hasPreviousConversation,
      previousHistoryExpired,
      historyAccessExpiresAt: access.rows[0]?.guest_history_access_code_expires_at || null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isGuestProfileChatSchemaError(err)) {
      logger.error('guest profile chat verification schema is unavailable', {
        error: err.message,
        code: err.code,
        migrationHint: 'Apply 085_allow_guest_contact_and_guest_chat.sql, 532_guest_profile_chat_verification.sql, and 544_profile_chat_idempotency.sql',
      });
      throw buildGuestChatUnavailableError(err);
    }
    logger.error('startGuestVerification failed', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

async function verifyGuestCode({ sessionId, guestEmail, code, accessCode = '' }) {
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
      `SELECT id, helper_id, business_id, guest_email, guest_verified_at,
              guest_history_access_code_hash, guest_history_access_code_expires_at
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

    if (session.guest_verified_at) {
      const suppliedAccessCode = String(accessCode || '').trim().toUpperCase();
      const accessValid = suppliedAccessCode
        && session.guest_history_access_code_expires_at
        && new Date(session.guest_history_access_code_expires_at).getTime() > Date.now()
        && hashesMatch(hash(suppliedAccessCode), session.guest_history_access_code_hash);
      if (!accessValid) {
        await client.query('ROLLBACK');
        const err = new Error('Enter the guest chat access code from your email to reopen this conversation');
        err.status = 401;
        err.code = 'invalid_access_code';
        throw err;
      }
    }

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
           verification_status = 'verified',
           helper_response_deadline = CASE WHEN session_status = 'waiting_for_helper'
             THEN NOW() + INTERVAL '5 minutes' ELSE helper_response_deadline END
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
      historyAccessExpiresAt: session.guest_history_access_code_expires_at || null,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function resendGuestCode({ sessionId, guestEmail, language = 'en' }) {
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

  await sendVerificationCode(sessionId, email, rows[0].guest_name, pool, language);
  return {
    sessionId,
    emailMasked: maskEmail(email),
    expiresInSeconds: CODE_TTL_MINUTES * 60,
  };
}

/** Invalidate guest history codes as soon as the matching email becomes an account. */
async function invalidateGuestHistoryAccessCodesForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return 0;
  const result = await pool.query(
    `UPDATE guest_profile_chat_inbound
        SET guest_history_access_code_used_at = NOW(),
            guest_history_access_code_expires_at = NOW()
      WHERE lower(guest_email) = $1
        AND claimed_user_id IS NULL`,
    [normalized],
  );
  return result.rowCount || 0;
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
  HISTORY_ACCESS_CODE_TTL_DAYS,
  MAX_ATTEMPTS,
  hash,
  hashesMatch,
  normalizeEmail,
  isValidEmail,
  maskEmail,
  randomCode,
  randomHistoryAccessCode,
  generateGuestToken,
  tokenMatchesProfile,
  canEnterLiveMode,
  startGuestVerification,
  verifyGuestCode,
  resendGuestCode,
  invalidateGuestHistoryAccessCodesForEmail,
  loadVerifiedGuestSession,
  extractGuestAuth,
  sendVerificationCode,
};
