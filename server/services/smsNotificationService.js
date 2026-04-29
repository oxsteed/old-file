const twilio = require('twilio');
const pool = require('../db');
const logger = require('../utils/logger');

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const fromNumber = process.env.TWILIO_PHONE_NUMBER || '+1234567890';

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

    // Log the SMS
    await pool.query(
      `INSERT INTO sms_logs (user_id, phone_number, message_body, notification_type, twilio_sid, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, phone_number, messageBody, notificationType, result.sid, result.status]
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
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Request phone verification
async function requestPhoneVerification(userId, phoneNumber) {
  try {
    if (!phoneNumber || phoneNumber.length < 10) {
      throw new Error('Invalid phone number');
    }

    const otp = generateOTP();

    // Upsert verification token
    await pool.query(
      `INSERT INTO sms_opt_in_tokens (user_id, phone_number, token)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, phone_number) DO UPDATE
       SET token = $3, verified = FALSE, expires_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes'`,
      [userId, phoneNumber, otp]
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
    const result = await pool.query(
      `SELECT id, phone_number FROM sms_opt_in_tokens
       WHERE user_id = $1
         AND token = $2
         AND verified = FALSE
         AND expires_at > CURRENT_TIMESTAMP`,
      [userId, otp]
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
    const result = await pool.query(
      `SELECT id, notification_type, message_body, status, sent_at
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

module.exports = {
  sendOrderCreatedSMS,
  sendPaymentConfirmedSMS,
  sendOrderShippedSMS,
  sendOrderCancelledSMS,
  sendOrderRefundedSMS,
  sendSMSIfOptedIn,
  requestPhoneVerification,
  verifyPhoneWithOTP,
  getSMSLogs,
  generateOTP,
  maskPhoneNumber
};
