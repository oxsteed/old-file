const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const smsNotificationService = require('../services/smsNotificationService');

// Request phone number verification (send OTP)
async function requestPhoneVerification(req, res) {
  try {
    const userId = req.user?.id;
    const { phoneNumber } = req.body;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    if (!phoneNumber) {
      return sendValidationError(res, { phoneNumber: 'Phone number required' });
    }

    // Rate limit: max 5 verification attempts per hour per phone
    const recentAttempts = await pool.query(
      `SELECT COUNT(*) as count FROM sms_opt_in_tokens
       WHERE user_id = $1
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
      [userId]
    );

    if (parseInt(recentAttempts.rows[0].count) >= 5) {
      return sendError(res, 429, 'Too many verification attempts. Please try again later.');
    }

    try {
      const result = await smsNotificationService.requestPhoneVerification(userId, phoneNumber);
      res.json({
        success: true,
        data: {
          maskedPhone: result.maskedPhone,
          message: 'Verification code sent to your phone'
        }
      });
    } catch (error) {
      sendError(res, 400, error.message || 'Failed to send verification code');
    }
  } catch (error) {
    logger.error('Error requesting phone verification', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to request phone verification');
  }
}

// Verify phone with OTP
async function verifyPhone(req, res) {
  try {
    const userId = req.user?.id;
    const { otp } = req.body;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
      return sendValidationError(res, { otp: 'Invalid OTP format (must be 6 digits)' });
    }

    try {
      const result = await smsNotificationService.verifyPhoneWithOTP(userId, otp);
      res.json({
        success: true,
        data: {
          phoneNumber: result.phoneNumber,
          verified: true,
          message: 'Phone number verified successfully'
        }
      });
    } catch (error) {
      sendError(res, 400, error.message || 'Failed to verify OTP');
    }
  } catch (error) {
    logger.error('Error verifying phone', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to verify phone');
  }
}

// Get SMS preferences
async function getSMSPreferences(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    const result = await pool.query(
      `SELECT u.phone_number, u.phone_verified, np.sms_enabled,
              np.sms_order_created, np.sms_payment_confirmed,
              np.sms_order_shipped, np.sms_order_cancelled, np.sms_order_refunded
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'User not found');
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        phoneNumber: user.phone_number,
        phoneVerified: user.phone_verified || false,
        smsEnabled: user.sms_enabled !== false,
        notificationTypes: {
          orderCreated: user.sms_order_created !== false,
          paymentConfirmed: user.sms_payment_confirmed !== false,
          orderShipped: user.sms_order_shipped !== false,
          orderCancelled: user.sms_order_cancelled !== false,
          orderRefunded: user.sms_order_refunded !== false
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching SMS preferences', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to fetch SMS preferences');
  }
}

// Update SMS preferences
async function updateSMSPreferences(req, res) {
  try {
    const userId = req.user?.id;
    const { smsEnabled, notificationTypes } = req.body;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (smsEnabled !== undefined) {
      updates.push(`sms_enabled = $${paramIndex}`);
      params.push(smsEnabled);
      paramIndex++;
    }

    if (notificationTypes) {
      if (notificationTypes.orderCreated !== undefined) {
        updates.push(`sms_order_created = $${paramIndex}`);
        params.push(notificationTypes.orderCreated);
        paramIndex++;
      }
      if (notificationTypes.paymentConfirmed !== undefined) {
        updates.push(`sms_payment_confirmed = $${paramIndex}`);
        params.push(notificationTypes.paymentConfirmed);
        paramIndex++;
      }
      if (notificationTypes.orderShipped !== undefined) {
        updates.push(`sms_order_shipped = $${paramIndex}`);
        params.push(notificationTypes.orderShipped);
        paramIndex++;
      }
      if (notificationTypes.orderCancelled !== undefined) {
        updates.push(`sms_order_cancelled = $${paramIndex}`);
        params.push(notificationTypes.orderCancelled);
        paramIndex++;
      }
      if (notificationTypes.orderRefunded !== undefined) {
        updates.push(`sms_order_refunded = $${paramIndex}`);
        params.push(notificationTypes.orderRefunded);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return sendValidationError(res, { preferences: 'No preferences to update' });
    }

    await pool.query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    params.push(userId);
    const query = `UPDATE notification_preferences
                   SET ${updates.join(', ')}
                   WHERE user_id = $${paramIndex}
                   RETURNING *`;

    const result = await pool.query(query, params);

    if (!result.rows.length) {
      return sendError(res, 404, 'SMS preferences not found');
    }

    logger.info('SMS preferences updated', { userId, smsEnabled });

    res.json({
      success: true,
      data: {
        smsEnabled: result.rows[0].sms_enabled !== false,
        notificationTypes: {
          orderCreated: result.rows[0].sms_order_created !== false,
          paymentConfirmed: result.rows[0].sms_payment_confirmed !== false,
          orderShipped: result.rows[0].sms_order_shipped !== false,
          orderCancelled: result.rows[0].sms_order_cancelled !== false,
          orderRefunded: result.rows[0].sms_order_refunded !== false
        }
      }
    });
  } catch (error) {
    logger.error('Error updating SMS preferences', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to update SMS preferences');
  }
}

// Get SMS logs
async function getSMSLogs(req, res) {
  try {
    const userId = req.user?.id;
    const { skip = 0, limit = 20 } = req.query;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    const logs = await smsNotificationService.getSMSLogs(userId, parseInt(limit), parseInt(skip));

    res.json({
      success: true,
      data: logs.map(log => ({
        id: log.id,
        type: log.notification_type,
        message: log.message_body,
        status: log.status,
        sentAt: log.sent_at
      }))
    });
  } catch (error) {
    logger.error('Error fetching SMS logs', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to fetch SMS logs');
  }
}

module.exports = {
  requestPhoneVerification,
  verifyPhone,
  getSMSPreferences,
  updateSMSPreferences,
  getSMSLogs
};
