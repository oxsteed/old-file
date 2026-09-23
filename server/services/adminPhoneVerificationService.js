const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('./auditService');
const awsSmsProvider = require('./awsSmsProviderService');

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const ADMIN_COOLDOWN_MINUTES = 10;
const E164_RE = /^\+[1-9]\d{7,14}$/;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

function codesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function maskPhone(phoneNumber) {
  return `***-${String(phoneNumber).slice(-4)}`;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'validation_error';
  return error;
}

async function issueChallenge({ userId, adminId, reason, req }) {
  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 5 || trimmedReason.length > 500) {
    throw validationError('A reason between 5 and 500 characters is required.');
  }

  const targetResult = await pool.query(
    `SELECT id, role, is_active,
            COALESCE(NULLIF(phone_number, ''), NULLIF(phone, '')) AS phone_number
       FROM users
      WHERE id = $1`,
    [userId]
  );
  if (!targetResult.rows.length) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  const target = targetResult.rows[0];
  if (!target.is_active) {
    const error = new Error('Phone verification cannot be sent to an inactive account.');
    error.statusCode = 409;
    throw error;
  }
  if (['admin', 'super_admin'].includes(target.role)) {
    const error = new Error('Phone verification cannot be triggered for an admin account.');
    error.statusCode = 403;
    throw error;
  }

  const phoneNumber = String(target.phone_number || '').trim();
  if (!E164_RE.test(phoneNumber)) {
    throw validationError('The user must have a valid E.164 phone number before a code can be sent.');
  }

  if (!awsSmsProvider.isEnabled()) {
    const error = new Error('AWS phone verification is disabled until the SMS service is configured.');
    error.statusCode = 503;
    error.code = 'aws_sms_disabled';
    throw error;
  }

  const config = awsSmsProvider.getConfiguration();
  if (!config.region || !config.originationIdentity) {
    const error = new Error('AWS phone verification needs an SMS region and origination identity.');
    error.statusCode = 503;
    error.code = 'aws_sms_not_configured';
    throw error;
  }

  const recentResult = await pool.query(
    `SELECT id
       FROM admin_phone_verification_challenges
      WHERE user_id = $1
        AND created_at > CURRENT_TIMESTAMP - ($2 * INTERVAL '1 minute')
        AND delivery_status IN ('pending', 'sent')
      LIMIT 1`,
    [userId, ADMIN_COOLDOWN_MINUTES]
  );
  if (recentResult.rows.length) {
    const error = new Error('A verification code was already sent recently. Please wait before sending another.');
    error.statusCode = 429;
    throw error;
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const challengeResult = await pool.query(
    `INSERT INTO admin_phone_verification_challenges
       (user_id, created_by_admin_id, phone_number, code_hash, reason, expires_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6 * INTERVAL '1 minute'))
     RETURNING id, expires_at`,
    [userId, adminId, phoneNumber, hashCode(code), trimmedReason, CODE_TTL_MINUTES]
  );
  const challenge = challengeResult.rows[0];

  try {
    const delivery = await awsSmsProvider.sendVerificationCode({ phoneNumber, code });
    await pool.query(
      `UPDATE admin_phone_verification_challenges
          SET delivery_status = 'sent', provider = $2, provider_message_id = $3
        WHERE id = $1`,
      [challenge.id, delivery.provider, delivery.messageId]
    );

    await logAdminAction({
      adminId,
      action: 'admin_phone_verification_code_sent',
      targetType: 'user',
      targetId: userId,
      description: trimmedReason,
      after: { provider: delivery.provider, phone_suffix: phoneNumber.slice(-4), challenge_id: challenge.id },
      req,
    });

    return {
      challengeId: challenge.id,
      maskedPhone: maskPhone(phoneNumber),
      expiresAt: challenge.expires_at,
      provider: delivery.provider,
    };
  } catch (error) {
    await pool.query(
      `UPDATE admin_phone_verification_challenges
          SET delivery_status = 'failed'
        WHERE id = $1`,
      [challenge.id]
    ).catch((updateError) => logger.warn('Failed to mark phone verification challenge failed', {
      challengeId: challenge.id,
      error: updateError.message,
    }));
    throw error;
  }
}

async function verifyAdminChallenge(userId, otp) {
  const result = await pool.query(
    `SELECT id, phone_number, code_hash, attempts, max_attempts, expires_at
       FROM admin_phone_verification_challenges
      WHERE user_id = $1
        AND delivery_status = 'sent'
        AND verified_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  if (!result.rows.length) return null;

  const challenge = result.rows[0];
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    await pool.query(
      `UPDATE admin_phone_verification_challenges
          SET delivery_status = 'expired'
        WHERE id = $1`,
      [challenge.id]
    );
    throw new Error('Invalid or expired OTP');
  }
  if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
    throw new Error('Too many invalid verification attempts. Please request a new code.');
  }

  if (!codesMatch(challenge.code_hash, hashCode(otp))) {
    await pool.query(
      `UPDATE admin_phone_verification_challenges
          SET attempts = attempts + 1
        WHERE id = $1`,
      [challenge.id]
    );
    throw new Error('Invalid or expired OTP');
  }

  await pool.query(
    `UPDATE admin_phone_verification_challenges
        SET delivery_status = 'verified', verified_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [challenge.id]
  );
  await pool.query(
    `UPDATE users
        SET phone = $1, phone_number = $1, phone_verified = TRUE, phone_verified_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [challenge.phone_number, userId]
  );

  return { success: true, phoneNumber: challenge.phone_number };
}

module.exports = {
  issueChallenge,
  verifyAdminChallenge,
  hashCode,
  maskPhone,
};
