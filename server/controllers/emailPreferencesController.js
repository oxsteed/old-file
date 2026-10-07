const pool = require('../db');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');

// Get user's email preferences
async function getEmailPreferences(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    const result = await pool.query(
      `SELECT
        id,
        user_id,
        email_notifications,
        sms_notifications,
        push_notifications,
        marketing_emails,
        email_frequency,
        unsubscribe_all,
        unsubscribed_from_bulk_emails,
        email_updated_at
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId]
    );

    let prefs = result.rows[0];
    if (!prefs) {
      const created = await pool.query(
        `INSERT INTO notification_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING
           id,
           user_id,
           email_notifications,
           sms_notifications,
           push_notifications,
           marketing_emails,
           email_frequency,
           unsubscribe_all,
           unsubscribed_from_bulk_emails,
           email_updated_at`,
        [userId]
      );
      prefs = created.rows[0];
    }

    res.json({
      success: true,
      data: {
        userId: prefs.user_id,
        frequency: prefs.email_frequency || 'real-time',
        emailNotifications: prefs.email_notifications !== false,
        marketingEmails: prefs.marketing_emails !== false,
        smsNotifications: prefs.sms_notifications !== false,
        pushNotifications: prefs.push_notifications !== false,
        unsubscribeAll: prefs.unsubscribe_all || false,
        unsubscribedFromBulk: prefs.unsubscribed_from_bulk_emails || false,
        lastUpdated: prefs.email_updated_at
      }
    });
  } catch (error) {
    logger.error('Error fetching email preferences', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to fetch email preferences');
  }
}

// Update email preferences
async function updateEmailPreferences(req, res) {
  try {
    const userId = req.user?.id;
    const { frequency, emailNotifications, marketingEmails, smsNotifications, pushNotifications } = req.body;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    // Validate frequency
    if (frequency && !['real-time', 'daily', 'weekly', 'off'].includes(frequency)) {
      return sendValidationError(res, { frequency: 'Invalid frequency option' });
    }

    await pool.query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const result = await pool.query(
      `UPDATE notification_preferences
       SET email_frequency = COALESCE($1, email_frequency),
           email_notifications = COALESCE($2, email_notifications),
           marketing_emails = COALESCE($3, marketing_emails),
           sms_notifications = COALESCE($4, sms_notifications),
           push_notifications = COALESCE($5, push_notifications),
           email_updated_at = CURRENT_TIMESTAMP,
           unsubscribe_all = FALSE
       WHERE user_id = $6
       RETURNING *`,
      [frequency || null, emailNotifications, marketingEmails, smsNotifications, pushNotifications, userId]
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'Email preferences not found');
    }

    const prefs = result.rows[0];

    logger.info('Email preferences updated', { userId, frequency, emailNotifications });

    res.json({
      success: true,
      data: {
        userId: prefs.user_id,
        frequency: prefs.email_frequency || 'real-time',
        emailNotifications: prefs.email_notifications !== false,
        marketingEmails: prefs.marketing_emails !== false,
        smsNotifications: prefs.sms_notifications !== false,
        pushNotifications: prefs.push_notifications !== false,
        lastUpdated: prefs.email_updated_at
      }
    });
  } catch (error) {
    logger.error('Error updating email preferences', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to update email preferences');
  }
}

// Request unsubscribe from all emails
async function unsubscribeFromAll(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 401, 'Unauthorized');
    }

    await pool.query(
      `UPDATE notification_preferences
       SET unsubscribe_all = TRUE,
           email_updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId]
    );

    logger.info('User unsubscribed from all emails', { userId });

    res.json({
      success: true,
      message: 'You have been unsubscribed from all emails'
    });
  } catch (error) {
    logger.error('Error unsubscribing from all emails', { error, userId: req.user?.id });
    sendError(res, 500, 'Failed to unsubscribe from emails');
  }
}

// Generate unsubscribe token for email links
async function generateUnsubscribeToken(userId, category = null) {
  try {
    const token = crypto.randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO email_unsubscribe_tokens (user_id, token, category)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, token, category]
    );

    return token;
  } catch (error) {
    logger.error('Error generating unsubscribe token', { error, userId, category });
    return null;
  }
}

// Handle unsubscribe via email link (no auth required)
async function handleUnsubscribeLink(req, res) {
  try {
    const { token } = req.params;

    if (!token || token.length < 32) {
      return sendError(res, 400, 'Invalid unsubscribe token');
    }

    const result = await pool.query(
      `SELECT user_id, category FROM email_unsubscribe_tokens
       WHERE token = $1 AND used_at IS NULL`,
      [token]
    );

    if (!result.rows.length) {
      return sendError(res, 404, 'Token not found or already used');
    }

    const { user_id, category } = result.rows[0];

    if (category) {
      // Unsubscribe from specific category. marketing_emails=TRUE means opted
      // IN, so unsubscribing sets it to FALSE (matching the POST confirm path);
      // unsubscribed_from_bulk_emails uses inverted semantics (TRUE means
      // unsubscribed) so that one stays TRUE.
      const categoryMapping = {
        'marketing': { column: 'marketing_emails', value: false },
        'bulk': { column: 'unsubscribed_from_bulk_emails', value: true },
      };

      if (categoryMapping[category]) {
        const { column, value } = categoryMapping[category];
        await pool.query(
          `UPDATE notification_preferences
           SET ${column} = $2,
               email_updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1`,
          [user_id, value]
        );
      }
    } else {
      // Unsubscribe from all
      await pool.query(
        `UPDATE notification_preferences
         SET unsubscribe_all = TRUE,
             email_updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [user_id]
      );
    }

    // Mark token as used
    await pool.query(
      `UPDATE email_unsubscribe_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE token = $1`,
      [token]
    );

    logger.info('User unsubscribed via email link', { userId: user_id, category });

    res.json({
      success: true,
      message: 'You have been unsubscribed successfully'
    });
  } catch (error) {
    logger.error('Error handling unsubscribe link', { error });
    sendError(res, 500, 'Failed to process unsubscribe request');
  }
}

// Shared core for token-based unsubscribes (link confirm + RFC 8058 one-click).
// Validates the token, applies the unsubscribe with the corrected polarity
// (marketing_emails=TRUE means opted IN, so unsubscribing sets it to FALSE;
// unsubscribed_from_bulk_emails uses inverted semantics: TRUE means
// unsubscribed), marks the token used, and returns { userId, category }.
// Returns { error: { status, message } } when the token is invalid.
async function consumeUnsubscribeToken(token) {
  if (!token || String(token).length < 32) {
    return { error: { status: 400, message: 'Invalid unsubscribe token' } };
  }

  const result = await pool.query(
    `SELECT user_id, category FROM email_unsubscribe_tokens
     WHERE token = $1 AND used_at IS NULL`,
    [token]
  );

  if (!result.rows.length) {
    return { error: { status: 404, message: 'Token not found or already used' } };
  }

  const { user_id, category } = result.rows[0];

  // Apply unsubscribe
  if (category) {
    const categoryMapping = {
      'marketing': { column: 'marketing_emails', value: false },
      'bulk': { column: 'unsubscribed_from_bulk_emails', value: true },
    };

    if (categoryMapping[category]) {
      const { column, value } = categoryMapping[category];
      await pool.query(
        `UPDATE notification_preferences
         SET ${column} = $2,
             email_updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [user_id, value]
      );
    }
  } else {
    await pool.query(
      `UPDATE notification_preferences
       SET unsubscribe_all = TRUE,
           email_updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [user_id]
    );
  }

  // Mark token as used
  await pool.query(
    `UPDATE email_unsubscribe_tokens
     SET used_at = CURRENT_TIMESTAMP
     WHERE token = $1`,
    [token]
  );

  return { userId: user_id, category };
}

// Confirm unsubscribe via POST
async function confirmUnsubscribe(req, res) {
  try {
    const { token } = req.params;
    const outcome = await consumeUnsubscribeToken(token);
    if (outcome.error) {
      return sendError(res, outcome.error.status, outcome.error.message);
    }

    logger.info('Unsubscribe confirmed via POST', { userId: outcome.userId, category: outcome.category });

    res.json({
      success: true,
      message: 'Your unsubscribe request has been confirmed'
    });
  } catch (error) {
    logger.error('Error confirming unsubscribe', { error });
    sendError(res, 500, 'Failed to confirm unsubscribe');
  }
}

// RFC 8058 one-click unsubscribe (no auth). Mail providers POST to the URL
// from the List-Unsubscribe header with body `List-Unsubscribe=One-Click`;
// the token identifying the recipient rides in the URL query string, and is
// also accepted from the POST body for direct clients.
async function unsubscribeOneClick(req, res) {
  try {
    const token = req.query?.token || req.body?.token;
    const outcome = await consumeUnsubscribeToken(token);
    if (outcome.error) {
      return sendError(res, outcome.error.status, outcome.error.message);
    }

    logger.info('One-click unsubscribe honored', { userId: outcome.userId, category: outcome.category });

    res.json({
      success: true,
      message: 'You have been unsubscribed successfully'
    });
  } catch (error) {
    logger.error('Error handling one-click unsubscribe', { error });
    sendError(res, 500, 'Failed to process unsubscribe request');
  }
}

module.exports = {
  getEmailPreferences,
  updateEmailPreferences,
  unsubscribeFromAll,
  generateUnsubscribeToken,
  handleUnsubscribeLink,
  confirmUnsubscribe,
  unsubscribeOneClick
};
