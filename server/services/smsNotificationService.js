const twilio = require('twilio');
const pool = require('../db');
const logger = require('../utils/logger');
// Top-level crypto: also fixes a latent crash in requestPhoneVerification /
// verifyPhoneWithOTP, which call crypto.createHash with no top-level require
// (generateOTP only has a function-scoped one).
const crypto = require('crypto');

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const fromNumber = process.env.TWILIO_PHONE_NUMBER || '+1234567890';

function isTwilioConfigured() {
  return Boolean(client && process.env.TWILIO_PHONE_NUMBER);
}

// Send SMS if user opted in
async function sendOrderCreatedSMS(userId, orderId, orderAmount) {
  const message = `Order #${orderId} confirmed. Total: $${(orderAmount / 100).toFixed(2)}. View: oxsteed.com/orders/${orderId}`;
  return sendSMSIfOptedIn(userId, message, 'order_created');
}

async function sendPaymentConfirmedSMS(userId, orderId) {
  const message = `Payment confirmed for order #${orderId}. Your order is being prepared.`;
  return sendSMSIfOptedIn(userId, message, 'payment_confirmed');
}

async function sendOrderShippedSMS(userId, orderId, trackingNumber = null) {
  let message = `Order #${orderId} has shipped!`;
  if (trackingNumber) {
    message += ` Tracking: ${trackingNumber}`;
  }
  return sendSMSIfOptedIn(userId, message, 'order_shipped');
}

async function sendOrderCancelledSMS(userId, orderId) {
  const message = `Order #${orderId} has been cancelled. Check your email for more details.`;
  return sendSMSIfOptedIn(userId, message, 'order_cancelled');
}

async function sendOrderRefundedSMS(userId, orderId, refundAmount = null) {
  let message = `Refund initiated for order #${orderId}.`;
  if (refundAmount) {
    message += ` Amount: $${(refundAmount / 100).toFixed(2)}.`;
  }
  message += ` It will appear in your account within 5-7 business days.`;
  return sendSMSIfOptedIn(userId, message, 'order_refunded');
}

// ITEM 9: SMS privacy helpers. Full message bodies never reach sms_logs:
// we store only the SHA-256 hash of the body plus a 20-char redacted preview.
function normalizePhoneDigits(phoneNumber) {
  return String(phoneNumber || '').replace(/[^0-9]/g, '');
}

function buildMessageHash(messageBody) {
  return crypto.createHash('sha256').update(String(messageBody), 'utf8').digest('hex');
}

function buildMessagePreview(messageBody) {
  return String(messageBody).replace(/\s+/g, ' ').trim().slice(0, 20) + '...';
}

// Core SMS sending function
async function sendSMSIfOptedIn(userId, messageBody, notificationType) {
  try {
    // Check if user has SMS enabled
    const userResult = await pool.query(
      `SELECT u.phone_number, u.phone_verified, np.sms_enabled
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (!userResult.rows.length) {
      logger.warn('User not found for SMS', { userId });
      return false;
    }

    const { phone_number, phone_verified, sms_enabled } = userResult.rows[0];

    // Validate preconditions
    if (!phone_number) {
      logger.debug('User has no phone number for SMS', { userId, notificationType });
      return false;
    }

    if (!phone_verified) {
      logger.debug('User phone not verified for SMS', { userId, notificationType });
      return false;
    }

    if (sms_enabled === false) {
      logger.debug('User has SMS disabled', { userId, notificationType });
      return false;
    }

    // Check notification type preference
    const notificationTypeField = `sms_${notificationType}`;
    if (notificationTypeField) {
      const prefResult = await pool.query(
        `SELECT ${notificationTypeField} FROM notification_preferences WHERE user_id = $1`,
        [userId]
      );

      if (prefResult.rows.length && prefResult.rows[0][notificationTypeField] === false) {
        logger.debug('User has disabled this notification type', {
          userId,
          notificationType
        });
        return false;
      }
    }

    // Rate limit check: max 1 per order event per user
    const recentSms = await pool.query(
      `SELECT COUNT(*) as count FROM sms_logs
       WHERE user_id = $1
         AND notification_type = $2
         AND sent_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'`,
      [userId, notificationType]
    );

    if (parseInt(recentSms.rows[0].count) > 0) {
      logger.warn('SMS rate limit exceeded', { userId, notificationType });
      return false;
    }

    // Send SMS via Twilio
    const result = await sendTwilioSMS(phone_number, messageBody);

    // Audit fix (ITEM 9): do not store the full SMS body. Log the SHA-256 hash
    // and a 20-char redacted preview only; message_body is hard-coded to the
    // '[redacted]' marker literal so the full text never reaches the database.
    await pool.query(
      `INSERT INTO sms_logs (user_id, phone_number, message_body, message_hash, message_preview, notification_type, twilio_sid, status)
       VALUES ($1, $2, '[redacted]', $3, $4, $5, $6, $7)`,
      [userId, phone_number, buildMessageHash(messageBody), buildMessagePreview(messageBody), notificationType, result.sid, result.status]
    );

    logger.info('SMS sent successfully', {
      userId,
      notificationType,
      twilioSid: result.sid
    });

    return true;
  } catch (error) {
    logger.error('Error sending SMS', { error, userId, notificationType });
    return false;
  }
}

// Send SMS via Twilio API
async function sendTwilioSMS(phoneNumber, messageBody) {
  try {
    if (!client) {
      logger.warn('Twilio credentials not configured, SMS not sent');
      return { sid: 'mock_sid', status: 'queued' };
    }

    const message = await client.messages.create({
      body: messageBody,
      from: fromNumber,
      to: phoneNumber
    });

    return { sid: message.sid, status: message.status };
  } catch (error) {
    logger.error('Twilio API error', { error, phoneNumber });
    throw error;
  }
}

// Generate OTP code for verification
function generateOTP() {
  // Audit fix: use crypto.randomInt, not Math.random, for OTP generation.
  const crypto = require('crypto');
  return crypto.randomInt(100000, 1000000).toString();
}

// Request phone verification
async function requestPhoneVerification(userId, phoneNumber) {
  try {
    if (!phoneNumber || phoneNumber.length < 10) {
      throw new Error('Invalid phone number');
    }

    const otp = generateOTP();
    // Audit fix: hash the OTP before storing. Never store plaintext OTPs.
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // Upsert verification token
    await pool.query(
      `INSERT INTO sms_opt_in_tokens (user_id, phone_number, token)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, phone_number) DO UPDATE
       SET token = $3, verified = FALSE, expires_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes'`,
      [userId, phoneNumber, otpHash]
    );

    // Send OTP via SMS (fallback message if Twilio unavailable)
    const message = `Your OxSteed verification code is: ${otp}. This code expires in 15 minutes.`;
    await sendTwilioSMS(phoneNumber, message);

    logger.info('Phone verification OTP sent', { userId, maskedPhone: maskPhoneNumber(phoneNumber) });
    return { success: true, maskedPhone: maskPhoneNumber(phoneNumber) };
  } catch (error) {
    logger.error('Error requesting phone verification', { error, userId });
    throw error;
  }
}

// Verify phone with OTP
async function verifyPhoneWithOTP(userId, otp) {
  try {
    // Audit fix: hash the input OTP to compare against the stored hash.
    const otpHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    const result = await pool.query(
      `SELECT id, phone_number FROM sms_opt_in_tokens
       WHERE user_id = $1
         AND token = $2
         AND verified = FALSE
         AND expires_at > CURRENT_TIMESTAMP`,
      [userId, otpHash]
    );

    if (!result.rows.length) {
      throw new Error('Invalid or expired OTP');
    }

    const { phone_number } = result.rows[0];

    // Mark as verified and update user
    await pool.query(
      `UPDATE sms_opt_in_tokens
       SET verified = TRUE, verified_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND phone_number = $2`,
      [userId, phone_number]
    );

    await pool.query(
      `UPDATE users
       SET phone_number = $1, phone_verified = TRUE, phone_verified_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [phone_number, userId]
    );

    logger.info('Phone number verified', { userId, maskedPhone: maskPhoneNumber(phone_number) });
    return { success: true, phoneNumber: phone_number };
  } catch (error) {
    logger.error('Error verifying phone OTP', { error, userId });
    throw error;
  }
}

// Get SMS logs for user
async function getSMSLogs(userId, limit = 20, skip = 0) {
  try {
    // ITEM 9: read only the privacy-safe columns; message_body is never
    // selected on the read path.
    const result = await pool.query(
      `SELECT id, notification_type, message_hash, message_preview, status, sent_at
       FROM sms_logs
       WHERE user_id = $1
       ORDER BY sent_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, skip]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error fetching SMS logs', { error, userId });
    throw error;
  }
}

// Mask phone number for display
function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber || phoneNumber.length < 4) return 'XX-XXXX';
  const lastFour = phoneNumber.slice(-4);
  return `***-${lastFour}`;
}

/**
 * Send an SMS to a raw phone number that is NOT tied to a user account
 * (e.g. a restaurant guest who ordered at a kiosk without signing in).
 *
 * ITEM 10 consent governor: before every send we honor STOP opt-outs from
 * sms_opt_outs (digits-normalized phone) and enforce a max of 5 direct sends
 * per phone per 15 minutes, counted from sms_logs. When
 * options.requireVerified is true, the phone must belong to a phone_verified
 * user or the send is refused. Refused sends are logged to the app logger but
 * never reach Twilio and never write an sms_logs row.
 *
 * Successful direct sends are LOGGED (user_id NULL, hash + preview only) so
 * the rate limit has something to count against.
 *
 * Best-effort: returns null on bad input or refusal; never throws so callers
 * can fire-and-forget without guarding.
 *
 * @param {string} phoneNumber  E.164-ish phone number
 * @param {string} messageBody  Message text
 * @param {object} [options]   { notificationType?: string, requireVerified?: boolean }
 * @returns {Promise<{sid:string,status:string}|null>}
 */
async function sendDirectSMS(phoneNumber, messageBody, options = {}) {
  try {
    const phone = (phoneNumber || '').trim();
    if (!phone || phone.replace(/[^0-9]/g, '').length < 7) return null;
    if (!messageBody) return null;
    const digits = normalizePhoneDigits(phone);
    const notificationType = options.notificationType || 'direct';

    // STOP honored: digits-normalized lookup against sms_opt_outs.
    const optOut = await pool.query(
      `SELECT 1 FROM sms_opt_outs WHERE phone_number = $1`,
      [digits]
    );
    if (optOut.rows.length) {
      logger.info('sendDirectSMS refused: recipient opted out', {
        maskedPhone: maskPhoneNumber(phone),
        notificationType
      });
      return null;
    }

    // Verification gate: when the caller requires it, the phone must belong
    // to a phone_verified user.
    if (options.requireVerified) {
      const verified = await pool.query(
        `SELECT 1 FROM users
         WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') = $1
           AND phone_verified = TRUE
         LIMIT 1`,
        [digits]
      );
      if (!verified.rows.length) {
        logger.info('sendDirectSMS refused: phone not verified', {
          maskedPhone: maskPhoneNumber(phone),
          notificationType
        });
        return null;
      }
    }

    // Rate limit: max 5 direct sends per phone per 15 minutes.
    const recent = await pool.query(
      `SELECT COUNT(*) as count FROM sms_logs
       WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') = $1
         AND sent_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes'`,
      [digits]
    );
    if (parseInt(recent.rows[0].count, 10) >= 5) {
      logger.warn('sendDirectSMS rate limit exceeded', {
        maskedPhone: maskPhoneNumber(phone),
        notificationType
      });
      return null;
    }

    const result = await sendTwilioSMS(phone, messageBody);

    // ITEM 9: direct sends are logged too (powers the rate limit above), but
    // with hash + preview only; message_body is the '[redacted]' literal and
    // user_id is NULL for guest sends.
    await pool.query(
      `INSERT INTO sms_logs (user_id, phone_number, message_body, message_hash, message_preview, notification_type, twilio_sid, status)
       VALUES (NULL, $1, '[redacted]', $2, $3, $4, $5, $6)`,
      [phone, buildMessageHash(messageBody), buildMessagePreview(messageBody), notificationType, result.sid, result.status]
    );

    return result;
  } catch (error) {
    logger.error('sendDirectSMS failed', { error: error.message });
    return null;
  }
}

// Support channel delivery must never use the legacy mock fallback. Returning
// a provider error lets the caller persist an honest failed attempt instead of
// telling an agent that an SMS was sent when Twilio is unavailable.
async function sendConfiguredSMS(phoneNumber, messageBody) {
  if (!isTwilioConfigured()) {
    const error = new Error('Twilio is not configured');
    error.code = 'provider_not_configured';
    throw error;
  }
  return sendTwilioSMS(phoneNumber, messageBody);
}

module.exports = {
  sendOrderCreatedSMS,
  sendPaymentConfirmedSMS,
  sendOrderShippedSMS,
  sendOrderCancelledSMS,
  sendOrderRefundedSMS,
  sendSMSIfOptedIn,
  sendDirectSMS,
  sendConfiguredSMS,
  isTwilioConfigured,
  requestPhoneVerification,
  verifyPhoneWithOTP,
  getSMSLogs,
  generateOTP,
  maskPhoneNumber
};
